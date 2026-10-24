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

  it("login: sends the JWT only to /api/auth/set-cookie, stores the user profile but never the token", async () => {
    let setCookieBody: unknown;
    const fetchMock = routeFetch({
      "GET /api/billing/balance": () => json({ success: true, data: { userId: testUser.id, balance: 10, hasCredits: true } }),
      "GET /api/users/profile": () => json({ success: false }, 401),
      "POST /api/auth/login": () => json({ success: true, data: { message: "Login successful.", token: JWT, user: testUser } }),
      "POST /api/auth/set-cookie": (init) => {
        setCookieBody = JSON.parse(String(init?.body));
        return json({ success: true });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));

    await act(() => ctx.login("ada@example.test", "Correct-1"));

    expect(setCookieBody).toEqual({ token: JWT });
    expect(screen.getByTestId("state")).toHaveTextContent("in:10");
    expect(JSON.parse(localStorage.getItem(AUTH_USER_STORAGE_KEY)!)).toEqual(testUser);
    expect(storageContainsJwt()).toBe(false);

    const calls = fetchMock.mock.calls.map(([u, init]) => `${init?.method ?? "GET"} ${u}`);
    expect(calls).toContain("POST /api/auth/set-cookie");
    expect(fetchMock.mock.calls.every(([, init]) => (init?.credentials ?? "include") === "include")).toBe(true);
  });

  it("login fails when the session cookie cannot be established (no half-signed-in state)", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": () => json({}, 401),
        "GET /api/users/profile": () => json({}, 401),
        "POST /api/auth/login": () => json({ success: true, data: { message: "ok", token: JWT, user: testUser } }),
        "POST /api/auth/set-cookie": () => json({ error: "FORBIDDEN" }, 403),
      }),
    );
    mount();
    await waitFor(() => expect(ctx.isHydrated).toBe(true));
    await expect(act(() => ctx.login("ada@example.test", "Correct-1"))).rejects.toThrow("Failed to establish session.");
    expect(ctx.isAuthenticated).toBe(false);
    expect(localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
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
