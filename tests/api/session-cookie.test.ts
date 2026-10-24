/**
 * Session cookie lifecycle (FINDING-24): the BFF issues the httpOnly cookie itself from the
 * login / Google / verify-email responses and strips the JWT from the body; logout and
 * clear-cookie remove it; cross-site state-changing requests are refused. Tested through the real
 * gateway against the real Express service. The middleware that gates /dashboard, /ai-lab and
 * /profile follows.
 * `next/headers` cookies() needs a request scope, so clear-cookie runs against a recording store.
 */
import { NextRequest } from "next/server";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { craftToken, freshIp } from "../../services/auth-billing-service/tests/support/auth";
import { createTestPool, createUser, uniqueEmail } from "../../services/auth-billing-service/tests/support/db";
import { googleIdToken, stubGoogleCerts } from "../../services/auth-billing-service/tests/support/google";
import { hashPassword } from "../../services/auth-billing-service/src/utils/password";
import { callGateway } from "../support/bff";
import { startAuthBillingService, type RunningService } from "../support/express-server";

const jar = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { POST as clearCookie } from "@/app/api/auth/clear-cookie/route";
import { config as middlewareConfig, middleware } from "@/middleware";

let service: RunningService;
let db: pg.Pool;
beforeAll(async () => {
  service = await startAuthBillingService();
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await service.close();
});
beforeEach(() => {
  jar.set.mockReset();
  jar.delete.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  process.env.AUTH_SERVICE_URL = `${service.origin}/api/auth`;
});

const PASSWORD = "Cookie-pass-123";

async function verifiedUser() {
  const email = uniqueEmail("cookie");
  await createUser(db, { email, verified: true, passwordHash: await hashPassword(PASSWORD) });
  return email;
}

function postAuth(path: string, body: unknown, headers: Record<string, string> = {}) {
  return callGateway("auth", path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": freshIp(), ...headers },
    body: JSON.stringify(body),
  });
}

/** Parse one Set-Cookie header into name/value/attributes. */
function parseSetCookie(header: string | null) {
  expect(header, "expected a Set-Cookie header").not.toBeNull();
  const [pair, ...attrs] = header!.split(";").map((p) => p.trim());
  const [name, ...value] = pair!.split("=");
  const map = Object.fromEntries(attrs.map((a) => {
    const [k, ...v] = a.split("=");
    return [k!.toLowerCase(), v.join("=") || true];
  }));
  return { name, value: value.join("="), attrs: map as Record<string, string | true> };
}

describe("session cookie issued by the BFF (replaces /api/auth/set-cookie)", () => {
  it("login: httpOnly, SameSite=Strict, Path=/, Max-Age = the JWT's remaining lifetime, not Secure outside production; no token in the body", async () => {
    const email = await verifiedUser();
    const res = await postAuth("login", { email, password: PASSWORD });
    expect(res.status).toBe(200);

    const cookie = parseSetCookie(res.headers.get("set-cookie"));
    expect(cookie.name).toBe("session_token");
    expect(cookie.value.split(".")).toHaveLength(3);
    expect(cookie.attrs).toMatchObject({ path: "/", httponly: true, samesite: "Strict" });
    expect(cookie.attrs.secure).toBeUndefined();
    // Tests issue 1h tokens (JWT_EXPIRES_IN=1h): the cookie never outlives the token.
    expect(Number(cookie.attrs["max-age"])).toBeGreaterThan(3590);
    expect(Number(cookie.attrs["max-age"])).toBeLessThanOrEqual(3600);

    const body = await res.json();
    expect(body.data.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(cookie.value);
    expect(body.data.user.email).toBe(email);
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const email = await verifiedUser();
      const res = await postAuth("login", { email, password: PASSWORD }, { origin: "http://localhost:3000" });
      expect(parseSetCookie(res.headers.get("set-cookie")).attrs.secure).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Google sign-in issues the cookie and strips the token too", async () => {
    stubGoogleCerts();
    const res = await postAuth("google", { idToken: googleIdToken({ email: uniqueEmail("g") }) });
    expect(res.status).toBe(200);
    expect(parseSetCookie(res.headers.get("set-cookie")).attrs.httponly).toBe(true);
    expect((await res.json()).data.token).toBeUndefined();
  });

  it("a failed login sets no cookie", async () => {
    const res = await postAuth("login", { email: uniqueEmail("nobody"), password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("registration sets no cookie and returns no token (FINDING-09 + FINDING-24)", async () => {
    const res = await postAuth("register", { email: uniqueEmail("reg"), password: PASSWORD, firstName: "A", lastName: "B", dateOfBirth: "1990-01-01" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await res.json())).not.toMatch(/token/);
  });

  it("logout through the BFF revokes the token and clears the cookie", async () => {
    const email = await verifiedUser();
    const login = await postAuth("login", { email, password: PASSWORD });
    const token = parseSetCookie(login.headers.get("set-cookie")).value;
    const out = await callGateway("auth", "logout", { method: "POST", cookie: `session_token=${token}` });
    expect(out.status).toBe(200);
    const cleared = parseSetCookie(out.headers.get("set-cookie"));
    expect(cleared).toMatchObject({ name: "session_token", value: "" });
    expect(cleared.attrs["max-age"]).toBe("0");
    expect((await callGateway("auth", "me", { cookie: `session_token=${token}` })).status).toBe(401);
  });

  it("/api/auth/set-cookie no longer exists (the browser never handles the JWT)", async () => {
    const fs = await import("node:fs");
    expect(fs.existsSync("src/app/api/auth/set-cookie/route.ts")).toBe(false);
  });
});

describe("cross-site state-changing requests are refused (login/logout CSRF)", () => {
  it.each([
    ["foreign Origin", { origin: "https://evil.example" }],
    ["look-alike Origin", { origin: "http://localhost:3000.evil.example" }],
    ["Origin: null (sandboxed/file)", { origin: "null" }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
  ])("%s → 403 CSRF_REJECTED, no cookie, nothing reaches the service", async (_l, headers) => {
    const email = await verifiedUser();
    const res = await postAuth("login", { email, password: PASSWORD }, headers);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Cross-site request refused.", code: "CSRF_REJECTED" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("same-origin browser requests and server-to-server calls (no Origin) pass", async () => {
    const email = await verifiedUser();
    expect((await postAuth("login", { email, password: PASSWORD }, { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await postAuth("login", { email, password: PASSWORD })).status).toBe(200);
  });

  it("accepts FRONTEND_URL as an allowed origin; localhost is not accepted in production", async () => {
    vi.stubEnv("FRONTEND_URL", "https://studio.example");
    try {
      const email = await verifiedUser();
      expect((await postAuth("login", { email, password: PASSWORD }, { origin: "https://studio.example" })).status).toBe(200);
      vi.stubEnv("NODE_ENV", "production");
      expect((await postAuth("login", { email, password: PASSWORD }, { origin: "http://localhost:3000" })).status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("GET requests are not subject to the guard (no state change)", async () => {
    const res = await callGateway("auth", "me", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(401); // reached the service, which wants a session
  });
});

describe("POST /api/auth/clear-cookie", () => {
  const clear = (headers: Record<string, string> = {}) =>
    clearCookie(new Request("http://localhost:3000/api/auth/clear-cookie", { method: "POST", headers }));

  it("deletes session_token for same-origin / server calls", async () => {
    expect((await clear({ origin: "http://localhost:3000" })).status).toBe(200);
    expect((await clear()).status).toBe(200);
    expect(jar.delete).toHaveBeenCalledTimes(2);
    expect(jar.delete).toHaveBeenCalledWith("session_token");
  });

  it.each([[{ origin: "https://evil.example" }], [{ "sec-fetch-site": "cross-site" }]])(
    "refuses a cross-site logout %j (403) and keeps the cookie",
    async (headers) => {
      const res = await clear(headers);
      expect(res.status).toBe(403);
      expect(jar.delete).not.toHaveBeenCalled();
    },
  );
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

  it("a session token without the tv claim (issued before session versioning) → redirect and the cookie is deleted", async () => {
    const res = await middleware(req("/dashboard", craftToken({ tv: undefined })));
    expect(res.status).toBe(307);
    expect(res.headers.get("set-cookie")).toMatch(/session_token=;/);
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
