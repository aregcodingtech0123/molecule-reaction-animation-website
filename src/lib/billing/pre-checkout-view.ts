import { readCheckoutWatch } from "@/lib/billing/checkout-watch";

/** Exact keys requested for post-checkout view restoration. */
export const PRE_CHECKOUT_SCROLL_KEY = "pre_checkout_scroll";
export const PRE_CHECKOUT_PATH_KEY = "pre_checkout_path";

/**
 * Snapshot the page the buyer is leaving so we can restore path + scroll
 * after Lemon Squeezy redirects back.
 */
export function savePreCheckoutView(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PRE_CHECKOUT_SCROLL_KEY, String(Math.round(window.scrollY)));
    window.sessionStorage.setItem(PRE_CHECKOUT_PATH_KEY, window.location.pathname);
  } catch {
    /* private mode — restoration is best-effort */
  }
}

export function peekPreCheckoutPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(PRE_CHECKOUT_PATH_KEY);
  } catch {
    return null;
  }
}

export function peekPreCheckoutScroll(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PRE_CHECKOUT_SCROLL_KEY);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return null;
  }
}

export function clearPreCheckoutView(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PRE_CHECKOUT_SCROLL_KEY);
    window.sessionStorage.removeItem(PRE_CHECKOUT_PATH_KEY);
  } catch {
    /* ignore */
  }
}

/** True while returning from Lemon (query flags) or while pre-checkout markers remain. */
export function isCheckoutReturnPending(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success" || params.get("billing") === "success") {
      return true;
    }
    if (params.get("billing") === "cancel") return true;
    if (window.sessionStorage.getItem(PRE_CHECKOUT_PATH_KEY)) return true;
    if (readCheckoutWatch()) return true;
  } catch {
    return false;
  }

  return false;
}

/**
 * Safe same-origin path for Lemon `redirect_url` (pathname only).
 * Rejects protocol-relative / absolute URLs.
 */
export function sanitizeCheckoutReturnPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/dashboard";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/dashboard";
  const pathOnly = trimmed.split("?")[0]?.split("#")[0] ?? "/dashboard";
  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//") || pathOnly.length > 200) {
    return "/dashboard";
  }
  return pathOnly || "/dashboard";
}
