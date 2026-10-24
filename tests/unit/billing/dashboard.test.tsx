import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, LinkMock, makeAuth, navigationMock, renderWithProviders, routeFetch, router, signedIn } from "../../support/mocks";

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.current }));
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/link", () => ({ default: LinkMock }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import DashboardPage from "@/app/dashboard/page";
import { formatLedgerAmount, formatTransactionDescription, formatTransactionType, ledgerBadgeVariant } from "@/lib/billing/history";

const rows = [
  { id: "4", amount: -1, transaction_type: "CREDIT_CONSUMPTION", reference_id: "turn-1", created_at: "2026-10-20T10:03:00Z" },
  { id: "3", amount: 1, transaction_type: "CREDIT_REFUND", reference_id: "turn-0", created_at: "2026-10-20T10:02:00Z" },
  { id: "2", amount: 250, transaction_type: "CREDIT_PURCHASE", reference_id: "ls_order_1", created_at: "2026-10-20T10:01:00Z" },
  { id: "1", amount: 10, transaction_type: "SIGNUP_BONUS", reference_id: "signup", created_at: "2026-10-20T10:00:00Z" },
];

beforeEach(() => {
  router.replace.mockReset();
  router.push.mockReset();
});

describe("dashboard ledger table", () => {
  it("renders one row per transaction, newest first, with signed amounts, labels and descriptions", async () => {
    auth.current = signedIn({ credits: 260 });
    vi.stubGlobal("fetch", routeFetch({ "GET /api/billing/history": () => json({ success: true, data: { transactions: rows } }) }));
    renderWithProviders(<DashboardPage />);

    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(4);
    expect(bodyRows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/AI Usage.*AI operation.*-1/),
      expect.stringMatching(/Auto Refund.*Refund for a failed AI operation.*\+1/),
      expect.stringMatching(/Credit Purchase.*Credit pack purchase.*\+250/),
      expect.stringMatching(/Signup Bonus.*Welcome credits.*\+10/),
    ]);
  });

  it("empty ledger → empty state, no table", async () => {
    auth.current = signedIn();
    vi.stubGlobal("fetch", routeFetch({ "GET /api/billing/history": () => json({ success: true, data: { transactions: [] } }) }));
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("history API failure → error message shown (no crash)", async () => {
    auth.current = signedIn();
    vi.stubGlobal("fetch", routeFetch({ "GET /api/billing/history": () => json({ success: false, error: "Internal server error." }, 500) }));
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("Internal server error.")).toBeInTheDocument();
  });

  it("refreshes balance on mount", async () => {
    const ctx = signedIn();
    auth.current = ctx;
    vi.stubGlobal("fetch", routeFetch({ "GET /api/billing/history": () => json({ success: true, data: { transactions: [] } }) }));
    renderWithProviders(<DashboardPage />);
    await screen.findByText("No transactions yet");
    expect(ctx.fetchBalance).toHaveBeenCalled();
  });

  it("guest → client-side redirect to /login (defence in depth behind the middleware)", () => {
    auth.current = makeAuth();
    renderWithProviders(<DashboardPage />);
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("guest returning from Lemon checkout (?payment=success) is NOT bounced to login while the session rehydrates", () => {
    auth.current = makeAuth();
    window.history.replaceState({}, "", "/dashboard?payment=success&credits=50");
    try {
      renderWithProviders(<DashboardPage />);
      expect(router.replace).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
});

describe("ledger formatting helpers", () => {
  it.each([
    ["CREDIT_PURCHASE", "Credit Purchase", "purchase"],
    ["STRIPE_PURCHASE", "Stripe Purchase", "purchase"],
    ["SIGNUP_BONUS", "Signup Bonus", "bonus"],
    ["CREDIT_CONSUMPTION", "AI Usage", "usage"],
    ["AI_GENERATION_DEDUCTION", "AI Generation", "usage"],
    ["CREDIT_REFUND", "Auto Refund", "refund"],
    ["REFUND", "Refund", "refund"],
    ["ADMIN_ADJUSTMENT", "Admin Adjustment", "neutral"],
  ])("%s → '%s' (%s badge)", (type, label, variant) => {
    expect(formatTransactionType(type)).toBe(label);
    expect(ledgerBadgeVariant(type)).toBe(variant);
  });

  // FINDING-28 (Info): the fallback formatter only upper-cases first letters, so unknown types render
  // as "SOME NEW TYPE" instead of the intended Title Case.
  it.fails("unknown ledger types fall back to Title Case (FINDING-28)", () => {
    expect(formatTransactionType("SOME_NEW_TYPE")).toBe("Some New Type");
  });

  it("amounts are signed; zero has no plus", () => {
    expect([formatLedgerAmount(50), formatLedgerAmount(-3), formatLedgerAmount(0)]).toEqual(["+50", "-3", "0"]);
  });

  it("descriptions never expose raw reference ids", () => {
    expect(formatTransactionDescription({ transaction_type: "CREDIT_PURCHASE", reference_id: "ls_order_123" })).not.toContain("ls_order_123");
  });
});
