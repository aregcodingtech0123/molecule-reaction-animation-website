/** Classic Shopier form callback / notify (urlencoded). */
export declare function handleShopierCallback(body: Record<string, unknown>): Promise<{
    processed: boolean;
    reason: "payment_not_successful";
    userId?: undefined;
} | {
    processed: boolean;
    reason: "missing_ids";
    userId?: undefined;
} | {
    processed: boolean;
    reason: "unknown_order";
    userId?: undefined;
} | {
    processed: boolean;
    reason: "already_processed";
    userId: string;
} | {
    processed: boolean;
    reason: "invalid_package_id";
    userId?: undefined;
} | {
    userId: string;
    creditAmount: number;
    provider: "shopier";
    processed: boolean;
    ledgerId: string | null;
    reason?: string;
}>;
/**
 * Optional REST webhook path when Shopier-Signature + raw JSON body are used.
 * Expects classic-compatible fields nested or flat; we normalize to callback shape.
 */
export declare function handleShopierRestWebhook(rawBody: Buffer, signatureHeader: string | undefined): Promise<{
    processed: boolean;
    reason: "payment_not_successful";
    userId?: undefined;
} | {
    processed: boolean;
    reason: "missing_ids";
    userId?: undefined;
} | {
    processed: boolean;
    reason: "unknown_order";
    userId?: undefined;
} | {
    processed: boolean;
    reason: "already_processed";
    userId: string;
} | {
    processed: boolean;
    reason: "invalid_package_id";
    userId?: undefined;
} | {
    userId: string;
    creditAmount: number;
    provider: "shopier";
    processed: boolean;
    ledgerId: string | null;
    reason?: string;
}>;
export declare function handleLemonSqueezyWebhook(rawBody: Buffer, signatureHeader: string | undefined): Promise<{
    processed: boolean;
    reason: "ignored_event_type";
    eventName: string;
    status?: undefined;
} | {
    processed: boolean;
    reason: "order_not_paid";
    status: string;
    eventName?: undefined;
} | {
    processed: boolean;
    reason: "order_refunded";
    eventName?: undefined;
    status?: undefined;
} | {
    processed: boolean;
    reason: "missing_custom_data";
    eventName?: undefined;
    status?: undefined;
} | {
    processed: boolean;
    reason: "invalid_package_id";
    eventName?: undefined;
    status?: undefined;
} | {
    processed: boolean;
    reason: "currency_mismatch";
    eventName?: undefined;
    status?: undefined;
} | {
    userId: string;
    creditAmount: number;
    provider: "lemonsqueezy";
    orderId: string;
    processed: boolean;
    ledgerId: string | null;
    reason?: string;
    eventName?: undefined;
    status?: undefined;
}>;
/** Health probe — verify DB connectivity for billing ops. */
export declare function pingBillingDb(): Promise<void>;
