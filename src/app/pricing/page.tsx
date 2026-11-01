"use client";

import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import { PricingCards } from "@/components/billing/PricingCards";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { useCreditCheckout } from "@/lib/billing/useCreditCheckout";
import { CREDIT_PACKAGES } from "@/lib/billing/checkout";
import { cn } from "@/lib/utils";

export default function PricingPage() {
  const { isAuthenticated, credits } = useAuth();
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();
  const { purchase, loadingId, error } = useCreditCheckout({ guestAuthMode: "signup" });

  return (
    <main className="min-h-screen pt-24 pb-16 px-4 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-10">
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-3"
        >
          <div
            className={cn(
              "mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border",
              isWhiteLab
                ? "border-teal-200 bg-teal-50"
                : "border-teal-400/35 bg-teal-500/15 shadow-[0_0_24px_rgba(45,212,191,0.18)]",
            )}
          >
            <Zap className={cn("h-6 w-6", isWhiteLab ? "text-teal-700" : "text-teal-300")} />
          </div>
          <h1 className={cn("text-3xl sm:text-4xl font-bold tracking-tight", ui.typography.title)}>
            {t.pricing_page_title ?? "Pricing"}
          </h1>
          <p className={cn("mx-auto max-w-2xl text-sm sm:text-base", ui.typography.muted)}>
            {t.pricing_page_subtitle ??
              "Browse credit packs freely. Guests can explore all plans — sign in only when you are ready to purchase."}
          </p>
          {isAuthenticated && credits !== null && (
            <p
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
                isWhiteLab
                  ? "border-teal-200 bg-teal-50 text-teal-900"
                  : "border-teal-400/35 bg-teal-500/10 text-teal-200",
              )}
            >
              {t.billing_current_balance ?? "Current balance"}: {credits}
            </p>
          )}
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className={cn(
            "rounded-3xl border p-5 sm:p-8 backdrop-blur-md",
            isWhiteLab
              ? "border-slate-200 bg-white/80 shadow-lg shadow-slate-200/40"
              : "border-white/10 bg-white/5 shadow-2xl shadow-black/30",
          )}
        >
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
            layout="dashboard"
            headingLevel={2}
          />

          <ul className={cn("mt-8 grid gap-2 text-center text-xs sm:grid-cols-3", ui.typography.muted)}>
            {CREDIT_PACKAGES.map((pkg) => (
              <li key={pkg.id}>
                <span className={cn("font-semibold", ui.typography.title)}>{pkg.name}</span>
                {` — $${pkg.priceUsd} / ${pkg.credits} ${t.billing_credits_unit ?? "credits"}`}
              </li>
            ))}
          </ul>

          <p className={cn("mt-6 text-center text-[11px]", ui.typography.muted)}>
            {t.billing_secure_note ??
              "Lemon Squeezy MoR (USD) · Credits applied after verified webhook"}
          </p>
        </motion.section>
      </div>
    </main>
  );
}
