import Stripe from "stripe";
export declare function getStripe(): Stripe;
/**
 * Cryptographically verifies the Stripe webhook signature against the raw body.
 * Must receive the unparsed request buffer — not JSON-parsed body.
 */
export declare function verifyStripeWebhook(rawBody: Buffer, signatureHeader: string | undefined): Stripe.Event;
export declare function extractCreditPackFromSession(session: Stripe.Checkout.Session): {
    userId: string;
    creditAmount: number;
};
//# sourceMappingURL=stripe.d.ts.map