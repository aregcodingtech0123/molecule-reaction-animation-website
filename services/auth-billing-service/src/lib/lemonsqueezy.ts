import { createHmac, timingSafeEqual } from "node:crypto";
import { env, lemonVariantForPackage } from "../config/env.js";
import { AppError } from "../types/index.js";

const LEMON_API_BASE = "https://api.lemonsqueezy.com/v1";

export interface LemonCheckoutParams {
  userId: string;
  userEmail: string;
  packageId: string;
  productName: string;
  /** Credits granted by this package — embedded in the post-checkout redirect URL. */
  credits: number;
  /** Same-origin pathname to return to after payment (e.g. `/pricing`). */
  returnPath?: string;
}

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
      user_email: string;
      first_order_item?: {
        variant_id: number;
        product_name: string;
        price?: number;
      };
    };
  };
}

function requireLemonApiConfig(): { apiKey: string; storeId: string } {
  const apiKey = env.lemonSqueezyApiKey;
  const storeId = env.lemonSqueezyStoreId;
  if (!apiKey || !storeId) {
    throw new AppError(503, "Lemon Squeezy is not configured.", "LEMONSQUEEZY_NOT_CONFIGURED");
  }
  return { apiKey, storeId };
}

function requireWebhookSecret(): string {
  const webhookSecret = env.lemonSqueezyWebhookSecret;
  if (!webhookSecret) {
    throw new AppError(
      503,
      "LEMONSQUEEZY_WEBHOOK_SECRET is not configured.",
      "LEMONSQUEEZY_NOT_CONFIGURED",
    );
  }
  return webhookSecret;
}

/**
 * Lemon Squeezy webhook HMAC-SHA256 (hex) over the raw request body.
 * Header: `X-Signature`
 * Docs: https://docs.lemonsqueezy.com/help/webhooks/signing-requests
 *
 * Rejects with 401 when the header is missing or the digest does not match
 * (constant-time compare via `crypto.timingSafeEqual`).
 */
export function verifyLemonSqueezySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): void {
  const webhookSecret = requireWebhookSecret();
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

  if (!parsed || typeof parsed !== "object") {
    throw new AppError(400, "Invalid Lemon Squeezy webhook payload.", "INVALID_WEBHOOK_BODY");
  }

  return parsed as LemonOrderCreatedEvent;
}

/** Reverse-map a Lemon variant id to our package id (`starter` | `pro` | `enterprise`). */
export function packageIdForLemonVariant(variantId: string | number | null | undefined): string | null {
  if (variantId === null || variantId === undefined) return null;
  const id = String(variantId).trim();
  if (!id) return null;

  // Environment only (FINDING-13): no hard-coded ids that would credit packs in
  // every environment. Production refuses to start without all three.
  const pairs: Array<[string, string]> = [
    [env.lemonSqueezyVariantStarter, "starter"],
    [env.lemonSqueezyVariantPro, "pro"],
    [env.lemonSqueezyVariantEnterprise, "enterprise"],
  ];

  for (const [variant, packageId] of pairs) {
    if (variant && variant === id) return packageId;
  }
  return null;
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

function sanitizeReturnPath(raw: string | undefined): string {
  if (!raw) return "/dashboard";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/dashboard";
  const pathOnly = trimmed.split("?")[0]?.split("#")[0] ?? "/dashboard";
  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//") || pathOnly.length > 200) {
    return "/dashboard";
  }
  return pathOnly || "/dashboard";
}

function requireLemonCheckoutConfig(packageId: string): { apiKey: string; storeId: string; variantId: string } {
  const { apiKey, storeId } = requireLemonApiConfig();
  const variantId = lemonVariantForPackage(packageId);
  if (!variantId) {
    throw new AppError(
      503,
      `Lemon Squeezy variant is not configured for package "${packageId}".`,
      "LEMONSQUEEZY_VARIANT_MISSING",
    );
  }
  return { apiKey, storeId, variantId };
}

/** Throws the same 503s as a checkout would — before anything is written. */
export function assertLemonCheckoutConfigured(packageId: string): void {
  requireLemonCheckoutConfig(packageId);
}

export async function createLemonSqueezyCheckoutUrl(
  params: LemonCheckoutParams & { pendingOrderId?: string },
): Promise<string> {
  const { apiKey, storeId, variantId } = requireLemonCheckoutConfig(params.packageId);

  const credits = Math.max(0, Math.floor(params.credits));
  const returnPath = sanitizeReturnPath(params.returnPath);
  const redirectUrl = `${env.frontendUrl}${returnPath}?payment=success&credits=${credits}`;

  const custom: Record<string, string> = {
    user_id: params.userId,
    package_id: params.packageId,
  };
  if (params.pendingOrderId) {
    custom.pending_order_id = params.pendingOrderId;
  }

  const res = await fetch(`${LEMON_API_BASE}/checkouts`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: params.userEmail,
            custom,
          },
          product_options: {
            redirect_url: redirectUrl,
            name: params.productName,
          },
          checkout_options: {
            embed: false,
            media: false,
            logo: true,
          },
        },
        relationships: {
          store: {
            data: { type: "stores", id: storeId },
          },
          variant: {
            data: { type: "variants", id: variantId },
          },
        },
      },
    }),
  });

  const json = (await res.json()) as {
    data?: { attributes?: { url?: string } };
    errors?: Array<{ detail?: string; title?: string }>;
  };

  if (!res.ok) {
    const detail = json.errors?.[0]?.detail ?? json.errors?.[0]?.title ?? `HTTP ${res.status}`;
    console.error("[lemonsqueezy] checkout create failed:", detail);
    throw new AppError(502, "Unable to create Lemon Squeezy checkout.", "LEMONSQUEEZY_CHECKOUT_FAILED");
  }

  const url = json.data?.attributes?.url;
  if (!url) {
    throw new AppError(502, "Lemon Squeezy did not return a checkout URL.", "LEMONSQUEEZY_CHECKOUT_FAILED");
  }

  return url;
}
