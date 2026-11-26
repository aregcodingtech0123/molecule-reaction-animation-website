import { env } from "../config/env.js";
import { ACTIVE_PAYMENT_PROVIDER, CREDIT_PACKAGES } from "../config/packages.js";
import {
  lemonOrderId,
  packageIdForLemonVariant,
  parseLemonSqueezyEvent,
  readCustomDataString,
  readLemonOrderFields,
  verifyLemonSqueezySignature,
  type LemonOrderCreatedEvent,
} from "../lib/lemonsqueezy.js";
import { REVIEW_DESCRIPTIONS, orderCreatedStateVerdict, readOrderPaymentState, refundEventVerdict } from "../lib/lemonEvent.js";
import { findOrderCredit, fulfillVerifiedPurchase, reviewStop } from "./checkout.service.js";
import { sendPurchaseReceiptEmail } from "./email.service.js";
import { pool } from "../db/index.js";
import { safeEmailErrorFields } from "../lib/email.js";
import { maskEmail } from "../utils/logRedaction.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findUserIdByEmail(email: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id::text FROM users WHERE lower(trim(email)) = lower(trim($1)) AND anonymised_at IS NULL LIMIT 1`,
    [email],
  );
  return result.rows[0]?.id ?? null;
}

async function userExists(userId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND anonymised_at IS NULL LIMIT 1`, [userId]);
  return (result.rowCount ?? 0) > 0;
}

/** Exported for tests: the receipt goes to a real, non-anonymised account only. */
export async function loadReceiptRecipient(userId: string): Promise<{
  email: string;
  userName: string;
  balance: number;
} | null> {
  const result = await pool.query<{
    email: string;
    first_name: string | null;
    last_name: string | null;
    balance: number | null;
  }>(
    `SELECT u.email,
            u.first_name,
            u.last_name,
            COALESCE(b.balance, 0)::int AS balance
     FROM users u
     LEFT JOIN user_balances b ON b.user_id = u.id
     WHERE u.id = $1 AND u.anonymised_at IS NULL
     LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row?.email) return null;

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
export function queuePurchaseReceipt(params: {
  userId: string;
  creditsAdded: number;
  orderId: string;
  amountPaidCents: number;
  currency: string;
}): void {
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

      await sendPurchaseReceiptEmail(
        recipient.email,
        recipient.userName,
        params.creditsAdded,
        params.orderId,
        params.amountPaidCents / 100,
        recipient.balance,
        params.currency,
      );

      console.log("[email] Purchase receipt sent", {
        orderId: params.orderId,
        to: maskEmail(recipient.email),
      });
    } catch (error) {
      console.error("[email] Purchase receipt failed (credits already allocated)", {
        orderId: params.orderId,
        userId: params.userId,
        ...safeEmailErrorFields(error),
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
async function resolveUserId(
  customUserId: string | null,
  email: string | null | undefined,
): Promise<{ userId: string | null; via: string }> {
  if (customUserId) {
    if (!UUID_RE.test(customUserId)) {
      console.warn("[Webhook] custom_data.user_id is not a UUID — falling back to email");
    } else if (await userExists(customUserId)) {
      return { userId: customUserId, via: "custom_data.user_id" };
    } else {
      console.warn("[Webhook] custom_data.user_id not found in users — falling back to email");
    }
  }

  const trimmed = email?.trim();
  if (trimmed) {
    const byEmail = await findUserIdByEmail(trimmed);
    if (byEmail) {
      return { userId: byEmail, via: "order email fallback" };
    }
    console.error("[Webhook] No user matches the order email either", { email: maskEmail(trimmed) });
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
export function verifyAndParseLemonEvent(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): LemonOrderCreatedEvent {
  verifyLemonSqueezySignature(rawBody, signatureHeader);
  return parseLemonSqueezyEvent(rawBody);
}

export interface ProcessOutcome {
  processed: boolean;
  reason?: string;
  ledgerId?: string | null;
  userId?: string;
  packageId?: string;
  creditAmount?: number;
  variantId?: string | number | null;
  orderId?: string;
}

type LemonOrderAttributes = LemonOrderCreatedEvent["data"]["attributes"];

/**
 * A valid signature proves the event came from a webhook holding our secret, not that the order is a
 * real purchase in this store (SEC-13): test-mode orders are paid with test cards. Shared by
 * order_created and order_refunded. Returns the reason to ignore the event, or null.
 */
function orderOriginProblem(orderId: string, attrs: LemonOrderAttributes): string | null {
  if (attrs.test_mode === true && env.isProduction && !env.lemonSqueezyAllowTestMode) {
    console.warn("[Webhook] Ignoring test-mode order", { orderId });
    return "test_mode_order";
  }
  const storeId = env.lemonSqueezyStoreId;
  if (storeId && String(attrs.store_id ?? "") !== storeId) {
    console.error("[Webhook] Order from another store", { orderId, storeId: attrs.store_id ?? null });
    return "store_mismatch";
  }
  return null;
}

const isCents = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const timeOf = (v: unknown): number | null => (v == null ? null : v instanceof Date ? v.getTime() : Date.parse(String(v)));

interface RefundEvidence {
  refundedAmountUsd: number | null;
  currency: string;
  refundedAt: string | null;
  testMode: boolean;
}

/** Contract P3.3: a duplicate of the same key (order, status, amount) is a no-op only if every other stored field is equal. */
function sameRefundEvidence(
  stored: { refunded_amount_usd: unknown; currency: unknown; refunded_at: unknown; test_mode: unknown },
  incoming: RefundEvidence,
): boolean {
  return (
    (stored.refunded_amount_usd == null ? null : Number(stored.refunded_amount_usd)) === incoming.refundedAmountUsd &&
    String(stored.currency) === incoming.currency &&
    timeOf(stored.refunded_at) === timeOf(incoming.refundedAt) &&
    (stored.test_mode === true) === incoming.testMode
  );
}

/**
 * `order_refunded` (full or partial — Lemon documents no dispute/chargeback event): record it for
 * manual review (SEC-14). NEVER changes credits; refunded_orders_to_review() / db:reconcile list it.
 * Idempotent per refund state: Lemon sends no event id, so retries hit the unique key.
 *
 * V8 contract P3.3/P3.4: a row only for a confirmed `refunded` or `partial_refund` state (the shared reader), with
 * `fully_refunded` taken from the state, never from the raw flag. Every other state is a review stop and stores nothing;
 * the same refund key with different evidence is a review stop too (the first row is kept).
 */
/** Origin gate of a refund event: the reason to ignore it, or null (the default reads the environment; the V8 consumer reads the database policy, F-6). */
export type OriginCheck = (orderId: string, attrs: LemonOrderAttributes) => string | null;

async function recordLemonRefund(event: LemonOrderCreatedEvent, originCheck: OriginCheck = orderOriginProblem): Promise<ProcessOutcome> {
  const order = event.data;
  const attrs = order?.attributes;
  const orderId = lemonOrderId(order?.id);
  if (!orderId || !attrs) {
    console.error("[Webhook] Malformed refund payload — no usable order id or data.attributes");
    return { processed: false, reason: "malformed_payload" };
  }

  const originProblem = originCheck(orderId, attrs);
  if (originProblem) return { processed: false, reason: originProblem, orderId };

  const verdict = refundEventVerdict(readOrderPaymentState(attrs));
  if (verdict.kind === "review") {
    console.warn("[Webhook] Refund event stopped for review — nothing recorded", { orderId, review: verdict.description });
    throw reviewStop(verdict.description);
  }
  const currency = String(attrs.currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    console.error("[Webhook] Malformed refund payload", { orderId, refundedAmount: attrs.refunded_amount ?? null });
    return { processed: false, reason: "malformed_payload", orderId };
  }
  const refundedAmount = attrs.refunded_amount as number; // a positive integer: the state rule required it
  const evidence: RefundEvidence = {
    refundedAmountUsd: isCents(attrs.refunded_amount_usd) ? attrs.refunded_amount_usd : null,
    currency,
    refundedAt: typeof attrs.refunded_at === "string" && !Number.isNaN(Date.parse(attrs.refunded_at)) ? attrs.refunded_at : null,
    testMode: attrs.test_mode === true,
  };

  const { rowCount } = await pool.query(
    `INSERT INTO lemon_order_refunds
       (provider_order_id, order_status, fully_refunded, refunded_amount, refunded_amount_usd, currency, refunded_at, test_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT ON CONSTRAINT uq_lemon_order_refunds_state DO NOTHING`,
    [
      orderId,
      verdict.orderStatus,
      verdict.fullyRefunded,
      refundedAmount,
      evidence.refundedAmountUsd,
      currency,
      evidence.refundedAt,
      evidence.testMode,
    ],
  );
  const logFields = { orderId, status: verdict.orderStatus, refundedAmount, currency };
  if (!rowCount) {
    const { rows } = await pool.query<{ refunded_amount_usd: unknown; currency: unknown; refunded_at: unknown; test_mode: unknown }>(
      `SELECT refunded_amount_usd, currency, refunded_at, test_mode FROM lemon_order_refunds
       WHERE provider_order_id = $1 AND order_status = $2 AND refunded_amount = $3`,
      [orderId, verdict.orderStatus, refundedAmount],
    );
    if (rows[0] && sameRefundEvidence(rows[0], evidence)) {
      console.log("[Webhook] Refund already recorded", logFields);
      return { processed: false, reason: "already_recorded", orderId };
    }
    console.warn("[Webhook] Refund evidence differs from the recorded refund — first row kept, stopped for review", logFields);
    throw reviewStop(REVIEW_DESCRIPTIONS.refundEvidenceConflict);
  }
  console.warn("[Webhook] Recorded refund — credits NOT changed; review with db:reconcile", logFields);
  return { processed: true, reason: "refund_recorded", orderId };
}

/**
 * Stage 2 — ASYNCHRONOUS fulfilment. Runs AFTER the 200 OK has been flushed,
 * so its latency never holds the Lemon Squeezy delivery open.
 *
 * 1) Resolve user from `meta.custom_data.user_id` (fallback: order email)
 * 2) Resolve package from variant_id only (`custom_data` never selects what is credited)
 * 3) Credit the user via the immutable ledger (`CREDIT_PURCHASE`)
 *
 * Never throws for business-rule rejections — it returns a reason so the caller
 * can log it. Genuine faults (for example the database being unreachable) do
 * propagate, and the caller is responsible for catching them.
 */
export async function processLemonSqueezyEvent(
  event: LemonOrderCreatedEvent,
  options: { refundOrigin?: OriginCheck } = {},
): Promise<ProcessOutcome> {
  const eventName = event.meta?.event_name;

  if (eventName === "order_refunded") {
    return recordLemonRefund(event, options.refundOrigin);
  }
  if (eventName !== "order_created") {
    return { processed: false, reason: "ignored_event_type" };
  }

  const usableOrderId = lemonOrderId(event.data?.id);
  if (!usableOrderId) {
    console.error("[Webhook] Malformed order payload — missing or invalid order id");
    return { processed: false, reason: "malformed_payload" };
  }

  // F1 ledger-first (contract 5.1, site 5): before state, origin, package and user work. A credited order answers with the
  // ledger row's own user and amount (Q8), even if its buyer was anonymised since or the policy changed; no receipt is sent.
  const credit = await findOrderCredit(pool, ACTIVE_PAYMENT_PROVIDER, `ls_order_${usableOrderId}`);
  if (credit.kind === "credited") {
    console.log("[Webhook] Order already credited — not credited again", { orderId: usableOrderId, ledgerId: credit.ledgerId });
    return {
      processed: false,
      reason: "already_processed",
      ledgerId: credit.ledgerId,
      userId: credit.userId,
      creditAmount: credit.amount,
      orderId: usableOrderId,
    };
  }
  if (credit.kind === "ambiguous") {
    console.error("[Webhook] More than one historical manual credit for this order — stopped for review, nothing credited", {
      orderId: usableOrderId,
      historicalCredits: credit.historicalCount,
    });
    throw reviewStop(REVIEW_DESCRIPTIONS.historicalCreditAmbiguous);
  }

  const fields = readLemonOrderFields(event);
  if (!fields) {
    console.error("[Webhook] Malformed order payload — missing or invalid order id, data.attributes or test_mode", {
      orderId: usableOrderId,
    });
    return { processed: false, reason: "malformed_payload", orderId: usableOrderId };
  }
  const attrs = event.data.attributes;
  const order = { id: fields.orderId };

  // The shared provider-state reader (OP-15, contract P3.2): only `paid` continues; not paid and confirmed full refunds are
  // labels (N-2); partial refunds, fraudulent and unknown or contradictory states are review stops, never credited (OP-16 C).
  const state = orderCreatedStateVerdict(readOrderPaymentState(attrs));
  if (state.kind === "label") {
    console.log(state.outcome === "order_not_paid" ? "[Webhook] Ignoring non-paid order" : "[Webhook] Ignoring refunded order", {
      orderId: order.id,
    });
    return { processed: false, reason: state.outcome, orderId: order.id };
  }
  if (state.kind === "review") {
    console.warn("[Webhook] Order stopped for review — payment state", { orderId: order.id, review: state.description });
    throw reviewStop(state.description);
  }

  const originProblem = orderOriginProblem(order.id, attrs);
  if (originProblem) return { processed: false, reason: originProblem, orderId: order.id };

  // Contract P6.2: a refund recorded before the credit stops a later automatic credit (full or partial).
  const refunded = await pool.query(`SELECT 1 FROM lemon_order_refunds WHERE provider_order_id = $1 LIMIT 1`, [order.id]);
  if ((refunded.rowCount ?? 0) > 0) {
    console.warn("[Webhook] A refund is recorded for this order — stopped for review, nothing credited", { orderId: order.id });
    throw reviewStop(REVIEW_DESCRIPTIONS.refundBeforeCredit);
  }

  const custom = fields.customData;
  const customUserId = readCustomDataString(custom, "user_id");
  const customPackageId = readCustomDataString(custom, "package_id");
  const rawPendingOrderId = readCustomDataString(custom, "pending_order_id");
  // Only bookkeeping: a malformed value must never cost the buyer their credits (FINDING-10).
  let pendingOrderId: string | undefined;
  if (rawPendingOrderId && UUID_RE.test(rawPendingOrderId)) {
    pendingOrderId = rawPendingOrderId;
  } else if (rawPendingOrderId) {
    console.warn("[Webhook] custom_data.pending_order_id is not a UUID — ignoring it", {
      orderId: order.id,
    });
  }

  // The purchased variant alone decides the package, through server configuration (the same rule as the V7 contract's
  // credit_verified_purchase). custom_data is buyer-controlled on a store link (?checkout[custom][package_id]=...): falling back
  // to it would credit a pack for any product of the store that happens to have the same price.
  const variantId = fields.variantId;
  const packageId = packageIdForLemonVariant(variantId);
  if (packageId && customPackageId && customPackageId !== packageId) {
    console.warn("[Webhook] package_id / variant mismatch — using the purchased variant", {
      orderId: order.id,
      variantId,
      packageId,
    });
  }

  const { userId, via } = await resolveUserId(customUserId, fields.buyerEmail);

  console.log("[Webhook] Processing user:", userId, "for package:", packageId, {
    resolvedVia: via,
    variantId,
    orderEmail: maskEmail(fields.buyerEmail),
    orderId: order.id,
  });

  if (!packageId) {
    console.error("[Webhook] Unable to resolve package", { orderId: order.id, variantId });
    return { processed: false, reason: "unresolved_package", orderId: order.id };
  }

  const pkg = CREDIT_PACKAGES[packageId]!;

  if (!userId) {
    console.error("[Webhook] Missing user identity — no user_id match and no email match", {
      orderId: order.id,
      userEmail: maskEmail(fields.buyerEmail),
    });
    return { processed: false, reason: "missing_user", orderId: order.id };
  }

  if (fields.currency?.toLowerCase() !== "usd") {
    console.error("[Webhook] Unexpected currency", { orderId: order.id, currency: fields.currency });
    return { processed: false, reason: "currency_mismatch", orderId: order.id };
  }

  // Lemon `total` may include tax; accept subtotal or line item price when they match list price.
  const amountCandidates = [fields.totalCents, fields.subtotalCents, fields.itemPriceCents];

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
      orderId: order.id,
      amountPaidCents: pkg.priceUsdCents,
      currency: "USD",
    });
  } else {
    console.warn("[Webhook] Not credited", {
      orderId: order.id,
      userId,
      reason: result.reason ?? "unknown",
    });
  }

  // Q8: an `already_processed` answer carries the ledger row's own user and amount, never this event's (omitted when unknown).
  const already = result.reason === "already_processed";
  return {
    processed: result.processed,
    reason: result.reason,
    ledgerId: result.ledgerId,
    userId: already ? result.userId : userId,
    packageId: pkg.id,
    creditAmount: already ? result.creditAmount : pkg.credits,
    variantId,
    orderId: order.id,
  };
}

/** Health probe — verify DB connectivity for billing ops. */
export async function pingBillingDb(): Promise<void> {
  await pool.query("SELECT 1");
}
