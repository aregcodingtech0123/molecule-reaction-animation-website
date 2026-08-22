"use client";

import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import {
  CREDIT_PACKAGES,
  type BillingRegion,
  type CreditPackage,
} from "@/lib/billing/checkout";
import { cn } from "@/lib/utils";

export interface PricingCardsProps {
  onPurchase: (packageId: string) => void;
  loadingId?: string | null;
  disabled?: boolean;
  className?: string;
  layout?: "modal" | "dashboard";
  region: BillingRegion;
  onRegionChange?: (region: BillingRegion) => void;
}

export function PricingCards({
  onPurchase,
  loadingId = null,
  disabled = false,
  className,
  layout = "modal",
  region,
  onRegionChange,
}: PricingCardsProps) {
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();

  return (
    <div className={cn("space-y-5", className)}>
      {onRegionChange && (
        <div
          className={cn(
            "mx-auto flex w-full max-w-sm rounded-full border p-1",
            isWhiteLab ? "border-slate-200 bg-slate-100" : "border-white/10 bg-white/5",
          )}
        >
          {(
            [
              { id: "TR" as const, label: t.billing_region_tr ?? "Turkey · TRY · Shopier" },
              { id: "GLOBAL" as const, label: t.billing_region_global ?? "Global · USD · Lemon Squeezy" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onRegionChange(tab.id)}
              className={cn(
                "flex-1 rounded-full px-3 py-2 text-[11px] font-semibold transition-all",
                region === tab.id
                  ? isWhiteLab
                    ? "bg-white text-teal-900 shadow-sm border border-teal-200/60"
                    : "bg-teal-500/25 text-teal-100 border border-teal-400/40 shadow-[0_0_20px_rgba(45,212,191,0.22)]"
                  : cn(ui.typography.muted, "hover:opacity-90"),
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "grid gap-4",
          layout === "dashboard" ? "sm:grid-cols-2 lg:gap-6" : "sm:grid-cols-2",
        )}
      >
        {CREDIT_PACKAGES.map((pkg, index) => (
          <PricingCard
            key={pkg.id}
            pkg={pkg}
            index={index}
            region={region}
            loading={loadingId === pkg.id}
            disabled={disabled || Boolean(loadingId && loadingId !== pkg.id)}
            onBuy={() => onPurchase(pkg.id)}
            layout={layout}
          />
        ))}
      </div>
    </div>
  );
}

function PricingCard({
  pkg,
  index,
  region,
  loading,
  disabled,
  onBuy,
  layout,
}: {
  pkg: CreditPackage;
  index: number;
  region: BillingRegion;
  loading: boolean;
  disabled: boolean;
  onBuy: () => void;
  layout: "modal" | "dashboard";
}) {
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();
  const isTr = region === "TR";

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      whileHover={{ y: -3 }}
      className={cn(
        "relative flex flex-col rounded-2xl border backdrop-blur-md transition-all duration-300",
        layout === "dashboard" ? "p-6 sm:p-7" : "p-5 sm:p-6",
        pkg.highlight
          ? isWhiteLab
            ? "border-teal-300/80 bg-gradient-to-b from-teal-50/90 via-white to-cyan-50/50 shadow-lg shadow-teal-100/40 ring-1 ring-teal-200/50"
            : "border-teal-400/45 bg-white/[0.07] shadow-[0_0_48px_rgba(45,212,191,0.14)] ring-1 ring-teal-400/25"
          : isWhiteLab
            ? "border-slate-200/90 bg-white/75 hover:border-teal-200/80 hover:shadow-md"
            : "border-white/10 bg-black/35 hover:border-teal-400/30 hover:bg-white/[0.05]",
      )}
    >
      {pkg.highlight && (
        <span
          className={cn(
            "absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-lg",
            isWhiteLab
              ? "bg-gradient-to-r from-teal-600 to-cyan-500 text-white"
              : "bg-gradient-to-r from-teal-400 to-cyan-300 text-neutral-950",
          )}
        >
          {t.billing_best_value ?? "Best Value"}
        </span>
      )}

      <div className="mb-4">
        <h3 className={cn("font-display text-lg font-bold tracking-tight", ui.typography.title)}>
          {pkg.name}
        </h3>
        <p className={cn("text-xs mt-1.5 leading-relaxed", ui.typography.muted)}>{pkg.description}</p>
      </div>

      <div className="mb-5">
        <div className="flex items-end gap-1.5">
          <span
            className={cn(
              "font-display text-4xl font-black tracking-tight",
              isWhiteLab ? "text-teal-800" : "text-teal-300",
            )}
          >
            {pkg.credits}
          </span>
          <span className={cn("text-sm font-medium pb-1.5", ui.typography.muted)}>
            {t.billing_credits_unit ?? "credits"}
          </span>
        </div>
        <p className={cn("text-2xl font-semibold mt-1", ui.typography.title)}>
          {isTr ? `₺${pkg.priceTry}` : `$${pkg.priceUsd}`}
          <span className={cn("text-sm font-normal ml-1.5", ui.typography.muted)}>
            {isTr ? "TRY" : "USD"}
          </span>
        </p>
        <p className={cn("text-[11px] mt-1", ui.typography.muted)}>
          {isTr
            ? (t.billing_via_shopier ?? "Paid via Shopier")
            : (t.billing_via_lemon ?? "Paid via Lemon Squeezy (MoR)")}
        </p>
      </div>

      <ul className={cn("space-y-2 text-xs mb-6 flex-1", ui.typography.body)}>
        <li className="flex items-center gap-2">
          <Check className={cn("h-3.5 w-3.5 shrink-0", isWhiteLab ? "text-teal-700" : "text-teal-400")} />
          {t.billing_feature_3d ?? "3D molecule generation"}
        </li>
        <li className="flex items-center gap-2">
          <Check className={cn("h-3.5 w-3.5 shrink-0", isWhiteLab ? "text-teal-700" : "text-teal-400")} />
          {t.billing_feature_never_expire ?? "Credits never expire"}
        </li>
      </ul>

      <button
        type="button"
        onClick={onBuy}
        disabled={loading || disabled}
        className={cn(
          "w-full rounded-xl py-3 text-sm font-bold transition-all duration-300 border",
          isWhiteLab
            ? "bg-gradient-to-r from-teal-600 to-cyan-500 text-white border-teal-700/30 hover:from-teal-700 hover:to-cyan-600 shadow-md hover:shadow-lg"
            : "bg-gradient-to-r from-teal-500 to-cyan-400 text-neutral-950 border-teal-300/40 hover:from-teal-400 hover:to-cyan-300 hover:shadow-[0_0_32px_rgba(45,212,191,0.5)]",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none",
          "flex items-center justify-center gap-2",
        )}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.billing_redirecting ?? "Redirecting…"}
          </>
        ) : (
          (t.billing_buy_now ?? "Purchase")
        )}
      </button>
    </motion.article>
  );
}
