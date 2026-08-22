import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../types/index.js";

export const SHOPIER_PAYMENT_URL = "https://www.shopier.com/ShowProduct/api_pay4.php";

/** Classic Shopier currency code: 0 = TRY */
export const SHOPIER_CURRENCY_TRY = "0";

export interface ShopierCheckoutFields {
  API_key: string;
  website_index: string;
  platform_order_id: string;
  product_name: string;
  product_type: string;
  buyer_name: string;
  buyer_account_age: string;
  buyer_id_nr: string;
  buyer_email: string;
  buyer_phone: string;
  billing_address: string;
  billing_city: string;
  billing_country: string;
  billing_postcode: string;
  shipping_address: string;
  shipping_city: string;
  shipping_country: string;
  shipping_postcode: string;
  total_order_value: string;
  currency: string;
  platform: string;
  is_in_frame: string;
  current_language: string;
  modul_version: string;
  random_nr: string;
  signature: string;
  callback: string;
}

export interface ShopierPaymentPayload {
  action: string;
  fields: ShopierCheckoutFields;
}

export interface ShopierCallbackPayload {
  platform_order_id: string;
  status: string;
  payment_id: string;
  installment: string;
  random_nr: string;
  signature: string;
  total_order_value: string;
  currency: string;
}

function requireShopierCredentials(): { apiKey: string; apiSecret: string } {
  const apiKey = env.shopierApiKey;
  const apiSecret = env.shopierApiSecret;
  if (!apiKey || !apiSecret) {
    throw new AppError(503, "Shopier is not configured.", "SHOPIER_NOT_CONFIGURED");
  }
  return { apiKey, apiSecret };
}

/**
 * Classic Shopier HMAC-SHA256 signature (initiation + callback).
 *
 * Payload string (exact concatenation, no separators):
 *   random_nr + platform_order_id + total_order_value + currency
 *
 * Key: SHOPIER_API_SECRET
 * Output: Base64(HMAC-SHA256(...))
 *
 * Notes:
 * - API_key is sent as a form field; it is NOT part of the HMAC message.
 * - currency for TRY is the string "0" (Shopier numeric currency code).
 * - total_order_value is a decimal string e.g. "199.00" (not kuruş).
 */
export function buildShopierSignature(
  randomNr: string,
  platformOrderId: string,
  totalOrderValue: string,
  currency: string,
  apiSecret: string,
): string {
  if (!randomNr || !platformOrderId || !totalOrderValue || currency === "") {
    throw new AppError(400, "Incomplete Shopier signature inputs.", "INVALID_SHOPIER_SIGNATURE_INPUT");
  }

  const message = `${randomNr}${platformOrderId}${totalOrderValue}${currency}`;
  return createHmac("sha256", apiSecret).update(message, "utf8").digest("base64");
}

/**
 * Prepare the Shopier hosted-payment form payload for the Next.js client.
 * Client must POST `fields` to `action` (auto-submit hidden form).
 */
export function prepareShopierPaymentPayload(params: {
  platformOrderId: string;
  productName: string;
  /** Decimal TRY amount, e.g. "199.00" */
  totalOrderValue: string;
  buyerEmail: string;
  buyerName: string;
  buyerId: string;
}): ShopierPaymentPayload {
  const { apiKey, apiSecret } = requireShopierCredentials();

  const randomNr = String(randomInt(100_000, 999_999));
  const currency = SHOPIER_CURRENCY_TRY;

  let signature: string;
  try {
    signature = buildShopierSignature(
      randomNr,
      params.platformOrderId,
      params.totalOrderValue,
      currency,
      apiSecret,
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, "Failed to sign Shopier payment.", "SHOPIER_SIGN_FAILED");
  }

  const fields: ShopierCheckoutFields = {
    API_key: apiKey,
    website_index: env.shopierWebsiteIndex,
    platform_order_id: params.platformOrderId,
    product_name: params.productName.slice(0, 255),
    product_type: "1",
    buyer_name: (params.buyerName || "Customer").slice(0, 60),
    buyer_account_age: "0",
    buyer_id_nr: params.buyerId.slice(0, 50),
    buyer_email: params.buyerEmail,
    buyer_phone: "1111111111",
    billing_address: "N/A",
    billing_city: "Istanbul",
    billing_country: "TR",
    billing_postcode: "34000",
    shipping_address: "N/A",
    shipping_city: "Istanbul",
    shipping_country: "TR",
    shipping_postcode: "34000",
    total_order_value: params.totalOrderValue,
    currency,
    platform: "0",
    is_in_frame: "0",
    current_language: "tr",
    modul_version: "1.0.4",
    random_nr: randomNr,
    signature,
    // Browser return URL (UX). Server-side fulfillment uses notify/callback webhook.
    callback: `${env.frontendUrl.replace(/\/+$/, "")}/dashboard?billing=success`,
  };

  return { action: SHOPIER_PAYMENT_URL, fields };
}

/** @deprecated Prefer prepareShopierPaymentPayload */
export function createShopierCheckoutForm(
  params: Parameters<typeof prepareShopierPaymentPayload>[0],
): ShopierPaymentPayload {
  return prepareShopierPaymentPayload(params);
}

/**
 * Strict callback signature verification (timing-safe).
 * Rejects tampered / spoofed Shopier notify payloads.
 */
export function verifyShopierCallbackSignature(payload: ShopierCallbackPayload): boolean {
  let apiSecret: string;
  try {
    ({ apiSecret } = requireShopierCredentials());
  } catch {
    return false;
  }

  if (
    !payload.random_nr ||
    !payload.platform_order_id ||
    !payload.total_order_value ||
    payload.currency === "" ||
    !payload.signature
  ) {
    return false;
  }

  const message = `${payload.random_nr}${payload.platform_order_id}${payload.total_order_value}${payload.currency}`;
  const expected = createHmac("sha256", apiSecret).update(message, "utf8").digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(payload.signature, "base64");
  } catch {
    return false;
  }

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

/**
 * Optional REST webhook verification (`Shopier-Signature` HMAC-SHA256 hex of raw body).
 */
export function verifyShopierRestWebhook(rawBody: Buffer, signatureHeader: string | undefined): void {
  const token = env.shopierWebhookToken || env.shopierApiSecret;
  if (!token) {
    throw new AppError(503, "Shopier webhook secret is not configured.", "SHOPIER_NOT_CONFIGURED");
  }
  if (!signatureHeader?.trim()) {
    throw new AppError(401, "Missing Shopier-Signature header.", "INVALID_SIGNATURE");
  }

  const digest = createHmac("sha256", token).update(rawBody).digest("hex");
  const provided = signatureHeader.trim().replace(/^sha256=/i, "");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(401, "Invalid Shopier webhook signature.", "INVALID_SIGNATURE");
  }
}

export function parseShopierCallbackBody(body: Record<string, unknown>): ShopierCallbackPayload {
  const pick = (key: string): string => {
    const value = body[key];
    return typeof value === "string" ? value : value != null ? String(value) : "";
  };

  return {
    platform_order_id: pick("platform_order_id"),
    status: pick("status"),
    payment_id: pick("payment_id"),
    installment: pick("installment"),
    random_nr: pick("random_nr"),
    signature: pick("signature"),
    total_order_value: pick("total_order_value"),
    currency: pick("currency"),
  };
}

export function isShopierPaymentApproved(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "success" || normalized === "approved";
}
