/**
 * Shared doubles for client components. Each test file opts in with
 * `vi.mock("next/navigation", () => navigationMock)` etc. so the real module
 * graph is used everywhere else.
 */
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import type { AuthUser } from "@/lib/auth/types";

export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
  forward: vi.fn(),
};
export const navState = { pathname: "/", search: new URLSearchParams() };

export const navigationMock = {
  useRouter: () => router,
  usePathname: () => navState.pathname,
  useSearchParams: () => navState.search,
};

export function LinkMock({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <a href={typeof href === "string" ? href : String(href)} {...rest}>
      {children}
    </a>
  );
}

export const testUser: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.test",
  firstName: "Ada",
  lastName: "Lovelace",
  dateOfBirth: "1990-12-10",
  isAdmin: false,
  isVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export function makeAuth(overrides: Record<string, unknown> = {}) {
  return {
    user: null as AuthUser | null,
    token: null,
    credits: null as number | null,
    isAuthenticated: false,
    isHydrated: true,
    isAuthLoading: false,
    isGoogleLoading: false,
    authModalOpen: false,
    authModalMode: "login" as const,
    sessionExpired: false,
    sessionExpiredMessage: null,
    billingModalOpen: false,
    billingModalMessage: null,
    openAuthModal: vi.fn(),
    closeAuthModal: vi.fn(),
    openBillingModal: vi.fn(),
    closeBillingModal: vi.fn(),
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    loginWithGoogle: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    fetchBalance: vi.fn().mockResolvedValue(null),
    patchUser: vi.fn(),
    ...overrides,
  };
}

export function signedIn(overrides: Record<string, unknown> = {}) {
  return makeAuth({ user: testUser, isAuthenticated: true, credits: 10, ...overrides });
}

/** Real Language + Theme providers; auth comes from the per-file useAuth mock. */
export function renderWithProviders(ui: ReactNode) {
  return render(
    <LanguageProvider>
      <ThemeProvider>{ui}</ThemeProvider>
    </LanguageProvider>,
  );
}

/** Minimal fetch double that routes by "METHOD path". */
export function routeFetch(routes: Record<string, (init: RequestInit | undefined, url: string) => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]!;
    const key = `${(init?.method ?? "GET").toUpperCase()} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected fetch: ${key}`);
    return handler(init, url);
  });
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
