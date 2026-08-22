import type Stripe from "stripe";
export declare function handleStripeWebhookEvent(event: Stripe.Event): Promise<{
    processed: boolean;
    reason: "already_processed";
    result?: undefined;
} | {
    processed: boolean;
    reason: "ignored_event_type";
    result?: undefined;
} | {
    processed: boolean;
    result: import("../types/index.js").LedgerMutationResult;
    reason?: undefined;
}>;
export declare function grantCreditsFromAuth(params: {
    userId: string;
    amount: number;
    reason: string;
    eventId?: string;
}): Promise<import("../types/index.js").LedgerMutationResult>;
//# sourceMappingURL=billing.service.d.ts.map