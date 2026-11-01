"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  BookOpen,
  FlaskConical,
  Grid3X3,
  History,
  Loader2,
  Sparkles,
  Star,
  User,
  Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import {
  appendPage,
  fetchLedgerHistoryPage,
  formatLedgerAmount,
  formatLedgerDate,
  formatTransactionDescription,
  formatTransactionType,
  ledgerBadgeVariant,
  mergeFirstPage,
  type LedgerBadgeVariant,
  type LedgerPage,
  type LedgerTransaction,
} from "@/lib/billing/history";
import { PricingCards } from "@/components/billing/PricingCards";
import { cn } from "@/lib/utils";
import { safeNavigate } from "@/lib/navigation/safe-navigate";
import { useCreditCheckout } from "@/lib/billing/useCreditCheckout";
import { isCheckoutReturnPending } from "@/lib/billing/pre-checkout-view";

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, isHydrated, user, credits, openBillingModal, fetchBalance } =
    useAuth();
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();

  const [ledger, setLedger] = useState<LedgerPage>({ transactions: [], nextCursor: null });
  const transactions = ledger.transactions;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!ledger.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const older = await fetchLedgerHistoryPage(ledger.nextCursor);
      setLedger((shown) => appendPage(shown, older));
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err.message : "Unable to load transaction history.");
    } finally {
      setLoadingMore(false);
    }
  }, [ledger.nextCursor, loadingMore]);
  const { purchase, loadingId, error: checkoutError } = useCreditCheckout();

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      // Returning from Lemon: session may still be rehydrating — never flash login.
      if (isCheckoutReturnPending()) return;
      safeNavigate(router, "/login", "replace");
      return;
    }

    if (!isAuthenticated) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        await fetchBalance();
        const page = await fetchLedgerHistoryPage();
        if (!cancelled) setLedger(page);
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

    const onCreditsRefreshed = () => {
      void fetchLedgerHistoryPage()
        .then((page) => {
          if (!cancelled) setLedger((shown) => mergeFirstPage(shown, page));
        })
        .catch(() => {
          /* keep existing ledger rows */
        });
    };
    window.addEventListener("moleculestudio:credits-refreshed", onCreditsRefreshed);

    return () => {
      cancelled = true;
      window.removeEventListener("moleculestudio:credits-refreshed", onCreditsRefreshed);
    };
  }, [isHydrated, isAuthenticated, router, fetchBalance]);

  // R10: the header is static, non-personal copy (labels and links), so it is rendered in the server HTML and in the
  // loading state too. Before, the page showed only a spinner until the client had hydrated AND the auth round-trip
  // had finished, which made the <h1> the LCP element only after ~3 s on a throttled phone. The proxy still gates the
  // page (no session cookie -> redirect), the API still answers 401 without a session, and nothing below the header
  // (balance, ledger, checkout) is rendered until the session is confirmed.
  // CSS entrance (PERF-23): the heading is the LCP element and must not wait for hydration. It slides without a
  // fade: an element first painted at opacity 0 is not an LCP candidate at all.
  const header = (
    <header className="space-y-3 animate-in ease-out fill-mode-both motion-reduce:animate-none slide-in-from-top-3 duration-300">
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
      <nav
        aria-label={t.dashboard_quick_links ?? "Quick links"}
        className="flex flex-wrap gap-2 pt-1"
      >
        {[
          { href: "/profile", label: t.nav_profile ?? "Profile" },
          { href: "/ai-lab", label: t.nav_ai_lab ?? "AI Lab" },
          { href: "/explore", label: t.nav_explore },
          { href: "/pricing", label: t.nav_pricing ?? "Pricing" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors",
              isWhiteLab
                ? "border-slate-200 bg-white text-neutral-800 hover:border-teal-300 hover:bg-teal-50"
                : "border-white/12 bg-white/5 text-gray-200 hover:border-teal-400/40 hover:bg-teal-500/10 hover:text-teal-100",
            )}
          >
            {link.label}
            <ArrowUpRight className="h-3 w-3 opacity-70" />
          </Link>
        ))}
      </nav>

      <div
        aria-label={t.dashboard_feature_cards ?? "Studio features"}
        className="grid gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[
          {
            href: "/periodic-table",
            title: t.dash_card_periodic_title ?? "Periodic Table 🧪",
            body:
              t.dash_card_periodic_body ??
              "Inspect elements and atomic structures in 3D",
            icon: Grid3X3,
            accent: true,
          },
          {
            href: "/showcase",
            title: t.dash_card_showcase_title ?? "Interactive Showcase 🌟",
            body:
              t.dash_card_showcase_body ??
              "Explore community creations and molecular architectures",
            icon: Star,
            accent: false,
          },
          {
            href: "/learn",
            title: t.dash_card_learn_title ?? "Chemistry Learn Hub 📖",
            body:
              t.dash_card_learn_body ??
              "Master bonding types and orbital structures",
            icon: BookOpen,
            accent: false,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className={cn(
                "group flex items-start gap-3 rounded-2xl border p-4 backdrop-blur-xl transition-all",
                card.accent
                  ? isWhiteLab
                    ? "border-teal-300/90 bg-teal-50/90 shadow-sm hover:bg-teal-100 hover:shadow-[0_0_22px_rgba(13,148,136,0.18)]"
                    : "border-teal-400/45 bg-teal-500/12 shadow-[0_0_22px_rgba(45,212,191,0.16)] hover:border-teal-300/60 hover:bg-teal-500/20"
                  : isWhiteLab
                    ? "border-slate-200 bg-white/90 hover:border-teal-300/70 hover:bg-teal-50/70"
                    : "border-white/12 bg-white/5 hover:border-teal-400/35 hover:bg-teal-500/10",
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                  isWhiteLab
                    ? "border-teal-200 bg-teal-50 text-teal-800"
                    : "border-teal-400/35 bg-teal-500/15 text-teal-200",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("font-display text-sm font-semibold", ui.typography.title)}>
                  {card.title}
                </p>
                <p className={cn("mt-0.5 text-xs leading-relaxed", ui.typography.muted)}>
                  {card.body}
                </p>
              </div>
              <ArrowUpRight
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
                  isWhiteLab ? "text-teal-700" : "text-teal-300",
                )}
              />
            </Link>
          );
        })}
      </div>
    </header>
  );

  if (!isHydrated || !isAuthenticated) {
    return (
      <main className="min-h-screen pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto space-y-8">
          {header}
          <div className="flex justify-center py-10" role="status" aria-label="Loading">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pt-24 pb-16 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto space-y-8">
        {header}

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
              onClick={() => openBillingModal()}
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
                "Secure Lemon Squeezy checkout — credits are deposited after payment."}
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
              {t.dashboard_history_title ?? "Credit & Usage History"}
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
            <>
              <TransactionTable transactions={transactions} isWhiteLab={isWhiteLab} ui={ui} t={t} />
              {loadMoreError ? (
                <p className="px-6 pt-4 text-center text-sm text-red-500" role="alert">
                  {loadMoreError}
                </p>
              ) : null}
              {ledger.nextCursor ? (
                <div className="flex justify-center px-6 py-4">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60",
                      isWhiteLab
                        ? "border-slate-300 text-slate-700 hover:bg-slate-100"
                        : "border-slate-700 text-slate-200 hover:bg-white/[0.06]",
                    )}
                  >
                    {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    {t.dashboard_load_more ?? "Load more"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </motion.section>
      </div>
    </main>
  );
}

const BADGE_STYLES: Record<LedgerBadgeVariant, { light: string; dark: string }> = {
  purchase: {
    light: "border-emerald-300 bg-emerald-50 text-emerald-800",
    dark: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  },
  bonus: {
    light: "border-teal-300 bg-teal-50 text-teal-800",
    dark: "border-teal-400/30 bg-teal-500/10 text-teal-300",
  },
  usage: {
    light: "border-indigo-300 bg-indigo-50 text-indigo-800",
    dark: "border-indigo-400/30 bg-indigo-500/10 text-indigo-300",
  },
  refund: {
    light: "border-amber-300 bg-amber-50 text-amber-900",
    dark: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  },
  neutral: {
    light: "border-slate-300 bg-slate-100 text-slate-700",
    dark: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  },
};

function LedgerTypeBadge({
  label,
  variant,
  isWhiteLab,
}: {
  label: string;
  variant: LedgerBadgeVariant;
  isWhiteLab: boolean;
}) {
  const style = BADGE_STYLES[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        isWhiteLab ? style.light : style.dark,
      )}
    >
      {label}
    </span>
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
            <th className="px-6 py-3 font-semibold text-xs uppercase tracking-wider hidden sm:table-cell">
              {t.dashboard_col_description ?? "Description"}
            </th>
            <th className="px-6 py-3 font-semibold text-xs uppercase tracking-wider text-right">
              {t.dashboard_col_amount ?? "Amount"}
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
              <td className="px-6 py-4">
                <LedgerTypeBadge
                  label={formatTransactionType(tx.transaction_type)}
                  variant={ledgerBadgeVariant(tx.transaction_type)}
                  isWhiteLab={isWhiteLab}
                />
              </td>
              <td
                className={cn("px-6 py-4 hidden sm:table-cell", ui.typography.muted)}
                title={tx.reference_id ?? undefined}
              >
                {formatTransactionDescription(tx)}
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
