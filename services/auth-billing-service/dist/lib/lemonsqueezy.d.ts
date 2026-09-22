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
/**
 * Lemon Squeezy webhook HMAC-SHA256 (hex) over the raw request body.
 * Header: `X-Signature`
 * Docs: https://docs.lemonsqueezy.com/help/webhooks/signing-requests
 *
 * Rejects with 401 when the header is missing or the digest does not match
 * (constant-time compare via `crypto.timingSafeEqual`).
 */
export declare function verifyLemonSqueezySignature(rawBody: Buffer, signatureHeader: string | undefined): void;
export declare function parseLemonSqueezyEvent(rawBody: Buffer): LemonOrderCreatedEvent;
/** Reverse-map a Lemon variant id to our package id (`starter` | `pro` | `enterprise`). */
export declare function packageIdForLemonVariant(variantId: string | number | null | undefined): string | null;
/** Coerce Lemon custom_data values (may arrive as string | number | boolean). */
export declare function readCustomDataString(custom: Record<string, unknown> | undefined, key: string): string | null;
export declare function createLemonSqueezyCheckoutUrl(params: LemonCheckoutParams & {
    pendingOrderId?: string;
}): Promise<string>;
