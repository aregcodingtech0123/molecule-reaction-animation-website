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

export const CREDIT_PACKAGES: Record<string, CreditPackageConfig> = {
  starter: {
    id: "starter",
    name: "Starter Pack",
    credits: 100,
    priceUsdCents: 500,
    priceTryKurus: 19900,
  },
  pro: {
    id: "pro",
    name: "Pro Pack",
    credits: 500,
    priceUsdCents: 2000,
    priceTryKurus: 74900,
  },
};

export function resolveCreditPackage(packageId: unknown): CreditPackageConfig {
  if (typeof packageId !== "string" || !CREDIT_PACKAGES[packageId]) {
    throw new Error("INVALID_PACKAGE");
  }
  return CREDIT_PACKAGES[packageId];
}

export function resolveBillingRegion(input: unknown): BillingRegion {
  if (typeof input !== "string") return "GLOBAL";
  const normalized = input.trim().toUpperCase();
  if (normalized === "TR" || normalized === "TRY" || normalized === "TURKEY") {
    return "TR";
  }
  return "GLOBAL";
}

export function regionToCurrency(region: BillingRegion): BillingCurrency {
  return region === "TR" ? "TRY" : "USD";
}

export function regionToProvider(region: BillingRegion): PaymentProvider {
  return region === "TR" ? "shopier" : "lemonsqueezy";
}

export function packageAmountMinor(
  pkg: CreditPackageConfig,
  currency: BillingCurrency,
): number {
  return currency === "TRY" ? pkg.priceTryKurus : pkg.priceUsdCents;
}
