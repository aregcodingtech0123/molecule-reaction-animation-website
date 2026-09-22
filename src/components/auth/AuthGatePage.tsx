"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth, type AuthModalMode } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { createCheckoutSession } from "@/lib/billing/checkout";
import {
  captureCheckoutIntentFromSearchParams,
  clearCheckoutIntent,
  peekCheckoutIntent,
} from "@/lib/billing/checkout-intent";
import { markCheckoutStarted } from "@/lib/billing/checkout-watch";
import { savePreCheckoutView } from "@/lib/billing/pre-checkout-view";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function AuthGateInner({ mode }: { mode: AuthModalMode }) {
  const searchParams = useSearchParams();
  const { openAuthModal, isAuthenticated, isHydrated, credits } = useAuth();
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();
  const [resumingCheckout, setResumingCheckout] = useState(false);

  useEffect(() => {
    captureCheckoutIntentFromSearchParams(searchParams);
  }, [searchParams]);

  useEffect(() => {
    if (!isHydrated) return;
    if (isAuthenticated) {
      const intent = peekCheckoutIntent();
      if (!intent) {
        // Already signed in with no pending checkout — leave the gate.
        window.location.replace("/pricing");
        return;
      }
      setResumingCheckout(true);
      void (async () => {
        try {
          toast.info(t.billing_redirecting ?? "Redirecting to checkout…");
          const returnPath = "/pricing";
          const checkout = await createCheckoutSession(intent, { returnPath });
          if (checkout.checkoutUrl) {
            clearCheckoutIntent();
            markCheckoutStarted(intent, credits);
            savePreCheckoutView();
            window.location.href = checkout.checkoutUrl;
            return;
          }
          throw new Error("Checkout response missing redirect target.");
        } catch (err) {
          clearCheckoutIntent();
          toast.error(
            err instanceof Error
              ? err.message
              : (t.toast_checkout_failed ?? "Checkout could not be started."),
          );
          setResumingCheckout(false);
          window.location.replace("/pricing");
        }
      })();
      return;
    }
    openAuthModal(mode);
  }, [
    isHydrated,
    isAuthenticated,
    credits,
    openAuthModal,
    mode,
    t.billing_redirecting,
    t.toast_checkout_failed,
  ]);

  return (
    <main className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center px-4 py-16">
      <div
        className={cn(
          "w-full max-w-md rounded-3xl border p-8 text-center backdrop-blur-md",
          isWhiteLab
            ? "border-slate-200 bg-white/90 shadow-lg"
            : "border-white/10 bg-white/5 shadow-2xl",
        )}
      >
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-teal-400" />
        <h1 className={cn("mt-4 text-xl font-semibold", ui.typography.title)}>
          {resumingCheckout
            ? (t.billing_redirecting ?? "Redirecting…")
            : mode === "register"
              ? "Create your account"
              : "Sign in to continue"}
        </h1>
        <p className={cn("mt-2 text-sm", ui.typography.muted)}>
          {searchParams.get("redirect_checkout") || resumingCheckout
            ? "After you sign in, we will continue to checkout for your selected pack."
            : "Use the dialog to sign in or create an account."}
        </p>
      </div>
    </main>
  );
}

export function AuthGatePage({ mode }: { mode: AuthModalMode }) {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
        </main>
      }
    >
      <AuthGateInner mode={mode} />
    </Suspense>
  );
}
