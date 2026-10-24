/**
 * Session cookie lifecycle on the Next side: set-cookie (origin-guarded),
 * clear-cookie, and the middleware that gates /dashboard, /ai-lab, /profile.
 * `next/headers` cookies() needs a request scope, so it is replaced with a
 * recording store; the resulting Set-Cookie header is asserted for real in E2E.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { craftToken } from "../../services/auth-billing-service/tests/support/auth";

const jar = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { POST as setCookie } from "@/app/api/auth/set-cookie/route";
import { POST as clearCookie } from "@/app/api/auth/clear-cookie/route";
import { config as middlewareConfig, middleware } from "@/middleware";

beforeEach(() => {
  jar.set.mockReset();
  jar.delete.mockReset();
});

const post = (body: unknown, origin: string | null = "http://localhost:3000") =>
  setCookie(
    new Request("http://localhost:3000/api/auth/set-cookie", {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/auth/set-cookie", () => {
  it("sets session_token httpOnly, SameSite=Strict, path=/, 7 days, not Secure outside production", async () => {
    const token = craftToken();
    const res = await post({ token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(jar.set).toHaveBeenCalledWith("session_token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
      maxAge: 604800,
    });
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await post({ token: craftToken() });
      expect(jar.set.mock.calls[0]![2]).toMatchObject({ secure: true, httpOnly: true, sameSite: "strict" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ["missing Origin", null],
    ["foreign Origin", "https://evil.example"],
    ["look-alike Origin", "http://localhost:3000.evil.example"],
  ])("%s → 403 and no cookie", async (_l, origin) => {
    const res = await post({ token: craftToken() }, origin);
    expect(res.status).toBe(403);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("accepts FRONTEND_URL as an allowed origin", async () => {
    vi.stubEnv("FRONTEND_URL", "https://studio.example");
    try {
      expect((await post({ token: craftToken() }, "https://studio.example")).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ["invalid JSON", "{", 400],
    ["missing token", {}, 400],
    ["blank token", { token: "  " }, 400],
    ["token signed with another secret", { token: craftToken({}, { secret: "z".repeat(40) }) }, 401],
    ["expired token", { token: craftToken({}, { expiresIn: -1 }) }, 401],
    ["wrong audience", { token: craftToken({}, { audience: "x" }) }, 401],
  ])("%s → %i and no cookie", async (_l, body, status) => {
    const res = await post(body);
    expect(res.status).toBe(status);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("cookie lifetime (7d) matches the service's default JWT_EXPIRES_IN (7d)", async () => {
    await post({ token: craftToken() });
    expect(jar.set.mock.calls[0]![2].maxAge).toBe(7 * 24 * 60 * 60);
  });
});

describe("POST /api/auth/clear-cookie", () => {
  it("deletes session_token", async () => {
    const res = await clearCookie();
    expect(res.status).toBe(200);
    expect(jar.delete).toHaveBeenCalledWith("session_token");
  });
});

describe("middleware route protection", () => {
  const req = (path: string, token?: string) =>
    new NextRequest(`http://localhost:3000${path}`, token ? { headers: { cookie: `session_token=${token}` } } : undefined);

  it("matches exactly the protected sections", () => {
    expect(middlewareConfig.matcher).toEqual(["/dashboard/:path*", "/ai-lab/:path*", "/profile/:path*"]);
  });

  it.each(["/dashboard", "/ai-lab", "/profile", "/dashboard/billing"])("%s without a session → redirect to /login", async (path) => {
    const res = await middleware(req(`${path}?auth=required&x=1`));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("auth")).toBeNull();
  });

  it("an invalid/expired session → redirect to /login and the stale cookie is deleted", async () => {
    const res = await middleware(req("/dashboard", craftToken({}, { expiresIn: -1 })));
    expect(res.status).toBe(307);
    expect(res.headers.get("set-cookie")).toMatch(/session_token=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });

  it("a valid session passes through", async () => {
    const res = await middleware(req("/ai-lab", craftToken()));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/", "/explore", "/periodic-table", "/atom-models", "/pricing", "/dashboards"])("public %s is never redirected", async (path) => {
    const res = await middleware(req(path));
    expect(res.headers.get("location")).toBeNull();
  });
});
