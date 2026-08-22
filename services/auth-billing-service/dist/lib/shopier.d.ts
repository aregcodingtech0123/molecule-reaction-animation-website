export declare const SHOPIER_PAYMENT_URL = "https://www.shopier.com/ShowProduct/api_pay4.php";
/** Classic Shopier currency code: 0 = TRY */
export declare const SHOPIER_CURRENCY_TRY = "0";
export interface ShopierCheckoutFields {
    API_key: string;
    website_index: string;
    platform_order_id: string;
    product_name: string;
    product_type: string;
    buyer_name: string;
    buyer_account_age: string;
    buyer_id_nr: string;
    buyer_email: string;
    buyer_phone: string;
    billing_address: string;
    billing_city: string;
    billing_country: string;
    billing_postcode: string;
    shipping_address: string;
    shipping_city: string;
    shipping_country: string;
    shipping_postcode: string;
    total_order_value: string;
    currency: string;
    platform: string;
    is_in_frame: string;
    current_language: string;
    modul_version: string;
    random_nr: string;
    signature: string;
    callback: string;
}
export interface ShopierPaymentPayload {
    action: string;
    fields: ShopierCheckoutFields;
}
export interface ShopierCallbackPayload {
    platform_order_id: string;
    status: string;
    payment_id: string;
    installment: string;
    random_nr: string;
    signature: string;
    total_order_value: string;
    currency: string;
}
/**
 * Classic Shopier HMAC-SHA256 signature (initiation + callback).
 *
 * Payload string (exact concatenation, no separators):
 *   random_nr + platform_order_id + total_order_value + currency
 *
 * Key: SHOPIER_API_SECRET
 * Output: Base64(HMAC-SHA256(...))
 *
 * Notes:
 * - API_key is sent as a form field; it is NOT part of the HMAC message.
 * - currency for TRY is the string "0" (Shopier numeric currency code).
 * - total_order_value is a decimal string e.g. "199.00" (not kuruş).
 */
export declare function buildShopierSignature(randomNr: string, platformOrderId: string, totalOrderValue: string, currency: string, apiSecret: string): string;
/**
 * Prepare the Shopier hosted-payment form payload for the Next.js client.
 * Client must POST `fields` to `action` (auto-submit hidden form).
 */
export declare function prepareShopierPaymentPayload(params: {
    platformOrderId: string;
    productName: string;
    /** Decimal TRY amount, e.g. "199.00" */
    totalOrderValue: string;
    buyerEmail: string;
    buyerName: string;
    buyerId: string;
}): ShopierPaymentPayload;
/** @deprecated Prefer prepareShopierPaymentPayload */
export declare function createShopierCheckoutForm(params: Parameters<typeof prepareShopierPaymentPayload>[0]): ShopierPaymentPayload;
/**
 * Strict callback signature verification (timing-safe).
 * Rejects tampered / spoofed Shopier notify payloads.
 */
export declare function verifyShopierCallbackSignature(payload: ShopierCallbackPayload): boolean;
/**
 * Optional REST webhook verification (`Shopier-Signature` HMAC-SHA256 hex of raw body).
 */
export declare function verifyShopierRestWebhook(rawBody: Buffer, signatureHeader: string | undefined): void;
export declare function parseShopierCallbackBody(body: Record<string, unknown>): ShopierCallbackPayload;
export declare function isShopierPaymentApproved(status: string): boolean;
