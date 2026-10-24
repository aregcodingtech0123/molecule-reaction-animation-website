/**
 * Real AuthProvider with fetch doubled at the browser boundary: proves the JWT
 * only ever travels to /api/auth/set-cookie and is never persisted in web storage.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, navigationMock, routeFetch, testUser } from "../../support/mocks";

vi.mock("next/navigation", () => navigationMock);
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AuthProvider, useAuth } from "@/context/AuthContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { AUTH_TOKEN_STORAGE_KEY, AUTH_USER_STORAGE_KEY } from "@/lib/auth/types";
import { fetchBalanceRequest } from "@/lib/auth/api";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig";

let ctx: ReturnType<typeof useAuth>;
function Probe() {
  ctx = useAuth();
  return <div data-testid="state">{ctx.isAuthenticated ? `in:${ctx.credits}` : "out"}</div>;
}
const mount = () =>
  render(
    <LanguageProvider>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </LanguageProvider>,
  );

function storageContainsJwt(): boolean {
  const dump = (s: Storage) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i)!)}`).join("\n");
  return (dump(localStorage) + dump(sessionStorage)).includes(JWT);
}

describe("AuthContext session handling", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": () => json({ success: false, error: "Authentication required." }, 401),
        "GET /api/users/profile": () => json({ success: false }, 401),
      }),
    );
  });

  it("guest hydrate: stays signed out and does not open the login modal", async () => {
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    expect(screen.getByTestId("state")).toHaveTextContent("out");
    expect(ctx.authModalOpen).toBe(false);
  });

  it("removes any legacy JWT left in localStorage on mount", async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, JWT);
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("login: the browser never receives the JWT (the BFF sets the httpOnly cookie); only the profile is stored", async () => {
    // Phase 1 asserted the token went only to /api/auth/set-cookie; that route is gone (FINDING-24,
    // TEST_CHANGES TC-27): the login response carries no token at all.
    const fetchMock = routeFetch({
      "GET /api/billing/balance": () => json({ success: true, data: { userId: testUser.id, balance: 10, hasCredits: true } }),
      "GET /api/users/profile": () => json({ success: false }, 401),
      "POST /api/auth/login": () => json({ success: true, data: { message: "Login successful.", user: testUser } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));

    await act(() => ctx.login("ada@example.test", "Correct-1"));

    expect(screen.getByTestId("state")).toHaveTextContent("in:10");
    expect(JSON.parse(localStorage.getItem(AUTH_USER_STORAGE_KEY)!)).toEqual(testUser);
    expect(storageContainsJwt()).toBe(false);
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    const calls = fetchMock.mock.calls.map(([u, init]) => `${init?.method ?? "GET"} ${u}`);
    expect(calls.some((c) => c.includes("set-cookie"))).toBe(false);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.credentials ?? "include") === "include")).toBe(true);
  });

  it("a failed login leaves no half-signed-in state", async () => {
    // Replaces "login fails when the session cookie cannot be established" (TC-27): the client no
    // longer establishes the cookie, so the failure mode is the login call itself.
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": () => json({}, 401),
        "GET /api/users/profile": () => json({}, 401),
        "POST /api/auth/login": () => json({ success: false, error: "Invalid email or password.", code: "INVALID_CREDENTIALS" }, 401),
      }),
    );
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    await expect(act(() => ctx.login("ada@example.test", "Wrong-1"))).rejects.toThrow("Invalid email or password.");
    expect(ctx.isAuthenticated).toBe(false);
    expect(localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
  });

  it("completeSignIn adopts a server-established session (email verification) and loads the balance", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": (() => {
          let n = 0;
          return () => (n++ === 0 ? json({}, 401) : json({ success: true, data: { userId: testUser.id, balance: 10, hasCredits: true } }));
        })(),
        "GET /api/users/profile": () => json({}, 401),
      }),
    );
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    await act(() => ctx.completeSignIn(testUser));
    expect(screen.getByTestId("state")).toHaveTextContent("in:10");
    expect(JSON.parse(localStorage.getItem(AUTH_USER_STORAGE_KEY)!)).toEqual(testUser);
  });

  it("logout: revokes server-side, clears the cookie and local profile", async () => {
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(testUser));
    const fetchMock = routeFetch({
      "GET /api/billing/balance": () => json({ success: true, data: { userId: testUser.id, balance: 3, hasCredits: true } }),
      "GET /api/users/profile": () => json({ success: true, data: testUser }),
      "POST /api/auth/logout": () => json({ success: true, data: { message: "Logged out." } }),
      "POST /api/auth/clear-cookie": () => json({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:3"));

    act(() => ctx.logout());
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));

    const order = fetchMock.mock.calls.map(([u, init]) => `${init?.method ?? "GET"} ${u}`);
    expect(order.indexOf("POST /api/auth/logout")).toBeLessThan(order.indexOf("POST /api/auth/clear-cookie"));
    expect(localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
  });

  it("a 401 on an authenticated call signs the user out locally (session expiry)", async () => {
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(testUser));
    let balanceStatus = 200;
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": () =>
          balanceStatus === 200 ? json({ success: true, data: { userId: testUser.id, balance: 5, hasCredits: true } }) : json({}, 401),
        "GET /api/users/profile": () => json({ success: true, data: testUser }),
        "POST /api/auth/clear-cookie": () => json({ success: true }),
      }),
    );
    mount();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:5"));

    balanceStatus = 401;
    await act(() => ctx.fetchBalance());
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    expect(localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
  });

  it("register with an existing email shows the generic message and does not sign in", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": () => json({}, 401),
        "GET /api/users/profile": () => json({}, 401),
        "POST /api/auth/register": () => json({ success: true, data: { message: "If this email address is new…" } }),
      }),
    );
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    await act(() => ctx.register("ada@example.test", "Letters123", { firstName: "A", lastName: "B", dateOfBirth: "1990-01-01" }));
    expect(ctx.isAuthenticated).toBe(false);
  });
});

describe("guest auth gate vs. late hydration probes (FINDING-33)", () => {
  /**
   * /login and /signup open the dialog as soon as hydration finishes. Hydration ends on the FIRST
   * 401 of its two probes; the second probe's 401 used to arrive afterwards and the global 401
   * handler closed the dialog the guest had just been shown (E2E saw it on mobile).
   */
  async function openGateThenLateProbe() {
    let releaseProfile!: () => void;
    const profileGate = new Promise<void>((r) => (releaseProfile = r));
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": () => json({ success: false, error: "Authentication required." }, 401),
        "GET /api/users/profile": async () => {
          await profileGate;
          return json({ success: false }, 401);
        },
        "POST /api/auth/clear-cookie": () => json({ success: true }),
      }),
    );
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    act(() => ctx.openAuthModal("register")); // what AuthGatePage does once hydrated
    expect(ctx.authModalOpen).toBe(true);

    await act(async () => {
      releaseProfile();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("a guest's late 401 probe does not close a dialog the guest is looking at (FINDING-33)", async () => {
    await openGateThenLateProbe();
    expect(ctx.authModalOpen).toBe(true);
  });

  it("an expired real session still closes stale dialogs on 401", async () => {
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(testUser));
    let status = 200;
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": () => (status === 200 ? json({ success: true, data: { userId: testUser.id, balance: 1, hasCredits: true } }) : json({}, 401)),
        "GET /api/users/profile": () => json({ success: true, data: testUser }),
        "POST /api/auth/clear-cookie": () => json({ success: true }),
      }),
    );
    mount();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:1"));
    act(() => ctx.openAuthModal("login"));
    status = 401;
    await act(() => ctx.fetchBalance());
    await waitFor(() => expect(ctx.authModalOpen).toBe(false));
    expect(ctx.isAuthenticated).toBe(false);
  });
});

describe("stale 401 from before sign-in (FINDING-33, extended in Phase 1.5 Batch 3)", () => {
  /**
   * Email verification is now the moment a new account signs in (FINDING-09). A balance request
   * sent BEFORE the session cookie existed can answer 401 AFTER sign-in; it must not be taken as
   * "session expired" (which cleared the brand-new cookie — seen in the E2E mobile run).
   */
  it("a 401 for a request issued before sign-in does not sign the user out or clear the cookie", async () => {
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((r) => (releaseStale = r));
    let balanceCalls = 0;
    const fetchMock = routeFetch({
      "GET /api/billing/balance": async () => {
        balanceCalls += 1;
        if (balanceCalls === 2) {
          await staleGate; // the in-flight guest request
          return json({}, 401);
        }
        return balanceCalls === 1 ? json({}, 401) : json({ success: true, data: { userId: testUser.id, balance: 10, hasCredits: true } });
      },
      "GET /api/users/profile": () => json({}, 401),
      "POST /api/auth/clear-cookie": () => json({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));

    const inflight = fetchBalanceRequest().catch(() => null); // guest-era authFetch, still pending
    await waitFor(() => expect(balanceCalls).toBe(2));
    await act(() => ctx.completeSignIn(testUser)); // verification signs the user in
    const callsAtSignIn = fetchMock.mock.calls.length;
    await act(async () => {
      releaseStale();
      await inflight;
    });

    expect(ctx.isAuthenticated).toBe(true);
    // (Guest-era probes may clear a non-existent cookie before sign-in; nothing may clear it after.)
    const after = fetchMock.mock.calls.slice(callsAtSignIn).map(([u, init]) => `${init?.method ?? "GET"} ${u}`);
    expect(after).not.toContain("POST /api/auth/clear-cookie");
  });

  it("a 401 for a request issued AFTER sign-in still signs the user out (real expiry)", async () => {
    let status = 200;
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": () =>
          status === 200 ? json({ success: true, data: { userId: testUser.id, balance: 10, hasCredits: true } }) : json({}, 401),
        "GET /api/users/profile": () => json({}, 401),
        "POST /api/auth/clear-cookie": () => json({ success: true }),
      }),
    );
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    await act(() => ctx.completeSignIn(testUser));
    status = 401;
    await act(() => ctx.fetchBalance());
    await waitFor(() => expect(ctx.isAuthenticated).toBe(false));
  });
});

describe("guest 401 probes never clear cookies", () => {
  it("hydrating as a guest sends no clear-cookie (it could race a sign-in and delete the new session)", async () => {
    const fetchMock = routeFetch({
      "GET /api/billing/balance": () => json({}, 401),
      "GET /api/users/profile": () => json({}, 401),
      "POST /api/auth/clear-cookie": () => json({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    const calls = fetchMock.mock.calls.map(([u, init]) => `${init?.method ?? "GET"} ${u}`);
    expect(calls).not.toContain("POST /api/auth/clear-cookie");
  });
});
