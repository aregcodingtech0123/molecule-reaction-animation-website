import { authFetch } from "@/lib/api/auth-interceptor";
import { safeJson } from "@/lib/api/safe-json";

export interface LedgerTransaction {
  id: string;
  amount: number;
  transaction_type: string;
  reference_id: string | null;
  created_at: string;
}

export interface HistoryApiResponse {
  success: boolean;
  data?: { transactions: LedgerTransaction[]; nextCursor?: string | null };
  error?: string;
  code?: string;
}

export interface LedgerPage {
  transactions: LedgerTransaction[];
  /** Pass to the next call for older rows; null when there are none. */
  nextCursor: string | null;
}

/** One newest-first page of the ledger; `cursor` continues after a previous page (FINDING-17). */
export async function fetchLedgerHistoryPage(cursor?: string | null): Promise<LedgerPage> {
  const url = cursor ? `/api/billing/history?${new URLSearchParams({ cursor })}` : "/api/billing/history";
  const res = await authFetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });

  const data = await safeJson<HistoryApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(data.error ?? "Unable to load transaction history.");
  }

  return { transactions: data.data.transactions, nextCursor: data.data.nextCursor ?? null };
}

/**
 * Fold a freshly fetched first page into what is already shown. If it overlaps
 * the shown rows, only the new ones are added on top and the pagination
 * position is kept; otherwise (nothing shown yet, or more new rows than one
 * page) the first page replaces everything.
 */
export function mergeFirstPage(shown: LedgerPage, first: LedgerPage): LedgerPage {
  const known = new Set(shown.transactions.map((tx) => tx.id));
  const fresh = first.transactions.filter((tx) => !known.has(tx.id));
  if (fresh.length === first.transactions.length) return first;
  return { transactions: [...fresh, ...shown.transactions], nextCursor: shown.nextCursor };
}

/** Append an older page, skipping rows already shown. */
export function appendPage(shown: LedgerPage, older: LedgerPage): LedgerPage {
  const known = new Set(shown.transactions.map((tx) => tx.id));
  return {
    transactions: [...shown.transactions, ...older.transactions.filter((tx) => !known.has(tx.id))],
    nextCursor: older.nextCursor,
  };
}

const TYPE_LABELS: Record<string, string> = {
  SIGNUP_BONUS: "Signup Bonus",
  STRIPE_PURCHASE: "Stripe Purchase",
  CREDIT_PURCHASE: "Credit Purchase",
  CREDIT_CONSUMPTION: "AI Usage",
  CREDIT_REFUND: "Auto Refund",
  AI_GENERATION_DEDUCTION: "AI Generation",
  ADMIN_ADJUSTMENT: "Admin Adjustment",
  REFUND: "Refund",
};

/** Semantic grouping used to colour the badge in the usage history table. */
export type LedgerBadgeVariant = "purchase" | "bonus" | "usage" | "refund" | "neutral";

const TYPE_VARIANTS: Record<string, LedgerBadgeVariant> = {
  SIGNUP_BONUS: "bonus",
  STRIPE_PURCHASE: "purchase",
  CREDIT_PURCHASE: "purchase",
  CREDIT_CONSUMPTION: "usage",
  AI_GENERATION_DEDUCTION: "usage",
  CREDIT_REFUND: "refund",
  REFUND: "refund",
  ADMIN_ADJUSTMENT: "neutral",
};

export function ledgerBadgeVariant(type: string): LedgerBadgeVariant {
  // Fall back on the sign so a ledger type added server-side still renders
  // sensibly before this table learns about it.
  return TYPE_VARIANTS[type] ?? "neutral";
}

/** Short human description of what the row was for. */
export function formatTransactionDescription(tx: {
  transaction_type: string;
  reference_id: string | null;
}): string {
  switch (tx.transaction_type) {
    case "CREDIT_CONSUMPTION":
      return "AI operation";
    case "CREDIT_REFUND":
      return "Refund for a failed AI operation";
    case "CREDIT_PURCHASE":
    case "STRIPE_PURCHASE":
      return "Credit pack purchase";
    case "SIGNUP_BONUS":
      return "Welcome credits";
    case "ADMIN_ADJUSTMENT":
      return "Manual adjustment";
    default:
      return formatTransactionType(tx.transaction_type);
  }
}

export function formatTransactionType(type: string): string {
  if (Object.hasOwn(TYPE_LABELS, type)) return TYPE_LABELS[type]!;
  // A type added server-side before this table knows it: SOME_NEW_TYPE → "Some New Type" (FINDING-28).
  return type
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function formatLedgerAmount(amount: number): string {
  return amount > 0 ? `+${amount}` : String(amount);
}

export function formatLedgerDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
