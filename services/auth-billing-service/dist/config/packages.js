export const CREDIT_PACKAGES = {
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
export function resolveCreditPackage(packageId) {
    if (typeof packageId !== "string" || !CREDIT_PACKAGES[packageId]) {
        throw new Error("INVALID_PACKAGE");
    }
    return CREDIT_PACKAGES[packageId];
}
export function resolveBillingRegion(input) {
    if (typeof input !== "string")
        return "GLOBAL";
    const normalized = input.trim().toUpperCase();
    if (normalized === "TR" || normalized === "TRY" || normalized === "TURKEY") {
        return "TR";
    }
    return "GLOBAL";
}
export function regionToCurrency(region) {
    return region === "TR" ? "TRY" : "USD";
}
export function regionToProvider(region) {
    return region === "TR" ? "shopier" : "lemonsqueezy";
}
export function packageAmountMinor(pkg, currency) {
    return currency === "TRY" ? pkg.priceTryKurus : pkg.priceUsdCents;
}
//# sourceMappingURL=packages.js.map