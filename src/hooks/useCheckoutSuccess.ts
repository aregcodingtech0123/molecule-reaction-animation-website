"use client";

import { useEffect, useRef } from "react";
import { useLanguage } from "@/context/LanguageContext";
import {
  clearPreCheckoutView,
  peekPreCheckoutPath,
  peekPreCheckoutScroll,
  sanitizeCheckoutReturnPath,
} from "@/lib/billing/pre-checkout-view";
import { formatMessage } from "@/lib/i18n/localize";
import { toast } from "@/lib/toast";

const BALANCE_RETRY_DELAYS_MS = [0, 1500, 3500] as const;

function stripCheckoutQueryParams(): void {
  const params = new URLSearchParams(window.location.search);
  params.delete("payment");
  params.delete("billing");
  params.delete("credits");
  const query = params.size ? `?${params.toString()}` : "";
  const next = `${window.location.pathname}${query}${window.location.hash}`;
  window.history.replaceState({}, "", next);
}

function parseCreditsParam(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function restoreScrollPosition(scrollY: number): void {
  const apply = () => {
    window.scrollTo({ top: scrollY, left: 0, behavior: "instant" as ScrollBehavior });
  };

  // Wait a frame so layout (and any auth spinner) has settled.
  requestAnimationFrame(() => {
    apply();
    // Second pass after images/fonts may shift the page.
    window.setTimeout(apply, 50);
  });
}

/**
 * Handles Lemon Squeezy return URLs such as:
 *   /pricing?payment=success&credits=50
 * (also accepts legacy `billing=success` and `/dashboard?...`)
 *
 * Refetches balance (with short retries for webhook lag), shows a success toast,
 * restores pre-checkout scroll, and strips the query params so a reload does
 * not re-fire the celebration.
 */
export function useCheckoutSuccess(options: {
  isHydrated: boolean;
  /** Return value is ignored here — this hook only cares that a refetch ran. */
  fetchBalance: () => Promise<unknown>;
  onSuccess?: () => void;
}): void {
  const { t } = useLanguage();
  const handledRef = useRef(false);
  const fetchBalanceRef = useRef(options.fetchBalance);
  const onSuccessRef = useRef(options.onSuccess);

  fetchBalanceRef.current = options.fetchBalance;
  onSuccessRef.current = options.onSuccess;

  useEffect(() => {
    if (!options.isHydrated || handledRef.current) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    const billingStatus = params.get("billing");

    if (billingStatus === "cancel") {
      stripCheckoutQueryParams();
      clearPreCheckoutView();
      return;
    }

    const isSuccess = paymentStatus === "success" || billingStatus === "success";
    if (!isSuccess) return;

    handledRef.current = true;

    const credits = parseCreditsParam(params.get("credits"));
    const savedScroll = peekPreCheckoutScroll();
    const savedPath = peekPreCheckoutPath();
    const targetPath = savedPath ? sanitizeCheckoutReturnPath(savedPath) : null;

    // If Lemon returned to /dashboard but the user started on another page,
    // bounce back before cleaning storage so the destination can keep scroll.
    if (
      targetPath &&
      targetPath !== window.location.pathname &&
      window.location.pathname === "/dashboard"
    ) {
      const qs = new URLSearchParams();
      qs.set("payment", "success");
      if (credits !== null) qs.set("credits", String(credits));
      window.location.replace(`${targetPath}?${qs.toString()}`);
      return;
    }

    stripCheckoutQueryParams();
    onSuccessRef.current?.();

    const message =
      credits !== null
        ? formatMessage(
            t.toast_payment_success ??
              "🎉 Payment Successful! {credits} Credits have been added to your account.",
            { credits },
          )
        : (t.toast_credits_purchased ?? "Credits applied to your balance.");

    toast.success(message);

    if (savedScroll !== null) {
      restoreScrollPosition(savedScroll);
    }
    clearPreCheckoutView();

    let cancelled = false;
    void (async () => {
      for (const delay of BALANCE_RETRY_DELAYS_MS) {
        if (cancelled) return;
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (cancelled) return;
        try {
          await fetchBalanceRef.current();
          window.dispatchEvent(new CustomEvent("moleculestudio:credits-refreshed"));
        } catch {
          // Balance may still catch up on a later retry.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [options.isHydrated, t.toast_payment_success, t.toast_credits_purchased]);
}
