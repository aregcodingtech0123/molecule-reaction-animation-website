"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  createCheckoutSession,
  detectDefaultBillingRegion,
  submitShopierForm,
  type BillingRegion,
} from "@/lib/billing/checkout";
import { toast } from "@/lib/toast";

export function useCreditCheckout(options?: { onRequireAuth?: () => void }) {
  const { isAuthenticated, openAuthModal } = useAuth();
  const { t } = useLanguage();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<BillingRegion>(() => detectDefaultBillingRegion());

  const purchase = useCallback(
    async (packageId: string, overrideRegion?: BillingRegion) => {
      if (!isAuthenticated) {
        options?.onRequireAuth?.();
        openAuthModal("login");
        return;
      }

      const billingRegion = overrideRegion ?? region;
      setLoadingId(packageId);
      setError(null);

      try {
        const checkout = await createCheckoutSession(packageId, billingRegion);

        if (checkout.mode === "shopier_form" && checkout.shopierForm) {
          submitShopierForm(checkout.shopierForm);
          return;
        }

        if (checkout.checkoutUrl) {
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
    [isAuthenticated, openAuthModal, options, region, t.toast_checkout_failed],
  );

  return {
    purchase,
    loadingId,
    error,
    setError,
    isPurchasing: loadingId !== null,
    region,
    setRegion,
  };
}
