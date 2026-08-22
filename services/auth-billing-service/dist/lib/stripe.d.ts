import Stripe from "stripe";
export declare function getStripe(): Stripe;
/**
 * Verify and parse a Stripe webhook event.
 * Unsigned payloads are accepted only when NODE_ENV=development AND ALLOW_UNSIGNED_WEBHOOKS=true.
 */
export declare function verifyStripeWebhook(rawBody: Buffer, signatureHeader: string | undefined): Stripe.Event;
export declare function extractCreditPackFromSession(session: Stripe.Checkout.Session): {
    userId: string;
    creditAmount: number;
};
