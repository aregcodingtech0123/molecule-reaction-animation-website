import { authFetch } from "@/lib/api/auth-interceptor";

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

  const data = (await res.json()) as HistoryApiResponse;
  if (!res.ok || !data.success || !data.data) {
    throw new Error(data.error ?? "Unable to load transaction history.");
  }

  return data.data.transactions;
}

const TYPE_LABELS: Record<string, string> = {
  SIGNUP_BONUS: "Signup Bonus",
  STRIPE_PURCHASE: "Stripe Purchase",
  CREDIT_PURCHASE: "Credit Purchase",
  AI_GENERATION_DEDUCTION: "AI Generation",
  ADMIN_ADJUSTMENT: "Admin Adjustment",
  REFUND: "Refund",
};

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
