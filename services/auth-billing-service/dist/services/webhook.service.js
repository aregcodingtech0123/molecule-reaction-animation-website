import { ACTIVE_PAYMENT_PROVIDER, resolveCreditPackage } from "../config/packages.js";
import { packageIdForLemonVariant, parseLemonSqueezyEvent, readCustomDataString, verifyLemonSqueezySignature, } from "../lib/lemonsqueezy.js";
import { fulfillVerifiedPurchase } from "./checkout.service.js";
import { sendPurchaseReceiptEmail } from "./email.service.js";
import { pool } from "../db/index.js";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function findUserIdByEmail(email) {
    const result = await pool.query(`SELECT id::text FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`, [email]);
    return result.rows[0]?.id ?? null;
}
async function userExists(userId) {
    const result = await pool.query(`SELECT 1 FROM users WHERE id = $1 LIMIT 1`, [userId]);
    return (result.rowCount ?? 0) > 0;
}
async function loadReceiptRecipient(userId) {
    const result = await pool.query(`SELECT u.email,
            u.first_name,
            u.last_name,
            COALESCE(b.balance, 0)::int AS balance
     FROM users u
     LEFT JOIN user_balances b ON b.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`, [userId]);
    const row = result.rows[0];
    if (!row?.email)
        return null;
    const userName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    return {
        email: row.email,
        userName: userName || row.email.split("@")[0] || "there",
        balance: row.balance ?? 0,
    };
}
/**
 * Fire-and-forget receipt — never blocks or fails webhook fulfilment.
 */
function queuePurchaseReceipt(params) {
    void (async () => {
        try {
            const recipient = await loadReceiptRecipient(params.userId);
            if (!recipient) {
                console.warn("[email] Skipping purchase receipt — user not found", {
                    userId: params.userId,
                    orderId: params.orderId,
                });
                return;
            }
            await sendPurchaseReceiptEmail(recipient.email, recipient.userName, params.creditsAdded, params.orderId, params.amountPaidCents / 100, recipient.balance, params.currency);
            console.log("[email] Purchase receipt sent", {
                orderId: params.orderId,
                to: recipient.email,
            });
        }
        catch (error) {
            console.error("[email] Purchase receipt failed (credits already allocated)", {
                orderId: params.orderId,
                userId: params.userId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    })();
}
/**
 * Resolve the buyer to a real `users.id`, tolerating every way custom_data can
 * let us down. Purchases made outside our API-generated checkout (a direct
 * Lemon Squeezy product link, a Buy-Now button on the store page) arrive with
 * no custom_data at all, so the buyer email is the only identity we get.
 *
 * Order of preference:
 *   1. custom_data.user_id, when it is a well-formed UUID that exists
 *   2. the order's buyer email
 *
 * A malformed or stale user_id no longer aborts fulfilment — previously a
 * non-UUID value reached Postgres and threw `invalid input syntax for type
 * uuid`, losing the purchase entirely.
 */
async function resolveUserId(customUserId, email) {
    if (customUserId) {
        if (!UUID_RE.test(customUserId)) {
            console.warn("[Webhook] custom_data.user_id is not a UUID — falling back to email", {
                customUserId,
            });
        }
        else if (await userExists(customUserId)) {
            return { userId: customUserId, via: "custom_data.user_id" };
        }
        else {
            console.warn("[Webhook] custom_data.user_id not found in users — falling back to email", {
                customUserId,
            });
        }
    }
    const trimmed = email?.trim();
    if (trimmed) {
        const byEmail = await findUserIdByEmail(trimmed);
        if (byEmail) {
            return { userId: byEmail, via: "order email fallback" };
        }
        console.error("[Webhook] No user matches the order email either", { email: trimmed });
    }
    return { userId: null, via: "unresolved" };
}
/**
 * Stage 1 — SYNCHRONOUS gate. No I/O, no database.
 *
 * Verifies the `X-Signature` HMAC-SHA256 over the raw body and parses the JSON.
 * Throws `AppError(401)` on a bad/missing signature and `AppError(503)` when
 * `LEMONSQUEEZY_WEBHOOK_SECRET` is unset. Callers run this BEFORE acknowledging
 * so an unauthenticated request never reaches the database.
 */
export function verifyAndParseLemonEvent(rawBody, signatureHeader) {
    verifyLemonSqueezySignature(rawBody, signatureHeader);
    return parseLemonSqueezyEvent(rawBody);
}
/**
 * Stage 2 — ASYNCHRONOUS fulfilment. Runs AFTER the 200 OK has been flushed,
 * so its latency never holds the Lemon Squeezy delivery open.
 *
 * 1) Resolve user from `meta.custom_data.user_id` (fallback: order email)
 * 2) Resolve package from variant_id, falling back to `custom_data.package_id`
 * 3) Credit the user via the immutable ledger (`CREDIT_PURCHASE`)
 *
 * Never throws for business-rule rejections — it returns a reason so the caller
 * can log it. Genuine faults (for example the database being unreachable) do
 * propagate, and the caller is responsible for catching them.
 */
export async function processLemonSqueezyEvent(event) {
    const eventName = event.meta?.event_name;
    if (eventName !== "order_created") {
        return { processed: false, reason: "ignored_event_type" };
    }
    const order = event.data;
    const attrs = order?.attributes;
    if (!order?.id || !attrs) {
        console.error("[Webhook] Malformed order payload — no data.attributes");
        return { processed: false, reason: "malformed_payload" };
    }
    if (attrs.status !== "paid") {
        console.log("[Webhook] Ignoring non-paid order", { orderId: order.id, status: attrs.status });
        return { processed: false, reason: "order_not_paid", orderId: order.id };
    }
    if (attrs.refunded) {
        console.log("[Webhook] Ignoring refunded order", { orderId: order.id });
        return { processed: false, reason: "order_refunded", orderId: order.id };
    }
    const custom = event.meta?.custom_data ?? {};
    const customUserId = readCustomDataString(custom, "user_id");
    const customPackageId = readCustomDataString(custom, "package_id");
    const pendingOrderId = readCustomDataString(custom, "pending_order_id") ?? undefined;
    const variantId = attrs.first_order_item?.variant_id ?? null;
    const packageFromVariant = packageIdForLemonVariant(variantId);
    // Prefer variant mapping; fall back to custom_data.package_id.
    // If both exist and disagree, trust custom_data.package_id (checkout intent is authoritative).
    let packageId = packageFromVariant ?? customPackageId;
    if (customPackageId && packageFromVariant && customPackageId !== packageFromVariant) {
        console.warn("[Webhook] package_id / variant mismatch — using custom_data.package_id", {
            orderId: order.id,
            customPackageId,
            variantId,
            packageFromVariant,
        });
        packageId = customPackageId;
    }
    const { userId, via } = await resolveUserId(customUserId, attrs.user_email);
    console.log("[Webhook] Processing user:", userId, "for package:", packageId, {
        resolvedVia: via,
        variantId,
        customUserId,
        orderEmail: attrs.user_email ?? null,
        orderId: order.id,
    });
    if (!packageId) {
        console.error("[Webhook] Unable to resolve package", { orderId: order.id, variantId, custom });
        return { processed: false, reason: "unresolved_package", orderId: order.id };
    }
    let pkg;
    try {
        pkg = resolveCreditPackage(packageId);
    }
    catch {
        console.error("[Webhook] Invalid package_id", { orderId: order.id, packageId });
        return { processed: false, reason: "invalid_package_id", orderId: order.id };
    }
    if (!userId) {
        console.error("[Webhook] Missing user identity — no user_id match and no email match", {
            orderId: order.id,
            customUserId,
            userEmail: attrs.user_email ?? null,
        });
        return { processed: false, reason: "missing_user", orderId: order.id };
    }
    if (attrs.currency && attrs.currency.toLowerCase() !== "usd") {
        console.error("[Webhook] Unexpected currency", { orderId: order.id, currency: attrs.currency });
        return { processed: false, reason: "currency_mismatch", orderId: order.id };
    }
    // Lemon `total` may include tax; accept subtotal or line item price when they match list price.
    const amountCandidates = [attrs.total, attrs.subtotal, attrs.first_order_item?.price].filter((n) => typeof n === "number" && Number.isFinite(n));
    if (!amountCandidates.some((n) => n === pkg.priceUsdCents)) {
        console.error("[Webhook] Amount mismatch", {
            orderId: order.id,
            expected: pkg.priceUsdCents,
            candidates: amountCandidates,
        });
        return { processed: false, reason: "amount_mismatch", orderId: order.id };
    }
    const result = await fulfillVerifiedPurchase({
        userId,
        packageId: pkg.id,
        credits: pkg.credits,
        provider: ACTIVE_PAYMENT_PROVIDER,
        paymentReference: `ls_order_${order.id}`,
        pendingOrderId,
        expectedAmountMinor: pkg.priceUsdCents,
        actualAmountMinor: pkg.priceUsdCents,
        currency: "USD",
    });
    if (result.processed) {
        console.log(`[Webhook] Credited user ${userId} +${pkg.credits}`, {
            packageId: pkg.id,
            variantId: variantId ?? "n/a",
            orderId: order.id,
            ledgerId: result.ledgerId,
        });
        queuePurchaseReceipt({
            userId,
            creditsAdded: pkg.credits,
            orderId: String(order.id),
            amountPaidCents: pkg.priceUsdCents,
            currency: (attrs.currency || "USD").toUpperCase(),
        });
    }
    else {
        console.warn("[Webhook] Not credited", {
            orderId: order.id,
            userId,
            reason: result.reason ?? "unknown",
        });
    }
    return {
        processed: result.processed,
        reason: result.reason,
        ledgerId: result.ledgerId,
        userId,
        packageId: pkg.id,
        creditAmount: pkg.credits,
        variantId,
        orderId: order.id,
    };
}
/** Health probe — verify DB connectivity for billing ops. */
export async function pingBillingDb() {
    await pool.query("SELECT 1");
}
//# sourceMappingURL=webhook.service.js.map