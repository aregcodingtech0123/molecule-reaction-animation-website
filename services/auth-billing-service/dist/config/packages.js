/** Historical ledger rows may carry providers that are no longer active. */
export const ACTIVE_PAYMENT_PROVIDER = "lemonsqueezy";
export const BILLING_CURRENCY = "USD";
export const CREDIT_PACKAGES = {
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
export function resolveCreditPackage(packageId) {
    if (typeof packageId !== "string" || !CREDIT_PACKAGES[packageId]) {
        throw new Error("INVALID_PACKAGE");
    }
    return CREDIT_PACKAGES[packageId];
}
//# sourceMappingURL=packages.js.map