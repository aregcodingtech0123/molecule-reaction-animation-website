"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { createCheckoutSession } from "@/lib/billing/checkout";
import { markCheckoutStarted } from "@/lib/billing/checkout-watch";
import { loginUrlForPackage, saveCheckoutIntent } from "@/lib/billing/checkout-intent";
import { savePreCheckoutView } from "@/lib/billing/pre-checkout-view";
import { toast } from "@/lib/toast";

export function useCreditCheckout(options?: {
  onRequireAuth?: () => void;
  /** Prefer signup vs login when redirecting guests. Default: login. */
  guestAuthMode?: "login" | "signup";
}) {
  const { isAuthenticated, credits } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const purchase = useCallback(
    async (packageId: string) => {
      if (!isAuthenticated) {
        saveCheckoutIntent(packageId);
        options?.onRequireAuth?.();
        router.push(loginUrlForPackage(packageId, options?.guestAuthMode ?? "login"));
        return;
      }

      setLoadingId(packageId);
      setError(null);

      try {
        const returnPath =
          typeof window !== "undefined" ? window.location.pathname : "/dashboard";
        const checkout = await createCheckoutSession(packageId, { returnPath });

        if (checkout.checkoutUrl) {
          // Remember the pre-payment balance before the tab navigates away, so
          // the app can poll for the webhook's credit drop when the user returns.
          markCheckoutStarted(packageId, credits);
          savePreCheckoutView();
          window.location.href = checkout.checkoutUrl;
          return;
        }

        throw new Error("Checkout response missing redirect target.");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : (t.toast_checkout_failed ?? "Checkout could not be started.");
        setError(message);
        toast.error(message);
        setLoadingId(null);
      }
    },
    [isAuthenticated, credits, options, router, t.toast_checkout_failed],
  );

  return {
    purchase,
    loadingId,
    error,
    setError,
    isPurchasing: loadingId !== null,
  };
}
