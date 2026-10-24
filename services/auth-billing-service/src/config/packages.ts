/**
 * Credit packages.
 *
 * Lemon Squeezy is the sole payment provider and settles in the store
 * currency (USD), so every package has a single USD price point.
 */
export type BillingCurrency = "USD";
export type PaymentProvider = "lemonsqueezy";

/** Historical ledger rows may carry providers that are no longer active. */
export const ACTIVE_PAYMENT_PROVIDER: PaymentProvider = "lemonsqueezy";
export const BILLING_CURRENCY: BillingCurrency = "USD";

export interface CreditPackageConfig {
  id: string;
  name: string;
  credits: number;
  /** USD list price in cents — must match the Lemon Squeezy variant price. */
  priceUsdCents: number;
}

export const CREDIT_PACKAGES: Record<string, CreditPackageConfig> = {
  starter: {
    id: "starter",
    name: "Starter Pack",
    credits: 50,
    priceUsdCents: 500,
  },
  pro: {
    id: "pro",
    name: "Pro Pack",
    credits: 250,
    priceUsdCents: 2000,
  },
  enterprise: {
    id: "enterprise",
    name: "Studio Pack",
    credits: 700,
    priceUsdCents: 5000,
  },
};

export function resolveCreditPackage(packageId: unknown): CreditPackageConfig {
  // Own keys only: "__proto__" / "constructor" / "toString" are not packages (FINDING-16).
  if (typeof packageId !== "string" || !Object.hasOwn(CREDIT_PACKAGES, packageId)) {
    throw new Error("INVALID_PACKAGE");
  }
  return CREDIT_PACKAGES[packageId]!;
}
