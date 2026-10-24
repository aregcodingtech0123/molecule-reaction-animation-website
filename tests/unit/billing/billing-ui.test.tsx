import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, LinkMock, makeAuth, navigationMock, renderWithProviders, routeFetch, router, signedIn } from "../../support/mocks";

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.current }));
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/link", () => ({ default: LinkMock }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { PricingCards } from "@/components/billing/PricingCards";
import PricingPage from "@/app/pricing/page";
import { Navbar } from "@/components/layout/Navbar";
import { useCreditCheckout } from "@/lib/billing/useCreditCheckout";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { toast } from "@/lib/toast";
import { StudioModeProvider } from "@/context/StudioModeContext";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>
    <ThemeProvider>{children}</ThemeProvider>
  </LanguageProvider>
);

beforeEach(() => {
  auth.current = makeAuth();
  router.push.mockReset();
  router.replace.mockReset();
});

describe("PricingCards", () => {
  it("lists the three USD packs with credits and prices", () => {
    renderWithProviders(<PricingCards onPurchase={vi.fn()} />);
    const cards = screen.getAllByRole("article");
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual(["Starter Pack", "Pro Pack", "Studio Pack"]);
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringMatching(/50credits.*\$5USD/),
      expect.stringMatching(/250credits.*\$20USD/),
      expect.stringMatching(/700credits.*\$50USD/),
    ]);
    expect(within(cards[2]!).getByText("Best Value")).toBeInTheDocument();
  });

  it("CTA reads 'Get Started' for guests and 'Buy Now' when signed in", () => {
    const { unmount } = renderWithProviders(<PricingCards onPurchase={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Get Started" })).toHaveLength(3);
    unmount();
    auth.current = signedIn();
    renderWithProviders(<PricingCards onPurchase={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Buy Now" })).toHaveLength(3);
  });

  it("clicking a pack calls onPurchase with its id", async () => {
    const onPurchase = vi.fn();
    renderWithProviders(<PricingCards onPurchase={onPurchase} />);
    await userEvent.click(screen.getAllByRole("button")[1]!);
    expect(onPurchase).toHaveBeenCalledWith("pro");
  });

  it("while one pack is loading: it shows 'Redirecting…' and every button is disabled (no double checkout)", () => {
    auth.current = signedIn();
    renderWithProviders(<PricingCards onPurchase={vi.fn()} loadingId="starter" />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Redirecting");
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("useCreditCheckout", () => {
  it("guest: remembers the intent and routes to sign-in with the pack in the URL (no API call)", async () => {
    // Variant ids come from build-time env only (FINDING-13, TEST_CHANGES TC-36).
    vi.stubEnv("NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_PRO", "2154661");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCreditCheckout({ guestAuthMode: "signup" }), { wrapper });
    await act(() => result.current.purchase("pro"));
    expect(router.push).toHaveBeenCalledWith("/signup?redirect_checkout=pro&variant_id=2154661");
    expect(sessionStorage.getItem("moleculestudio_checkout_intent")).toBe("pro");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signed in: POSTs {packageId, returnPath} and navigates to the Lemon checkout URL", async () => {
    auth.current = signedIn({ credits: 4 });
    let body: unknown;
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "POST /api/billing/checkout": (init) => {
          body = JSON.parse(String(init?.body));
          return json({ success: true, data: { provider: "lemonsqueezy", currency: "USD", mode: "redirect", checkoutUrl: "https://store.test/checkout/abc", orderId: "o1" } });
        },
      }),
    );
    const hrefSetter = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, pathname: "/pricing", set href(v: string) { hrefSetter(v); } },
    });
    try {
      const { result } = renderHook(() => useCreditCheckout(), { wrapper });
      await act(() => result.current.purchase("enterprise"));
      expect(body).toEqual({ packageId: "enterprise", returnPath: "/pricing" });
      expect(hrefSetter).toHaveBeenCalledWith("https://store.test/checkout/abc");
      // Pre-payment balance is remembered (tab-scoped) so the return trip can poll for the webhook credit.
      expect(JSON.parse(sessionStorage.getItem("moleculestudio.checkout-watch")!)).toMatchObject({ packageId: "enterprise", baseline: 4 });
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("API error: surfaces the server message, toasts it, and re-enables the buttons", async () => {
    auth.current = signedIn();
    vi.stubGlobal("fetch", routeFetch({ "POST /api/billing/checkout": () => json({ success: false, error: "Unable to create Lemon Squeezy checkout." }, 502) }));
    const { result } = renderHook(() => useCreditCheckout(), { wrapper });
    await act(() => result.current.purchase("starter"));
    expect(result.current.error).toBe("Unable to create Lemon Squeezy checkout.");
    expect(result.current.loadingId).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Unable to create Lemon Squeezy checkout.");
  });

  it("an HTML 502 from a dead backend becomes a readable error instead of a JSON SyntaxError", async () => {
    auth.current = signedIn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    const { result } = renderHook(() => useCreditCheckout(), { wrapper });
    await act(() => result.current.purchase("starter"));
    expect(result.current.error).toMatch(/Backend unavailable \(HTTP 502\)/);
  });
});

describe("Pricing page", () => {
  it("shows the current balance only when signed in", () => {
    const { unmount } = renderWithProviders(<PricingPage />);
    expect(screen.queryByText(/Current balance/)).not.toBeInTheDocument();
    unmount();
    auth.current = signedIn({ credits: 42 });
    renderWithProviders(<PricingPage />);
    expect(screen.getByText(/Current balance: 42/)).toBeInTheDocument();
  });
});

describe("Navbar credit balance", () => {
  it("shows the live credit balance and opens the billing modal from it", async () => {
    const ctx = signedIn({ credits: 37 });
    auth.current = ctx;
    renderWithProviders(<StudioModeProvider><Navbar /></StudioModeProvider>);
    // Desktop renders the compact chip: the balance alone.
    const chip = screen.getByRole("button", { name: "37" });
    await userEvent.click(chip);
    expect(ctx.openBillingModal).toHaveBeenCalled();
  });

  it("shows a placeholder while the balance is unknown", () => {
    auth.current = signedIn({ credits: null });
    renderWithProviders(<StudioModeProvider><Navbar /></StudioModeProvider>);
    expect(screen.getByRole("button", { name: "—" })).toBeInTheDocument();
  });

  it("guests see sign-in / sign-up actions and no balance", () => {
    renderWithProviders(<StudioModeProvider><Navbar /></StudioModeProvider>);
    expect(screen.queryByRole("button", { name: /^\d+$|^—$/ })).not.toBeInTheDocument();
  });
});
