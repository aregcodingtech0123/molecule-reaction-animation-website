import { getCreditPackage } from "@/lib/billing/checkout";

const STORAGE_KEY = "moleculestudio_checkout_intent";
const QUERY_PACKAGE = "redirect_checkout";
const QUERY_VARIANT = "variant_id";

/** Known package IDs that can be purchased. */
export const CHECKOUT_PACKAGE_IDS = ["starter", "pro", "enterprise"] as const;
export type CheckoutPackageId = (typeof CHECKOUT_PACKAGE_IDS)[number];

/**
 * Optional map from Lemon variant id → package id for deep links like
 * `/login?variant_id=2154661`. Values come from local .env (not committed);
 * unknown ids are ignored so guests still land on login safely.
 */
const VARIANT_ID_TO_PACKAGE: Record<string, CheckoutPackageId> = {
  "2154652": "starter",
  "2154661": "pro",
  "2154665": "enterprise",
};

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
  const mapped = VARIANT_ID_TO_PACKAGE[variantId];
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
  const variantEntry = Object.entries(VARIANT_ID_TO_PACKAGE).find(([, id]) => id === packageId);
  if (variantEntry) qs.set(QUERY_VARIANT, variantEntry[0]);
  void pkg;
  return `${path}?${qs.toString()}`;
}
