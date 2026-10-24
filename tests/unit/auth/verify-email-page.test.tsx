/**
 * /verify-email posts a one-time token exactly once (FINDING-32) and adopts the session the BFF
 * set (FINDING-24 / FINDING-09: verification is how a new account first signs in).
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, makeAuth, navigationMock, navState, routeFetch, testUser } from "../../support/mocks";

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.current }));
vi.mock("next/navigation", () => navigationMock);
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import VerifyEmailPage from "@/app/verify-email/page";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";

const ui = () => (
  <LanguageProvider>
    <ThemeProvider>
      <VerifyEmailPage />
    </ThemeProvider>
  </LanguageProvider>
);

beforeEach(() => {
  navState.search = new URLSearchParams({ token: "raw-token-123" });
});

describe("verify-email page", () => {
  it("submits the token once even when auth callbacks change identity and the page re-renders", async () => {
    const fetchMock = routeFetch({
      "POST /api/auth/verify-email": () => json({ success: true, data: { message: "Email verified.", user: testUser } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    auth.current = makeAuth();
    const view = render(ui());
    await waitFor(() => expect(screen.getAllByText(/Email verified/).length).toBeGreaterThan(0));

    // New callback identities (what a context update produces) → effect dependencies change.
    for (let i = 0; i < 3; i++) {
      auth.current = makeAuth();
      act(() => view.rerender(ui()));
    }
    await act(async () => new Promise((r) => setTimeout(r, 0)));

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(screen.getAllByText(/Email verified/).length).toBeGreaterThan(0);
  });

  it("adopts the server-set session with the returned profile (no token handling in the page)", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "POST /api/auth/verify-email": () => json({ success: true, data: { message: "Email verified.", user: testUser } }) }),
    );
    const ctx = makeAuth();
    auth.current = ctx;
    render(ui());
    await waitFor(() => expect(ctx.completeSignIn).toHaveBeenCalledWith(testUser));
  });

  it("an invalid token shows the error once", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "POST /api/auth/verify-email": () => json({ success: false, error: "Invalid or expired verification link." }, 400) }),
    );
    auth.current = makeAuth();
    render(ui());
    expect(await screen.findByText("Invalid or expired verification link.")).toBeInTheDocument();
  });
});
