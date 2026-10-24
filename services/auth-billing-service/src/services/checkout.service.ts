import type { PoolClient } from "../db/index.js";
import { pool, withTransaction } from "../db/index.js";
import type { PaymentProvider } from "../config/packages.js";
import {
  ACTIVE_PAYMENT_PROVIDER,
  BILLING_CURRENCY,
  resolveCreditPackage,
  type BillingCurrency,
  type CreditPackageConfig,
} from "../config/packages.js";
import { assertLemonCheckoutConfigured, createLemonSqueezyCheckoutUrl } from "../lib/lemonsqueezy.js";
import { AppError } from "../types/index.js";

/** Lemon Squeezy is redirect-based; retained as a literal for API stability. */
export type CheckoutMode = "redirect";

export interface CheckoutResult {
  provider: PaymentProvider;
  currency: BillingCurrency;
  mode: CheckoutMode;
  checkoutUrl: string;
  orderId: string;
}

async function insertPendingOrder(
  client: PoolClient,
  params: {
    userId: string;
    packageId: string;
    provider: PaymentProvider;
    currency: BillingCurrency;
    amountMinor: number;
    credits: number;
  },
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO pending_checkout_orders
       (user_id, package_id, provider, currency, amount_minor, credits, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id::text`,
    [
      params.userId,
      params.packageId,
      params.provider,
      params.currency,
      params.amountMinor,
      params.credits,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new AppError(500, "Failed to create pending checkout order.", "CHECKOUT_CREATE_FAILED");
  }
  return id;
}

async function markPendingOrderFailed(orderId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE pending_checkout_orders SET status = 'failed' WHERE id = $1 AND status = 'pending'`,
      [orderId],
    );
  } catch (err) {
    // Never mask the checkout error; expire_stale_checkout_orders() covers this row later.
    console.error("[billing] Could not mark checkout order failed", {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Single checkout path — every request, regardless of buyer region,
 * routes through the Lemon Squeezy hosted checkout.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createUnifiedCheckout(params: {
  userId: string;
  userEmail: string;
  packageId: unknown;
  returnPath?: unknown;
}): Promise<CheckoutResult> {
  // Refuse to mint a checkout URL we cannot attribute. Without a valid
  // custom_data.user_id the webhook can only fall back to buyer email, and a
  // buyer who pays with a different email than their account would go
  // uncredited. Fail loudly here instead of silently at fulfilment time.
  if (!params.userId?.trim() || !UUID_RE.test(params.userId.trim())) {
    throw new AppError(
      401,
      "Cannot start checkout without an authenticated user.",
      "CHECKOUT_MISSING_USER",
    );
  }
  if (!params.userEmail?.trim()) {
    throw new AppError(
      401,
      "Cannot start checkout without an account email.",
      "CHECKOUT_MISSING_EMAIL",
    );
  }

  const pkg = resolveCreditPackage(params.packageId);
  const returnPath =
    typeof params.returnPath === "string" ? params.returnPath : undefined;

  return createLemonCheckout({
    userId: params.userId,
    userEmail: params.userEmail,
    pkg,
    amountMinor: pkg.priceUsdCents,
    returnPath,
  });
}

async function createLemonCheckout(params: {
  userId: string;
  userEmail: string;
  pkg: CreditPackageConfig;
  amountMinor: number;
  returnPath?: string;
}): Promise<CheckoutResult> {
  // Misconfiguration is known up front — refuse before writing an order row.
  assertLemonCheckoutConfigured(params.pkg.id);

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

  let checkoutUrl: string;
  try {
    checkoutUrl = await createLemonSqueezyCheckoutUrl({
      userId: params.userId,
      userEmail: params.userEmail,
      packageId: params.pkg.id,
      productName: `${params.pkg.name} — ${params.pkg.credits} Credits`,
      credits: params.pkg.credits,
      pendingOrderId: orderId,
      returnPath: params.returnPath,
    });
  } catch (err) {
    // No checkout exists, so this row can never be paid: keep it for audit as
    // 'failed' instead of an orphan 'pending' row (FINDING-15).
    await markPendingOrderFailed(orderId);
    throw err;
  }

  return {
    provider: ACTIVE_PAYMENT_PROVIDER,
    currency: BILLING_CURRENCY,
    mode: "redirect",
    checkoutUrl,
    orderId,
  };
}

export interface FulfillPurchaseParams {
  userId: string;
  packageId: string;
  credits: number;
  provider: PaymentProvider;
  /** Lemon Squeezy order id — stored as reference_id */
  paymentReference: string;
  /** Optional pending checkout row to mark completed */
  pendingOrderId?: string;
  expectedAmountMinor: number;
  actualAmountMinor: number;
  currency: string;
}

const PAYMENT_REFERENCE_UNIQUE = "uq_credit_ledger_provider_reference";

function isDuplicatePaymentReference(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, constraint } = err as { code?: string; constraint?: string };
  return code === "23505" && constraint === PAYMENT_REFERENCE_UNIQUE;
}

/**
 * Idempotent credit grant after a verified provider webhook.
 * Uses CREDIT_PURCHASE + unique (provider, reference_id).
 *
 * Two concurrent deliveries of the same order can both pass the "already
 * processed?" check; the unique index then rejects the second insert. That
 * loser is reported as `already_processed`, exactly like a sequential replay —
 * not thrown, which used to be logged as a FAILED fulfilment (FINDING-11).
 */
export async function fulfillVerifiedPurchase(
  params: FulfillPurchaseParams,
): Promise<{ processed: boolean; ledgerId: string | null; reason?: string }> {
  try {
    return await grantPurchase(params);
  } catch (err) {
    if (!isDuplicatePaymentReference(err)) throw err;
    const existing = await pool.query<{ id: string }>(
      `SELECT id::text FROM credit_ledger_transactions
       WHERE provider = $1 AND reference_id = $2
       LIMIT 1`,
      [params.provider, params.paymentReference],
    );
    return { processed: false, ledgerId: existing.rows[0]?.id ?? null, reason: "already_processed" };
  }
}

async function grantPurchase(
  params: FulfillPurchaseParams,
): Promise<{ processed: boolean; ledgerId: string | null; reason?: string }> {
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
    const existing = await client.query<{ id: string }>(
      `SELECT id::text FROM credit_ledger_transactions
       WHERE provider = $1 AND reference_id = $2
       LIMIT 1`,
      [params.provider, params.paymentReference],
    );

    if ((existing.rowCount ?? 0) > 0) {
      return { processed: false, ledgerId: existing.rows[0]?.id ?? null, reason: "already_processed" };
    }

    await client.query(
      `INSERT INTO user_balances (user_id, balance) VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [params.userId],
    );

    const posted = await client.query<{ ledger_id: string }>(
      `SELECT post_credit_transaction($1, $2, 'CREDIT_PURCHASE'::credit_transaction_type, $3, $4) AS ledger_id`,
      [params.userId, params.credits, params.paymentReference, params.provider],
    );

    if (params.pendingOrderId) {
      // Also from 'expired' / 'failed': the money arrived, so the order is complete.
      await client.query(
        `UPDATE pending_checkout_orders
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND status <> 'completed'`,
        [params.pendingOrderId],
      );
    }

    return {
      processed: true,
      ledgerId: posted.rows[0]?.ledger_id ?? null,
    };
  });
}

export async function getPendingOrderById(orderId: string) {
  const result = await pool.query<{
    id: string;
    user_id: string;
    package_id: string;
    provider: string;
    currency: string;
    amount_minor: number;
    credits: number;
    status: string;
  }>(
    `SELECT id::text, user_id::text, package_id, provider, currency, amount_minor, credits, status
     FROM pending_checkout_orders
     WHERE id = $1
     LIMIT 1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}
