"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  FlaskConical,
  History,
  Loader2,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import {
  fetchLedgerHistory,
  formatLedgerAmount,
  formatLedgerDate,
  formatTransactionType,
  type LedgerTransaction,
} from "@/lib/billing/history";
import { PricingCards } from "@/components/billing/PricingCards";
import { cn } from "@/lib/utils";
import { safeNavigate } from "@/lib/navigation/safe-navigate";
import { useCreditCheckout } from "@/lib/billing/useCreditCheckout";

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, isHydrated, user, credits, openAuthModal, openBillingModal, fetchBalance } =
    useAuth();
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();

  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { purchase, loadingId, error: checkoutError, region, setRegion } = useCreditCheckout();

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      openAuthModal("login");
      safeNavigate(router, "/", "replace");
      return;
    }

    if (!isAuthenticated) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        await fetchBalance();
        const rows = await fetchLedgerHistory();
        if (!cancelled) setTransactions(rows);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : (t.toast_dashboard_load_failed ?? "Dashboard could not be loaded."),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isHydrated, isAuthenticated, router, openAuthModal, fetchBalance]);

  if (!isHydrated || !isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center pt-24">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </main>
    );
  }

  return (
    <main className="min-h-screen pt-24 pb-16 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto space-y-8">
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs", ui.panel.badge)}>
            <User className={cn("w-3.5 h-3.5", ui.typography.iconAccent)} />
            {t.dashboard_badge ?? "Account Dashboard"}
          </div>
          <h1 className={cn("text-3xl md:text-4xl font-bold", ui.typography.title)}>
            {t.dashboard_title ?? "Your MoleculeStudio Account"}
          </h1>
          <p className={cn("text-sm md:text-base max-w-2xl", ui.typography.subtitle)}>
            {t.dashboard_subtitle ?? "Manage your AI credits and review your full transaction ledger."}
          </p>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className={cn(
            "grid gap-4 sm:grid-cols-[1fr_auto] items-stretch rounded-3xl border p-6 sm:p-8 backdrop-blur-md",
            isWhiteLab
              ? "border-slate-200 bg-white/80 shadow-lg shadow-slate-200/40"
              : "border-slate-800 bg-white/5 shadow-2xl shadow-black/30",
          )}
        >
          <div className="space-y-3">
            <p className={cn("text-xs uppercase tracking-widest font-semibold", ui.typography.label)}>
              {t.dashboard_email_label ?? "Signed in as"}
            </p>
            <p className={cn("text-lg sm:text-xl font-semibold break-all", ui.typography.title)}>
              {user?.email}
            </p>
            <button
              type="button"
              onClick={openBillingModal}
              className={cn(
                "inline-flex items-center gap-2 text-sm font-medium transition-colors",
                isWhiteLab ? "text-cyan-700 hover:text-cyan-900" : "text-cyan-300 hover:text-cyan-200",
              )}
            >
              <Sparkles className="h-4 w-4" />
              {t.dashboard_buy_credits ?? "Purchase more credits"}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-2xl border px-8 py-6 min-w-[10rem]",
              isWhiteLab
                ? "border-cyan-200 bg-gradient-to-br from-cyan-50 to-teal-50"
                : "border-cyan-500/25 bg-gradient-to-br from-cyan-950/40 to-teal-950/20",
            )}
          >
            <Zap className={cn("h-6 w-6 mb-2", isWhiteLab ? "text-cyan-600" : "text-cyan-400")} />
            <p className={cn("text-xs font-semibold uppercase tracking-wider", ui.typography.muted)}>
              {t.dashboard_balance_label ?? "AI Credits"}
            </p>
            <p
              className={cn(
                "text-4xl sm:text-5xl font-black tabular-nums mt-1",
                isWhiteLab ? "text-cyan-800" : "text-cyan-300",
              )}
            >
              {credits ?? "—"}
            </p>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className={cn(
            "rounded-3xl border p-6 sm:p-8 backdrop-blur-md",
            isWhiteLab
              ? "border-slate-200 bg-white/80 shadow-lg shadow-slate-200/30"
              : "border-slate-800 bg-white/[0.03] shadow-2xl shadow-black/20",
          )}
        >
          <div className="mb-6 space-y-1">
            <h2 className={cn("text-lg font-semibold", ui.typography.title)}>
              {t.dashboard_pricing_title ?? "Credit Packs"}
            </h2>
            <p className={cn("text-sm", ui.typography.muted)}>
              {t.dashboard_pricing_subtitle ??
                "Secure Stripe checkout — credits are deposited instantly after payment."}
            </p>
          </div>

          {checkoutError && (
            <p className="mb-4 text-xs text-red-500 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2" role="alert">
              {checkoutError}
            </p>
          )}

          <PricingCards
            layout="dashboard"
            onPurchase={(id) => void purchase(id)}
            loadingId={loadingId}
            region={region}
            onRegionChange={setRegion}
          />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={cn(
            "rounded-3xl border overflow-hidden backdrop-blur-md",
            isWhiteLab ? "border-slate-200 bg-white/80" : "border-slate-800 bg-white/[0.03]",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-3 px-6 py-4 border-b",
              isWhiteLab ? "border-slate-200 bg-slate-50/80" : "border-slate-800 bg-white/[0.02]",
            )}
          >
            <History className={cn("h-5 w-5", ui.typography.iconAccent)} />
            <h2 className={cn("text-lg font-semibold", ui.typography.title)}>
              {t.dashboard_history_title ?? "Transaction History"}
            </h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
            </div>
          ) : error ? (
            <p className="px-6 py-12 text-center text-sm text-red-500" role="alert">
              {error}
            </p>
          ) : transactions.length === 0 ? (
            <EmptyState isWhiteLab={isWhiteLab} ui={ui} t={t} />
          ) : (
            <TransactionTable transactions={transactions} isWhiteLab={isWhiteLab} ui={ui} t={t} />
          )}
        </motion.section>
      </div>
    </main>
  );
}

function TransactionTable({
  transactions,
  isWhiteLab,
  ui,
  t,
}: {
  transactions: LedgerTransaction[];
  isWhiteLab: boolean;
  ui: ReturnType<typeof useTheme>["ui"];
  t: ReturnType<typeof useLanguage>["t"];
}) {
  const borderClass = isWhiteLab ? "border-slate-200" : "border-slate-800";
  const hoverClass = isWhiteLab ? "hover:bg-slate-50/90" : "hover:bg-white/[0.04]";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={cn("border-b text-left", borderClass, ui.typography.muted)}>
            <th className="px-6 py-3 font-semibold text-xs uppercase tracking-wider">
              {t.dashboard_col_date ?? "Date"}
            </th>
            <th className="px-6 py-3 font-semibold text-xs uppercase tracking-wider">
              {t.dashboard_col_type ?? "Type"}
            </th>
            <th className="px-6 py-3 font-semibold text-xs uppercase tracking-wider text-right">
              {t.dashboard_col_amount ?? "Amount"}
            </th>
            <th className="px-6 py-3 font-semibold text-xs uppercase tracking-wider hidden sm:table-cell">
              {t.dashboard_col_reference ?? "Reference"}
            </th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr
              key={tx.id}
              className={cn("border-b transition-colors duration-200", borderClass, hoverClass)}
            >
              <td className={cn("px-6 py-4 whitespace-nowrap", ui.typography.body)}>
                {formatLedgerDate(tx.created_at)}
              </td>
              <td className={cn("px-6 py-4", ui.typography.body)}>
                {formatTransactionType(tx.transaction_type)}
              </td>
              <td
                className={cn(
                  "px-6 py-4 text-right font-bold tabular-nums",
                  tx.amount > 0
                    ? isWhiteLab
                      ? "text-emerald-600"
                      : "text-emerald-400"
                    : isWhiteLab
                      ? "text-rose-600"
                      : "text-rose-400",
                )}
              >
                {formatLedgerAmount(tx.amount)}
              </td>
              <td
                className={cn(
                  "px-6 py-4 hidden sm:table-cell font-mono text-xs truncate max-w-[12rem]",
                  ui.typography.monoMuted,
                )}
              >
                {tx.reference_id ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({
  isWhiteLab,
  ui,
  t,
}: {
  isWhiteLab: boolean;
  ui: ReturnType<typeof useTheme>["ui"];
  t: ReturnType<typeof useLanguage>["t"];
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className={cn(
          "mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border",
          isWhiteLab
            ? "border-indigo-200 bg-indigo-50"
            : "border-indigo-500/30 bg-indigo-500/10",
        )}
      >
        <FlaskConical className={cn("h-8 w-8", ui.typography.iconAccent)} />
      </div>
      <h3 className={cn("text-lg font-semibold mb-2", ui.typography.title)}>
        {t.dashboard_empty_title ?? "No transactions yet"}
      </h3>
      <p className={cn("text-sm max-w-md mb-6", ui.typography.muted)}>
        {t.dashboard_empty_body ?? "Generate your first molecule using AI!"}
      </p>
      <Link
        href="/ai-lab"
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all",
          "bg-gradient-to-r from-indigo-600 to-purple-600 text-white",
          isWhiteLab ? "shadow-md hover:shadow-lg" : "shadow-[0_0_24px_rgba(99,102,241,0.35)]",
        )}
      >
        <Sparkles className="h-4 w-4" />
        {t.dashboard_empty_cta ?? "Open AI Lab"}
      </Link>
    </div>
  );
}
