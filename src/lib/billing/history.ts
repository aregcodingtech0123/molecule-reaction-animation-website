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
  data?: { transactions: LedgerTransaction[] };
  error?: string;
  code?: string;
}

export async function fetchLedgerHistory(): Promise<LedgerTransaction[]> {
  const res = await authFetch("/api/billing/history", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });

  const data = await safeJson<HistoryApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(data.error ?? "Unable to load transaction history.");
  }

  return data.data.transactions;
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
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
