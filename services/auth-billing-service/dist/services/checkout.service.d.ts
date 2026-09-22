import type { PaymentProvider } from "../config/packages.js";
import { type BillingCurrency } from "../config/packages.js";
/** Lemon Squeezy is redirect-based; retained as a literal for API stability. */
export type CheckoutMode = "redirect";
export interface CheckoutResult {
    provider: PaymentProvider;
    currency: BillingCurrency;
    mode: CheckoutMode;
    checkoutUrl: string;
    orderId: string;
}
export declare function createUnifiedCheckout(params: {
    userId: string;
    userEmail: string;
    packageId: unknown;
    returnPath?: unknown;
}): Promise<CheckoutResult>;
export interface FulfillPurchaseParams {
    userId: string;
    packageId: string;
    credits: number;
    provider: PaymentProvider;
    /** Lemon Squeezy order id — stored as reference_id */
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
