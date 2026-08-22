import { resolveCreditPackage } from "../config/packages.js";
import {
  isShopierPaymentApproved,
  parseShopierCallbackBody,
  verifyShopierCallbackSignature,
  verifyShopierRestWebhook,
  type ShopierCallbackPayload,
} from "../lib/shopier.js";
import {
  parseLemonSqueezyEvent,
  verifyLemonSqueezySignature,
} from "../lib/lemonsqueezy.js";
import {
  fulfillVerifiedPurchase,
  getPendingOrderById,
} from "./checkout.service.js";
import { AppError } from "../types/index.js";
import { pool } from "../db/index.js";

/** Classic Shopier form callback / notify (urlencoded). */
export async function handleShopierCallback(body: Record<string, unknown>) {
  const payload = parseShopierCallbackBody(body);

  if (!verifyShopierCallbackSignature(payload)) {
    console.error("[webhook/shopier] Invalid signature", {
      platformOrderId: payload.platform_order_id,
      paymentId: payload.payment_id,
    });
    throw new AppError(401, "Invalid Shopier signature.", "INVALID_SIGNATURE");
  }

  return fulfillShopierPayload(payload);
}

/**
 * Optional REST webhook path when Shopier-Signature + raw JSON body are used.
 * Expects classic-compatible fields nested or flat; we normalize to callback shape.
 */
export async function handleShopierRestWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
) {
  verifyShopierRestWebhook(rawBody, signatureHeader);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid Shopier webhook JSON.", "INVALID_WEBHOOK_BODY");
  }

  const root = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;

  const payload: ShopierCallbackPayload = {
    platform_order_id: String(data.platform_order_id ?? data.platformOrderId ?? ""),
    status: String(data.status ?? "success"),
    payment_id: String(data.payment_id ?? data.paymentId ?? data.id ?? ""),
    installment: String(data.installment ?? "0"),
    random_nr: String(data.random_nr ?? data.randomNr ?? ""),
    signature: String(data.signature ?? ""),
    total_order_value: String(data.total_order_value ?? data.totalOrderValue ?? ""),
    currency: String(data.currency ?? "0"),
  };

  // REST path already verified HMAC over body; classic field signature may be absent.
  if (payload.signature && !verifyShopierCallbackSignature(payload)) {
    throw new AppError(401, "Invalid Shopier nested signature.", "INVALID_SIGNATURE");
  }

  return fulfillShopierPayload(payload);
}

async function fulfillShopierPayload(payload: ShopierCallbackPayload) {
  if (!isShopierPaymentApproved(payload.status)) {
    if (payload.platform_order_id) {
      await pool.query(
        `UPDATE pending_checkout_orders SET status = 'failed' WHERE id = $1 AND status = 'pending'`,
        [payload.platform_order_id],
      );
    }
    return { processed: false, reason: "payment_not_successful" as const };
  }

  if (!payload.platform_order_id || !payload.payment_id) {
    return { processed: false, reason: "missing_ids" as const };
  }

  const pending = await getPendingOrderById(payload.platform_order_id);
  if (!pending || pending.provider !== "shopier") {
    console.error("[webhook/shopier] Unknown platform_order_id", {
      platformOrderId: payload.platform_order_id,
    });
    return { processed: false, reason: "unknown_order" as const };
  }

  if (pending.status === "completed") {
    return { processed: false, reason: "already_processed" as const, userId: pending.user_id };
  }

  let pkg;
  try {
    pkg = resolveCreditPackage(pending.package_id);
  } catch {
    return { processed: false, reason: "invalid_package_id" as const };
  }

  const actualMajor = Number.parseFloat(payload.total_order_value);
  const actualMinor = Number.isFinite(actualMajor)
    ? Math.round(actualMajor * 100)
    : Number.NaN;

  const result = await fulfillVerifiedPurchase({
    userId: pending.user_id,
    packageId: pending.package_id,
    credits: pending.credits || pkg.credits,
    provider: "shopier",
    paymentReference: `shopier_${payload.payment_id}`,
    pendingOrderId: pending.id,
    expectedAmountMinor: pending.amount_minor,
    actualAmountMinor: actualMinor,
    currency: "TRY",
  });

  return {
    ...result,
    userId: pending.user_id,
    creditAmount: pending.credits,
    provider: "shopier" as const,
  };
}

export async function handleLemonSqueezyWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
) {
  verifyLemonSqueezySignature(rawBody, signatureHeader);
  const event = parseLemonSqueezyEvent(rawBody);

  const eventName = event.meta?.event_name;
  if (eventName !== "order_created") {
    return { processed: false, reason: "ignored_event_type" as const, eventName };
  }

  const order = event.data;
  const attrs = order?.attributes;
  if (!order?.id || !attrs) {
    throw new AppError(400, "Malformed Lemon Squeezy order payload.", "INVALID_WEBHOOK_BODY");
  }

  if (attrs.status !== "paid") {
    return { processed: false, reason: "order_not_paid" as const, status: attrs.status };
  }

  if (attrs.refunded) {
    return { processed: false, reason: "order_refunded" as const };
  }

  const custom = event.meta.custom_data ?? {};
  const userId = custom.user_id?.trim();
  const packageId = custom.package_id?.trim();
  const pendingOrderId = custom.pending_order_id?.trim();

  if (!userId || !packageId) {
    console.error("[webhook/lemonsqueezy] Fraud alert: missing custom_data", {
      orderId: order.id,
      custom,
    });
    return { processed: false, reason: "missing_custom_data" as const };
  }

  let pkg;
  try {
    pkg = resolveCreditPackage(packageId);
  } catch {
    console.error("[webhook/lemonsqueezy] Fraud alert: invalid package_id", {
      orderId: order.id,
      packageId,
    });
    return { processed: false, reason: "invalid_package_id" as const };
  }

  if (attrs.currency?.toLowerCase() !== "usd") {
    console.error("[webhook/lemonsqueezy] Unexpected currency", {
      orderId: order.id,
      currency: attrs.currency,
    });
    return { processed: false, reason: "currency_mismatch" as const };
  }

  const result = await fulfillVerifiedPurchase({
    userId,
    packageId,
    credits: pkg.credits,
    provider: "lemonsqueezy",
    paymentReference: `ls_order_${order.id}`,
    pendingOrderId,
    expectedAmountMinor: pkg.priceUsdCents,
    actualAmountMinor: attrs.total,
    currency: "USD",
  });

  return {
    ...result,
    userId,
    creditAmount: pkg.credits,
    provider: "lemonsqueezy" as const,
    orderId: order.id,
  };
}

/** Health probe — verify DB connectivity for billing ops. */
export async function pingBillingDb(): Promise<void> {
  await pool.query("SELECT 1");
}
