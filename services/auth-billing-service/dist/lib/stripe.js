import Stripe from "stripe";
import { env } from "../config/env.js";
import { AppError } from "../types/index.js";
let stripeClient = null;
export function getStripe() {
    if (!stripeClient) {
        if (!env.stripeSecretKey) {
            throw new Error("STRIPE_SECRET_KEY is not configured.");
        }
        stripeClient = new Stripe(env.stripeSecretKey);
    }
    return stripeClient;
}
function parseDevWebhookEvent(rawBody) {
    let parsed;
    try {
        parsed = JSON.parse(rawBody.toString("utf8"));
    }
    catch {
        throw new AppError(400, "Invalid webhook JSON body.", "INVALID_WEBHOOK_BODY");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new AppError(400, "Invalid webhook payload.", "INVALID_WEBHOOK_BODY");
    }
    const event = parsed;
    if (!event.type || !event.data?.object) {
        throw new AppError(400, "Webhook payload must include type and data.object.", "INVALID_WEBHOOK_BODY");
    }
    console.warn("[stripe] ALLOW_UNSIGNED_WEBHOOKS=true: webhook accepted without signature verification.");
    return event;
}
/**
 * Verify and parse a Stripe webhook event.
 * Unsigned payloads are accepted only when NODE_ENV=development AND ALLOW_UNSIGNED_WEBHOOKS=true.
 */
export function verifyStripeWebhook(rawBody, signatureHeader) {
    const isDev = env.nodeEnv === "development";
    const allowUnsigned = process.env.ALLOW_UNSIGNED_WEBHOOKS === "true";
    const hasSignature = Boolean(signatureHeader?.trim());
    const hasSecret = Boolean(env.stripeWebhookSecret?.trim());
    if (isDev && allowUnsigned && (!hasSignature || !hasSecret)) {
        return parseDevWebhookEvent(rawBody);
    }
    if (isDev && allowUnsigned && hasSignature && hasSecret) {
        try {
            return getStripe().webhooks.constructEvent(rawBody, signatureHeader, env.stripeWebhookSecret);
        }
        catch (err) {
            console.warn("[stripe] Development mode (ALLOW_UNSIGNED_WEBHOOKS): signature verification failed; parsing body as JSON.", err instanceof Error ? err.message : err);
            return parseDevWebhookEvent(rawBody);
        }
    }
    if (!hasSecret) {
        throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
    }
    if (!hasSignature) {
        throw new Error("Missing Stripe-Signature header.");
    }
    return getStripe().webhooks.constructEvent(rawBody, signatureHeader, env.stripeWebhookSecret);
}
export function extractCreditPackFromSession(session) {
    const userId = session.metadata?.userId ?? session.client_reference_id;
    if (!userId) {
        throw new Error("Checkout session missing userId.");
    }
    const creditAmount = Number(session.metadata?.creditAmount ?? session.metadata?.credits);
    if (!Number.isInteger(creditAmount) || creditAmount <= 0) {
        throw new Error("Checkout session missing valid creditAmount.");
    }
    return { userId, creditAmount };
}
//# sourceMappingURL=stripe.js.map