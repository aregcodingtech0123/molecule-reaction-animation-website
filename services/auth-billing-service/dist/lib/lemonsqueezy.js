import { createHmac, timingSafeEqual } from "node:crypto";
import { env, lemonVariantForPackage } from "../config/env.js";
import { AppError } from "../types/index.js";
const LEMON_API_BASE = "https://api.lemonsqueezy.com/v1";
function requireLemonConfig() {
    const apiKey = env.lemonSqueezyApiKey;
    const storeId = env.lemonSqueezyStoreId;
    const webhookSecret = env.lemonSqueezyWebhookSecret;
    if (!apiKey || !storeId) {
        throw new AppError(503, "Lemon Squeezy is not configured.", "LEMONSQUEEZY_NOT_CONFIGURED");
    }
    return { apiKey, storeId, webhookSecret };
}
/**
 * Lemon Squeezy webhook HMAC-SHA256 (hex) over the raw body.
 * Header: X-Signature
 * Docs: https://docs.lemonsqueezy.com/help/webhooks/signing-requests
 */
export function verifyLemonSqueezySignature(rawBody, signatureHeader) {
    const { webhookSecret } = requireLemonConfig();
    if (!webhookSecret) {
        throw new AppError(503, "LEMONSQUEEZY_WEBHOOK_SECRET is not configured.", "LEMONSQUEEZY_NOT_CONFIGURED");
    }
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
export function parseLemonSqueezyEvent(rawBody) {
    let parsed;
    try {
        parsed = JSON.parse(rawBody.toString("utf8"));
    }
    catch {
        throw new AppError(400, "Invalid Lemon Squeezy webhook JSON.", "INVALID_WEBHOOK_BODY");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new AppError(400, "Invalid Lemon Squeezy webhook payload.", "INVALID_WEBHOOK_BODY");
    }
    return parsed;
}
export async function createLemonSqueezyCheckoutUrl(params) {
    const { apiKey, storeId } = requireLemonConfig();
    const variantId = lemonVariantForPackage(params.packageId);
    if (!variantId) {
        throw new AppError(503, `Lemon Squeezy variant is not configured for package "${params.packageId}".`, "LEMONSQUEEZY_VARIANT_MISSING");
    }
    const redirectUrl = `${env.frontendUrl}/dashboard?billing=success`;
    const custom = {
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
    const json = (await res.json());
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
//# sourceMappingURL=lemonsqueezy.js.map