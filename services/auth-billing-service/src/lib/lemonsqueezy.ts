import { env, lemonVariantForPackage } from "../config/env.js";
import { AppError } from "../types/index.js";
import { verifyLemonSignature, type LemonOrderCreatedEvent } from "./lemonEvent.js";

export {
  lemonOrderId,
  parseLemonSqueezyEvent,
  readCustomDataString,
  readLemonOrderFields,
  verifyLemonSignature,
  type LemonOrderCreatedEvent,
  type LemonOrderFields,
} from "./lemonEvent.js";

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

/** HMAC check with the configured secret (503 when unset). See verifyLemonSignature. */
export function verifyLemonSqueezySignature(rawBody: Buffer, signatureHeader: string | undefined): void {
  const webhookSecret = requireWebhookSecret();
  verifyLemonSignature(rawBody, signatureHeader, webhookSecret);
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

/** A JSON:API source pointer that can only be a path of field names, such as /data/attributes/checkout_data/email. */
const FIELD_POINTER = /^(\/[a-z0-9_]{1,32}){1,8}$/;

function checkoutFailureCategory(status: number): string {
  if (status === 400 || status === 422) return "validation";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "provider_error" : "other";
}

/**
 * What to log about a refused checkout. Never Lemon's `detail` or `title`: they are the provider's free text, answering a request
 * that holds the customer's e-mail, the user id, the order id and the redirect URL. The status, category and field say what to look at.
 */
function safeCheckoutFailureFields(status: number, errors: unknown) {
  const list: unknown[] = Array.isArray(errors) ? errors : [];
  const pointer = (list[0] as { source?: { pointer?: unknown } } | null | undefined)?.source?.pointer;
  return {
    providerStatus: status,
    category: checkoutFailureCategory(status),
    providerErrorCount: list.length,
    field: typeof pointer === "string" && FIELD_POINTER.test(pointer) ? pointer : null,
  };
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
    errors?: unknown;
  };

  if (!res.ok) {
    console.error("[lemonsqueezy] checkout create failed:", safeCheckoutFailureFields(res.status, json.errors));
    throw new AppError(502, "Unable to create Lemon Squeezy checkout.", "LEMONSQUEEZY_CHECKOUT_FAILED");
  }

  const url = json.data?.attributes?.url;
  if (!url) {
    throw new AppError(502, "Lemon Squeezy did not return a checkout URL.", "LEMONSQUEEZY_CHECKOUT_FAILED");
  }

  return url;
}
