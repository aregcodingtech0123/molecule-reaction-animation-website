import type { PaymentProvider } from "../config/packages.js";
import { type BillingRegion } from "../config/packages.js";
export type CheckoutMode = "redirect" | "shopier_form";
export interface CheckoutResult {
    provider: PaymentProvider;
    currency: "TRY" | "USD";
    region: BillingRegion;
    mode: CheckoutMode;
    /** Present for Lemon Squeezy (and any redirect-based provider). */
    checkoutUrl?: string;
    /** Present for Shopier classic hosted form auto-submit. */
    shopierForm?: {
        action: string;
        fields: Record<string, string>;
    };
    orderId: string;
}
export declare function createUnifiedCheckout(params: {
    userId: string;
    userEmail: string;
    packageId: unknown;
    regionOrCurrency: unknown;
    buyerName?: string;
}): Promise<CheckoutResult>;
export interface FulfillPurchaseParams {
    userId: string;
    packageId: string;
    credits: number;
    provider: PaymentProvider;
    /** Shopier payment_id or Lemon Squeezy order id — stored as reference_id */
    paymentReference: string;
    /** Optional pending checkout row to mark completed */
    pendingOrderId?: string;
    expectedAmountMinor: number;
    actualAmountMinor: number;
    currency: string;
}
/**
 * Idempotent credit grant after a verified provider webhook.
 * Uses CREDIT_PURCHASE + unique (provider, reference_id).
 */
export declare function fulfillVerifiedPurchase(params: FulfillPurchaseParams): Promise<{
    processed: boolean;
    ledgerId: string | null;
    reason?: string;
}>;
export declare function getPendingOrderById(orderId: string): Promise<{
    id: string;
    user_id: string;
    package_id: string;
    provider: string;
    currency: string;
    amount_minor: number;
    credits: number;
    status: string;
}>;
