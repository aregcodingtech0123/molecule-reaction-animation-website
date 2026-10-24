import { getCreditPackage } from "@/lib/billing/checkout";

const STORAGE_KEY = "moleculestudio_checkout_intent";
const QUERY_PACKAGE = "redirect_checkout";
const QUERY_VARIANT = "variant_id";

/** Known package IDs that can be purchased. */
export const CHECKOUT_PACKAGE_IDS = ["starter", "pro", "enterprise"] as const;
export type CheckoutPackageId = (typeof CHECKOUT_PACKAGE_IDS)[number];

/**
 * Optional map from Lemon variant id → package id for deep links like
 * `/login?variant_id=<id>`. Build-time env only (FINDING-13) — each variable
 * is referenced literally so Next.js inlines it. Unset → variant links are
 * ignored and guests still land on login safely.
 */
function variantIdToPackage(): Map<string, CheckoutPackageId> {
  const pairs: Array<[string | undefined, CheckoutPackageId]> = [
    [process.env.NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_STARTER, "starter"],
    [process.env.NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_PRO, "pro"],
    [process.env.NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_ENTERPRISE, "enterprise"],
  ];
  const map = new Map<string, CheckoutPackageId>();
  for (const [variantId, packageId] of pairs) {
    const id = variantId?.trim();
    if (id) map.set(id, packageId);
  }
  return map;
}

export function isCheckoutPackageId(value: string | null | undefined): value is CheckoutPackageId {
  return Boolean(value && (CHECKOUT_PACKAGE_IDS as readonly string[]).includes(value));
}

export function saveCheckoutIntent(packageId: string): void {
  if (!isCheckoutPackageId(packageId)) return;
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, packageId);
}

export function peekCheckoutIntent(): CheckoutPackageId | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  return isCheckoutPackageId(raw) ? raw : null;
}

export function consumeCheckoutIntent(): CheckoutPackageId | null {
  const intent = peekCheckoutIntent();
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
  return intent;
}

export function clearCheckoutIntent(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}

/** Persist intent from URL query (`redirect_checkout` or `variant_id`). */
export function captureCheckoutIntentFromSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null },
): CheckoutPackageId | null {
  const byPackage = params.get(QUERY_PACKAGE)?.trim().toLowerCase() ?? null;
  if (isCheckoutPackageId(byPackage)) {
    saveCheckoutIntent(byPackage);
    return byPackage;
  }

  const variantId = params.get(QUERY_VARIANT)?.trim() ?? "";
  const mapped = variantId ? variantIdToPackage().get(variantId) : undefined;
  if (mapped) {
    saveCheckoutIntent(mapped);
    return mapped;
  }

  return null;
}

export function loginUrlForPackage(packageId: string, mode: "login" | "signup" = "login"): string {
  const path = mode === "signup" ? "/signup" : "/login";
  if (!isCheckoutPackageId(packageId)) return path;
  const pkg = getCreditPackage(packageId);
  const qs = new URLSearchParams({ [QUERY_PACKAGE]: packageId });
  // Also attach variant_id when known (helpful for analytics / deep links).
  const variantEntry = [...variantIdToPackage()].find(([, id]) => id === packageId);
  if (variantEntry) qs.set(QUERY_VARIANT, variantEntry[0]);
  void pkg;
  return `${path}?${qs.toString()}`;
}
