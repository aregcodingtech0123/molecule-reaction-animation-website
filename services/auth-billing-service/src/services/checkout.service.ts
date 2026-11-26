import { safeErrorLogFields } from "../db/diagnostics.js";
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
import { REVIEW_DESCRIPTIONS, type ReviewDescription } from "../lib/lemonEvent.js";
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
      ...safeErrorLogFields(err),
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

/** Whether an order reference is already credited (V8 contract 5.1, decisions Q2 B / N-1 / Q8). */
export type OrderCredit =
  | { kind: "none" }
  | { kind: "credited"; ledgerId: string; userId: string; amount: number }
  | { kind: "ambiguous"; historicalCount: number };

interface Queryable {
  query: PoolClient["query"];
}

/**
 * The one lookup used at every site of contract 5.1, in ONE statement (one snapshot):
 *  L1 the provider-keyed row (`provider = <provider>`, this exact reference; at most one, uq_credit_ledger_provider_reference)
 *     answers first, with that row's own user and amount;
 *  L2 otherwise the historical provider-less manual credits of this exact reference (`provider IS NULL`, ADMIN_ADJUSTMENT,
 *     amount > 0): none → not credited; exactly one → credited by that row; more than one → ambiguous, nothing is chosen.
 * Equality on the whole reference; never LIKE, never ORDER BY + LIMIT. A lookup, not a database-enforced uniqueness: the unique
 * index does not cover provider IS NULL.
 */
export async function findOrderCredit(db: Queryable, provider: string, reference: string): Promise<OrderCredit> {
  const { rows } = await db.query<{ id: string; user_id: string; amount: number; provider: string | null }>(
    `SELECT id::text, user_id::text, amount, provider FROM credit_ledger_transactions
     WHERE reference_id = $2
       AND (provider = $1 OR (provider IS NULL AND transaction_type = 'ADMIN_ADJUSTMENT' AND amount > 0))`,
    [provider, reference],
  );
  const asCredit = (r: { id: string; user_id: string; amount: number }): OrderCredit => ({
    kind: "credited",
    ledgerId: r.id,
    userId: r.user_id,
    amount: Number(r.amount),
  });
  const keyed = rows.find((r) => r.provider === provider);
  if (keyed) return asCredit(keyed);
  const historical = rows.filter((r) => r.provider === null);
  if (historical.length === 1) return asCredit(historical[0]!);
  if (historical.length > 1) return { kind: "ambiguous", historicalCount: historical.length };
  return { kind: "none" };
}

/** A review stop: the event is stored as failed with this fixed description and is not retried (contract P4.2, P4.3, Q-T3). */
export function reviewStop(description: ReviewDescription): AppError {
  return new AppError(500, description, "REVIEW_STOP");
}

export interface PurchaseResult {
  processed: boolean;
  ledgerId: string | null;
  reason?: string;
  /** For `already_processed`: the ledger row's own user and amount (Q8); absent when unknown. */
  userId?: string;
  creditAmount?: number;
}

function alreadyProcessed(credit: OrderCredit): PurchaseResult {
  return credit.kind === "credited"
    ? { processed: false, ledgerId: credit.ledgerId, reason: "already_processed", userId: credit.userId, creditAmount: credit.amount }
    : { processed: false, ledgerId: null, reason: "already_processed" };
}

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
export async function fulfillVerifiedPurchase(params: FulfillPurchaseParams): Promise<PurchaseResult> {
  try {
    return await grantPurchase(params);
  } catch (err) {
    if (!isDuplicatePaymentReference(err)) throw err;
    // Site 3 of contract 5.1: the 23505 came from the provider-keyed index, so that row exists; the shared lookup is used for
    // uniformity and answers with its own user and amount.
    return alreadyProcessed(await findOrderCredit(pool, params.provider, params.paymentReference));
  }
}

async function grantPurchase(params: FulfillPurchaseParams): Promise<PurchaseResult> {
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
    // Site 4 of contract 5.1 (inside the crediting transaction).
    const credit = await findOrderCredit(client, params.provider, params.paymentReference);
    if (credit.kind === "credited") return alreadyProcessed(credit);
    if (credit.kind === "ambiguous") throw reviewStop(REVIEW_DESCRIPTIONS.historicalCreditAmbiguous);

    // The account was resolved before this transaction; it may have been anonymised since. The share lock makes a concurrent
    // anonymise_user() wait (it locks the row FOR UPDATE), so a deleted account is never credited. Taken before the per-user
    // advisory lock inside post_credit_transaction().
    const active = await client.query(`SELECT 1 FROM users WHERE id = $1 AND anonymised_at IS NULL FOR SHARE`, [params.userId]);
    if ((active.rowCount ?? 0) === 0) {
      return { processed: false, ledgerId: null, reason: "missing_user" };
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
      // Only the credited user's own order: pending_order_id comes from custom_data, which a buyer can set on a store link.
      await client.query(
        `UPDATE pending_checkout_orders
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status <> 'completed'`,
        [params.pendingOrderId, params.userId],
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
