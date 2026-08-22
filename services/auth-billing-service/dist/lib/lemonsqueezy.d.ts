export interface LemonCheckoutParams {
    userId: string;
    userEmail: string;
    packageId: string;
    productName: string;
}
export interface LemonOrderCreatedEvent {
    meta: {
        event_name: string;
        custom_data?: Record<string, string | undefined>;
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
            };
        };
    };
}
/**
 * Lemon Squeezy webhook HMAC-SHA256 (hex) over the raw body.
 * Header: X-Signature
 * Docs: https://docs.lemonsqueezy.com/help/webhooks/signing-requests
 */
export declare function verifyLemonSqueezySignature(rawBody: Buffer, signatureHeader: string | undefined): void;
export declare function parseLemonSqueezyEvent(rawBody: Buffer): LemonOrderCreatedEvent;
export declare function createLemonSqueezyCheckoutUrl(params: LemonCheckoutParams & {
    pendingOrderId?: string;
}): Promise<string>;
