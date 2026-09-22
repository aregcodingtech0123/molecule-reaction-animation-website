/**
 * Credit packages.
 *
 * Lemon Squeezy is the sole payment provider and settles in the store
 * currency (USD), so every package has a single USD price point.
 */
export type BillingCurrency = "USD";
export type PaymentProvider = "lemonsqueezy";
/** Historical ledger rows may carry providers that are no longer active. */
export declare const ACTIVE_PAYMENT_PROVIDER: PaymentProvider;
export declare const BILLING_CURRENCY: BillingCurrency;
export interface CreditPackageConfig {
    id: string;
    name: string;
    credits: number;
    /** USD list price in cents — must match the Lemon Squeezy variant price. */
    priceUsdCents: number;
}
export declare const CREDIT_PACKAGES: Record<string, CreditPackageConfig>;
export declare function resolveCreditPackage(packageId: unknown): CreditPackageConfig;
