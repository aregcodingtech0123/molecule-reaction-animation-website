/**
 * What the ingestion process writes for one verified delivery: the typed columns of migration 022 (inbox section F) and the
 * `eligible` flag. Pure; no I/O.
 *
 * `eligible` means "verified at ingest": the delivery is an `order_created` whose provider state is `paid` (readOrderPaymentState), from this store, live (or test mode where
 * allowed), for a configured variant, in USD, with an amount that equals that variant's list price. It is NOT a crediting decision:
 * credit_verified_purchase() repeats every check against the policy tables when the event is consumed, and decides the user.
 * Anything that is not eligible is still stored (the main service records refunds and refusals from it) but can never credit.
 *
 * The package and its price come from server configuration only. Nothing in the payload names a credit amount.
 */
import { createHash } from "node:crypto";
import { CREDIT_PACKAGES } from "../config/packages.js";
import {
  lemonOrderId,
  readCustomDataString,
  readLemonOrderFields,
  readOrderPaymentState,
  type LemonOrderCreatedEvent,
  type OrderPaymentState,
} from "../lib/lemonEvent.js";

/** The log reason for each payment state that is not `paid` (Q9: detailed reasons live in the ingestion log only). */
const INELIGIBLE_STATE_REASON: Record<OrderPaymentState, string | null> = {
  paid: null,
  not_paid: "order_not_paid",
  refunded: "order_refunded",
  partial_refund: "partial_refund",
  fraudulent: "fraudulent_status",
  unknown: "payment_state_unknown",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IngestPolicy {
  storeId: string;
  variantToPackage: ReadonlyMap<string, string>;
  allowTestMode: boolean;
}

export interface IngestRow {
  bodySha256: Buffer;
  eventName: string;
  providerOrderId: string | null;
  payload: string;
  eligible: boolean;
  orderStoreId: string | null;
  orderTestMode: boolean | null;
  orderVariantId: string | null;
  orderCurrency: string | null;
  orderTotalCents: number | null;
  orderSubtotalCents: number | null;
  orderItemPriceCents: number | null;
  buyerUserId: string | null;
  buyerEmail: string | null;
  pendingOrderId: string | null;
  /** Why it is not eligible (a fixed code for the log); null when it is. */
  ineligibleReason: string | null;
}

/** A value that fits its column, or null (a longer value would fail the insert, and the delivery would never be stored). */
const fit = (value: string | null, max: number): string | null => (value !== null && value.length <= max ? value : null);

export function classifyDelivery(rawBody: Buffer, event: LemonOrderCreatedEvent, policy: IngestPolicy): IngestRow {
  const rawName = (event.meta as { event_name?: unknown } | undefined)?.event_name;
  const eventName = typeof rawName === "string" && rawName ? rawName.slice(0, 64) : "unknown";
  const base: IngestRow = {
    bodySha256: createHash("sha256").update(rawBody).digest(),
    eventName,
    providerOrderId: lemonOrderId(event.data?.id),
    payload: rawBody.toString("utf8"),
    eligible: false,
    orderStoreId: null,
    orderTestMode: null,
    orderVariantId: null,
    orderCurrency: null,
    orderTotalCents: null,
    orderSubtotalCents: null,
    orderItemPriceCents: null,
    buyerUserId: null,
    buyerEmail: null,
    pendingOrderId: null,
    ineligibleReason: "not_an_order_created_event",
  };
  if (eventName !== "order_created") return base;

  const fields = readLemonOrderFields(event);
  if (!fields) return { ...base, ineligibleReason: "malformed_payload" };

  const userId = readCustomDataString(fields.customData, "user_id");
  const pendingId = readCustomDataString(fields.customData, "pending_order_id");
  const row: IngestRow = {
    ...base,
    providerOrderId: fields.orderId,
    orderStoreId: fit(fields.storeId, 32),
    orderTestMode: fields.testMode,
    orderVariantId: fit(fields.variantId, 32),
    orderCurrency: fit(fields.currency, 8),
    orderTotalCents: fields.totalCents,
    orderSubtotalCents: fields.subtotalCents,
    orderItemPriceCents: fields.itemPriceCents,
    buyerUserId: userId && UUID_RE.test(userId) ? userId : null,
    buyerEmail: fit(fields.buyerEmail?.trim() || null, 320),
    pendingOrderId: pendingId && UUID_RE.test(pendingId) ? pendingId : null,
    ineligibleReason: null,
  };

  const refuse = (reason: string): IngestRow => ({ ...row, ineligibleReason: reason });
  // Only the provider state `paid` can be eligible (shared reader, V8 Part P3.2). An absent `refunded` no longer reads as "not refunded".
  const stateReason = INELIGIBLE_STATE_REASON[readOrderPaymentState(event.data?.attributes)];
  if (stateReason) return refuse(stateReason);
  if (row.orderStoreId === null || row.orderStoreId !== policy.storeId) return refuse("store_mismatch");
  if (row.orderTestMode === null) return refuse("test_mode_unknown");
  if (row.orderTestMode && !policy.allowTestMode) return refuse("test_mode_order");
  if (row.orderCurrency?.toLowerCase() !== "usd") return refuse("currency_mismatch");
  const packageId = row.orderVariantId === null ? undefined : policy.variantToPackage.get(row.orderVariantId);
  if (!packageId || !Object.hasOwn(CREDIT_PACKAGES, packageId)) return refuse("unresolved_package");
  // The row's CHECK needs all three amounts; a missing one cannot be eligible.
  const amounts = [row.orderTotalCents, row.orderSubtotalCents, row.orderItemPriceCents];
  if (amounts.some((n) => n === null)) return refuse("amount_missing");
  if (!amounts.some((n) => n === CREDIT_PACKAGES[packageId]!.priceUsdCents)) return refuse("amount_mismatch");

  return { ...row, eligible: true };
}
