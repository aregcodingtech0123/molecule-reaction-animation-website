export type BillingRegion = "TR" | "GLOBAL";
export type BillingCurrency = "TRY" | "USD";
export type PaymentProvider = "shopier" | "lemonsqueezy";
export interface CreditPackageConfig {
    id: string;
    name: string;
    credits: number;
    /** USD list price in cents (Lemon Squeezy / global). */
    priceUsdCents: number;
    /** TRY list price in kuruş (Shopier / Turkey). */
    priceTryKurus: number;
}
export declare const CREDIT_PACKAGES: Record<string, CreditPackageConfig>;
export declare function resolveCreditPackage(packageId: unknown): CreditPackageConfig;
export declare function resolveBillingRegion(input: unknown): BillingRegion;
export declare function regionToCurrency(region: BillingRegion): BillingCurrency;
export declare function regionToProvider(region: BillingRegion): PaymentProvider;
export declare function packageAmountMinor(pkg: CreditPackageConfig, currency: BillingCurrency): number;
