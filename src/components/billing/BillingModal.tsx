"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X, Zap } from "lucide-react";
import { PricingCards } from "@/components/billing/PricingCards";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { useCreditCheckout } from "@/lib/billing/useCreditCheckout";
import { cn } from "@/lib/utils";

export function BillingModal() {
  const { billingModalOpen, billingModalMessage, closeBillingModal, isAuthenticated, credits } =
    useAuth();
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();
  const { purchase, loadingId, error } = useCreditCheckout({
    onRequireAuth: closeBillingModal,
  });

  return (
    <AnimatePresence>
      {billingModalOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Close billing dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-md"
            onClick={closeBillingModal}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="billing-modal-title"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "fixed left-1/2 top-1/2 z-[101] w-[min(100vw-1.5rem,56rem)] -translate-x-1/2 -translate-y-1/2",
              "rounded-3xl border shadow-2xl backdrop-blur-xl overflow-hidden",
              isWhiteLab
                ? "border-slate-200/90 bg-white/92 shadow-slate-300/40"
                : "border-white/12 bg-neutral-950/88 shadow-black/60",
            )}
          >
            <div
              className={cn(
                "relative px-6 sm:px-8 pt-7 pb-5 border-b",
                isWhiteLab
                  ? "border-slate-200/80 bg-gradient-to-br from-teal-50/80 via-white to-cyan-50/40"
                  : "border-white/10 bg-gradient-to-br from-teal-950/35 via-neutral-950/20 to-black/40",
              )}
            >
              <button
                type="button"
                onClick={closeBillingModal}
                className={cn(
                  "absolute right-5 top-5 rounded-lg p-1.5 transition-colors",
                  ui.controls.iconButton,
                  isWhiteLab ? "hover:bg-slate-100" : "hover:bg-white/10",
                )}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-start gap-3 pr-10">
                <div
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-2xl border",
                    isWhiteLab
                      ? "bg-teal-50 border-teal-200/80"
                      : "bg-teal-500/15 border-teal-400/35 shadow-[0_0_24px_rgba(45,212,191,0.18)]",
                  )}
                >
                  <Zap className={cn("h-6 w-6", isWhiteLab ? "text-teal-700" : "text-teal-300")} />
                </div>
                <div>
                  <h2 id="billing-modal-title" className={cn("text-xl font-bold", ui.typography.title)}>
                    {t.billing_title ?? "Purchase AI Credits"}
                  </h2>
                  <p className={cn("text-sm mt-1", ui.typography.muted)}>
                    {t.billing_subtitle ?? "Buy AI credits securely with Lemon Squeezy."}
                  </p>
                  {isAuthenticated && credits !== null && (
                    <p
                      className={cn(
                        "mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                        isWhiteLab
                          ? "border-teal-200 bg-teal-50 text-teal-900"
                          : "border-teal-400/35 bg-teal-500/10 text-teal-200",
                      )}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t.billing_current_balance ?? "Current balance"}: {credits}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 sm:px-8 py-6 sm:py-8">
              {billingModalMessage && (
                <p
                  role="status"
                  className={cn(
                    "mb-4 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium",
                    isWhiteLab
                      ? "border-amber-300/80 bg-amber-50 text-amber-900"
                      : "border-amber-400/30 bg-amber-500/10 text-amber-200",
                  )}
                >
                  <Zap className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{billingModalMessage}</span>
                </p>
              )}

              {error && (
                <p
                  className="mb-4 text-xs text-red-500 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <PricingCards
                onPurchase={(id) => void purchase(id)}
                loadingId={loadingId}
                layout="modal"
              />

              <p className={cn("mt-6 text-center text-[11px]", ui.typography.muted)}>
                {t.billing_secure_note ??
                  "Lemon Squeezy MoR (USD) · Credits applied after verified webhook"}
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
