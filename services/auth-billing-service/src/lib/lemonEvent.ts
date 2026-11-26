/**
 * What a Lemon Squeezy webhook delivery is, with no environment and no database: the event shape, the signature check, the
 * parsing and the typed reading of an order. Shared by the main service (lib/lemonsqueezy.ts re-exports it) and by the separate
 * ingestion process (src/ingest), which must not import anything that reads the main service's environment (Step 7.5, O-1 B).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../types/index.js";

export interface LemonOrderCreatedEvent {
  meta: {
    event_name: string;
    custom_data?: Record<string, unknown>;
  };
  data: {
    id: string;
    type: string;
    attributes: {
      store_id: number;
      customer_id: number;
      identifier: string;
      order_number: number;
      status: string;
      currency: string;
      total: number;
      subtotal: number;
      tax: number;
      refunded: boolean;
      /** true for orders placed in Lemon's test mode (test cards — no money moves). */
      test_mode?: boolean;
      /** Refund state (order_refunded): cumulative refunded cents in the order currency / in USD. */
      refunded_amount?: number;
      refunded_amount_usd?: number;
      refunded_at?: string | null;
      user_email: string;
      first_order_item?: {
        variant_id: number;
        product_name: string;
        price?: number;
      };
    };
  };
}

/**
 * Lemon Squeezy webhook HMAC-SHA256 (hex) over the raw request body, with the secret passed in.
 * Header: `X-Signature`. Docs: https://docs.lemonsqueezy.com/help/webhooks/signing-requests
 *
 * Rejects with 401 when the header is missing or the digest does not match (constant-time compare).
 */
export function verifyLemonSignature(rawBody: Buffer, signatureHeader: string | undefined, webhookSecret: string): void {
  if (!signatureHeader?.trim()) {
    throw new AppError(401, "Missing X-Signature header.", "INVALID_SIGNATURE");
  }

  const digest = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.trim();

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(401, "Invalid Lemon Squeezy webhook signature.", "INVALID_SIGNATURE");
  }
}

export function parseLemonSqueezyEvent(rawBody: Buffer): LemonOrderCreatedEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid Lemon Squeezy webhook JSON.", "INVALID_WEBHOOK_BODY");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(400, "Invalid Lemon Squeezy webhook payload.", "INVALID_WEBHOOK_BODY");
  }

  return parsed as LemonOrderCreatedEvent;
}

const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The order id as text, or null when it is not a usable identifier. The ledger's idempotency key is built from it, so an object
 * or array must never be stringified into one: every such order would share the key `ls_order_[object Object]`.
 */
export function lemonOrderId(id: unknown): string | null {
  if (typeof id === "number" ? !Number.isSafeInteger(id) : typeof id !== "string") return null;
  const text = String(id);
  return ORDER_ID_RE.test(text) ? text : null;
}

/** The fields of an order that decide a purchase, each with a checked type. */
export interface LemonOrderFields {
  orderId: string;
  variantId: string | null;
  currency: string | null;
  totalCents: number | null;
  subtotalCents: number | null;
  itemPriceCents: number | null;
  buyerEmail: string | null;
  customData: Record<string, unknown>;
  /** Lemon store id as text (the payload sends a number). */
  storeId: string | null;
  /** null: absent or not a boolean (so neither live nor test is established). */
  testMode: boolean | null;
  // Payment state is not read here: readOrderPaymentState() is the one reader (OP-15).
}

const INT4_MAX = 2_147_483_647;
const centsOrNull = (n: unknown): number | null =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= INT4_MAX ? n : null;

/** Read the decisive fields of an order event. Null: the payload cannot be an order this service may credit (malformed). */
export function readLemonOrderFields(event: LemonOrderCreatedEvent): LemonOrderFields | null {
  const orderId = lemonOrderId(event.data?.id);
  const attrs = event.data?.attributes as unknown as Record<string, unknown> | null | undefined;
  if (!orderId || !attrs || typeof attrs !== "object") return null;
  // "true" or 1 must not read as a live order.
  if (attrs.test_mode !== undefined && typeof attrs.test_mode !== "boolean") return null;

  const item = (attrs.first_order_item ?? {}) as Record<string, unknown>;
  const custom: unknown = event.meta?.custom_data;
  const variant = item.variant_id;
  return {
    orderId,
    variantId: typeof variant === "number" || typeof variant === "string" ? String(variant).trim() || null : null,
    currency: typeof attrs.currency === "string" ? attrs.currency : null,
    totalCents: centsOrNull(attrs.total),
    subtotalCents: centsOrNull(attrs.subtotal),
    itemPriceCents: centsOrNull(item.price),
    buyerEmail: typeof attrs.user_email === "string" ? attrs.user_email : null,
    storeId: typeof attrs.store_id === "number" || typeof attrs.store_id === "string" ? String(attrs.store_id).trim() || null : null,
    testMode: typeof attrs.test_mode === "boolean" ? attrs.test_mode : null,
    customData: custom && typeof custom === "object" && !Array.isArray(custom) ? (custom as Record<string, unknown>) : {},
  };
}

/**
 * The provider's payment state of an order: the ONE reader shared by the ingestion process, the consumer and the refund recorder
 * (V8 contract, Part P3.2; OP-15). It normalises what Lemon documents and decides nothing about crediting. Lemon documents `status`
 * as "One of: pending, failed, paid, refunded, partial_refund, fraudulent", `refunded` as "true if the order has been fully refunded"
 * and `refunded_amount` as a positive integer in cents (checked 2026-11-26). An absent field is never read as `false` or 0, a
 * combination these rules do not name is `unknown`, and the event name is never evidence. `refunded_at` is never used to classify.
 */
export type OrderPaymentState = "paid" | "not_paid" | "refunded" | "partial_refund" | "fraudulent" | "unknown";

const isPositiveCents = (n: unknown): boolean => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
/** "absent or 0": missing, JSON null, or the number 0. Any other value (a string, a fraction, a positive amount) is not. */
const isAbsentOrZero = (n: unknown): boolean => n === undefined || n === null || n === 0;

export function readOrderPaymentState(attributes: unknown): OrderPaymentState {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return "unknown";
  const { status, refunded, refunded_amount: amount } = attributes as Record<string, unknown>;
  switch (status) {
    case "paid":
      // `refunded` must be present and false: its absence does not establish "not refunded".
      return refunded === false && isAbsentOrZero(amount) ? "paid" : "unknown";
    case "pending":
    case "failed":
      return (refunded === undefined || refunded === null || refunded === false) && isAbsentOrZero(amount) ? "not_paid" : "unknown";
    case "refunded":
      return refunded === true && isPositiveCents(amount) ? "refunded" : "unknown";
    case "partial_refund":
      // Never `refunded`: a partial refund is never treated as a full one (OP-16 C).
      return refunded === false && isPositiveCents(amount) ? "partial_refund" : "unknown";
    case "fraudulent":
      return "fraudulent";
    default:
      return "unknown";
  }
}

/**
 * The fixed `last_error` descriptions of a review stop (V8 contract, Part P4.3). The `review:` prefix is how the closing statement and
 * db:reconcile recognise a review stop, so this list is pinned by a test; nothing else may start with `review:`.
 */
export const REVIEW_DESCRIPTIONS = {
  historicalCreditAmbiguous: "review:historical_credit_ambiguous",
  blockedByReviewDecision: "review:blocked_by_review_decision",
  refundBeforeCredit: "review:refund_before_credit",
  partialRefund: "review:partial_refund",
  fraudulentStatus: "review:fraudulent_status",
  paymentStateUnknown: "review:payment_state_unknown",
  refundEventStateMismatch: "review:refund_event_state_mismatch",
  refundEvidenceConflict: "review:refund_evidence_conflict",
  /** I-6 ii: a claimed event whose stored message was cleared (OD-2 retention); it is never reconstructed. */
  payloadCleared: "review:payload_cleared",
} as const;
export type ReviewDescription = (typeof REVIEW_DESCRIPTIONS)[keyof typeof REVIEW_DESCRIPTIONS];

/** What an `order_created` event's payment state means (Part P3.3, first column; N-2): credit path, a label, or a review stop. */
export type OrderCreatedStateVerdict =
  | { kind: "creditable" }
  | { kind: "label"; outcome: "order_not_paid" | "order_refunded" }
  | { kind: "review"; description: ReviewDescription };

export function orderCreatedStateVerdict(state: OrderPaymentState): OrderCreatedStateVerdict {
  switch (state) {
    case "paid":
      return { kind: "creditable" };
    case "not_paid":
      return { kind: "label", outcome: "order_not_paid" };
    case "refunded":
      return { kind: "label", outcome: "order_refunded" };
    case "partial_refund":
      return { kind: "review", description: REVIEW_DESCRIPTIONS.partialRefund };
    case "fraudulent":
      return { kind: "review", description: REVIEW_DESCRIPTIONS.fraudulentStatus };
    default:
      return { kind: "review", description: REVIEW_DESCRIPTIONS.paymentStateUnknown };
  }
}

/**
 * What an `order_refunded` event's payment state means for the refund recorder (Part P3.3 second column, P3.4): a row only for a
 * confirmed `refunded` or `partial_refund`, with `fully_refunded` taken from the state (never from the raw flag); otherwise a review
 * stop and no row. A state that says "no refund" (paid, or not paid) contradicts the event.
 */
export type RefundEventVerdict =
  | { kind: "record"; orderStatus: "refunded" | "partial_refund"; fullyRefunded: boolean }
  | { kind: "review"; description: ReviewDescription };

export function refundEventVerdict(state: OrderPaymentState): RefundEventVerdict {
  switch (state) {
    case "refunded":
      return { kind: "record", orderStatus: "refunded", fullyRefunded: true };
    case "partial_refund":
      return { kind: "record", orderStatus: "partial_refund", fullyRefunded: false };
    case "paid":
    case "not_paid":
      return { kind: "review", description: REVIEW_DESCRIPTIONS.refundEventStateMismatch };
    case "fraudulent":
      return { kind: "review", description: REVIEW_DESCRIPTIONS.fraudulentStatus };
    default:
      return { kind: "review", description: REVIEW_DESCRIPTIONS.paymentStateUnknown };
  }
}

/** Coerce Lemon custom_data values (may arrive as string | number | boolean). */
export function readCustomDataString(
  custom: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!custom || !(key in custom)) return null;
  const value = custom[key];
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

