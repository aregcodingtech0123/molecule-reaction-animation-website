import { pool, withTransaction } from "../db/index.js";
import { ACTIVE_PAYMENT_PROVIDER, BILLING_CURRENCY, resolveCreditPackage, } from "../config/packages.js";
import { createLemonSqueezyCheckoutUrl } from "../lib/lemonsqueezy.js";
import { AppError } from "../types/index.js";
async function insertPendingOrder(client, params) {
    const inserted = await client.query(`INSERT INTO pending_checkout_orders
       (user_id, package_id, provider, currency, amount_minor, credits, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id::text`, [
        params.userId,
        params.packageId,
        params.provider,
        params.currency,
        params.amountMinor,
        params.credits,
    ]);
    const id = inserted.rows[0]?.id;
    if (!id) {
        throw new AppError(500, "Failed to create pending checkout order.", "CHECKOUT_CREATE_FAILED");
    }
    return id;
}
/**
 * Single checkout path — every request, regardless of buyer region,
 * routes through the Lemon Squeezy hosted checkout.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function createUnifiedCheckout(params) {
    // Refuse to mint a checkout URL we cannot attribute. Without a valid
    // custom_data.user_id the webhook can only fall back to buyer email, and a
    // buyer who pays with a different email than their account would go
    // uncredited. Fail loudly here instead of silently at fulfilment time.
    if (!params.userId?.trim() || !UUID_RE.test(params.userId.trim())) {
        throw new AppError(401, "Cannot start checkout without an authenticated user.", "CHECKOUT_MISSING_USER");
    }
    if (!params.userEmail?.trim()) {
        throw new AppError(401, "Cannot start checkout without an account email.", "CHECKOUT_MISSING_EMAIL");
    }
    const pkg = resolveCreditPackage(params.packageId);
    const returnPath = typeof params.returnPath === "string" ? params.returnPath : undefined;
    return createLemonCheckout({
        userId: params.userId,
        userEmail: params.userEmail,
        pkg,
        amountMinor: pkg.priceUsdCents,
        returnPath,
    });
}
async function createLemonCheckout(params) {
    const orderId = await withTransaction(async (client) => {
        return insertPendingOrder(client, {
            userId: params.userId,
            packageId: params.pkg.id,
            provider: ACTIVE_PAYMENT_PROVIDER,
            currency: BILLING_CURRENCY,
            amountMinor: params.amountMinor,
            credits: params.pkg.credits,
        });
    });
    const checkoutUrl = await createLemonSqueezyCheckoutUrl({
        userId: params.userId,
        userEmail: params.userEmail,
        packageId: params.pkg.id,
        productName: `${params.pkg.name} — ${params.pkg.credits} Credits`,
        credits: params.pkg.credits,
        pendingOrderId: orderId,
        returnPath: params.returnPath,
    });
    return {
        provider: ACTIVE_PAYMENT_PROVIDER,
        currency: BILLING_CURRENCY,
        mode: "redirect",
        checkoutUrl,
        orderId,
    };
}
/**
 * Idempotent credit grant after a verified provider webhook.
 * Uses CREDIT_PURCHASE + unique (provider, reference_id).
 */
export async function fulfillVerifiedPurchase(params) {
    if (params.actualAmountMinor !== params.expectedAmountMinor) {
        console.error("[billing] Fraud alert: amount mismatch", {
            provider: params.provider,
            paymentReference: params.paymentReference,
            userId: params.userId,
            expected: params.expectedAmountMinor,
            actual: params.actualAmountMinor,
            currency: params.currency,
        });
        return { processed: false, ledgerId: null, reason: "amount_mismatch" };
    }
    return withTransaction(async (client) => {
        const existing = await client.query(`SELECT id::text FROM credit_ledger_transactions
       WHERE provider = $1 AND reference_id = $2
       LIMIT 1`, [params.provider, params.paymentReference]);
        if ((existing.rowCount ?? 0) > 0) {
            return { processed: false, ledgerId: existing.rows[0]?.id ?? null, reason: "already_processed" };
        }
        await client.query(`INSERT INTO user_balances (user_id, balance) VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`, [params.userId]);
        const posted = await client.query(`SELECT post_credit_transaction($1, $2, 'CREDIT_PURCHASE'::credit_transaction_type, $3, $4) AS ledger_id`, [params.userId, params.credits, params.paymentReference, params.provider]);
        if (params.pendingOrderId) {
            await client.query(`UPDATE pending_checkout_orders
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND status = 'pending'`, [params.pendingOrderId]);
        }
        return {
            processed: true,
            ledgerId: posted.rows[0]?.ledger_id ?? null,
        };
    });
}
export async function getPendingOrderById(orderId) {
    const result = await pool.query(`SELECT id::text, user_id::text, package_id, provider, currency, amount_minor, credits, status
     FROM pending_checkout_orders
     WHERE id = $1
     LIMIT 1`, [orderId]);
    return result.rows[0] ?? null;
}
//# sourceMappingURL=checkout.service.js.map