import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "../../services/auth-billing-service/src/utils/password";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyToService } from "@/lib/gateway";
import { createTestPool, createUser, uniqueEmail } from "../../services/auth-billing-service/tests/support/db";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { orderCreatedEvent, signedBody } from "../../services/auth-billing-service/tests/support/lemon";
import { callGateway, sessionCookie } from "../support/bff";
import { deadOrigin, startAuthBillingService, startFakeUpstream, type RunningService } from "../support/express-server";

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
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.env.AUTH_SERVICE_URL = `${service.origin}/api/auth`;
  process.env.BILLING_SERVICE_URL = `${service.origin}/api/billing`;
  process.env.USERS_SERVICE_URL = `${service.origin}/api/users`;
});

const PASSWORD = "Gateway-pass-1";
const profile = { firstName: "Gate", lastName: "Way", dateOfBirth: "1990-01-01" };
const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...extra },
  body: JSON.stringify(body),
});

describe("contract with the real Express service", () => {
  it("translates the session_token cookie into a Bearer header (GET /api/billing/balance)", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`SELECT post_credit_transaction($1, 7, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    const res = await callGateway("billing", "balance", { cookie: sessionCookie(tokenFor(u)) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { userId: u.id, balance: 7, hasCredits: true } });
  });

  it("an explicit Authorization header wins over the cookie", async () => {
    const a = await createUser(db, { balance: 1 });
    const b = await createUser(db, { balance: 2 });
    const res = await callGateway("billing", "balance", {
      cookie: sessionCookie(tokenFor(a)),
      headers: { authorization: `Bearer ${tokenFor(b)}` },
    });
    expect((await res.json()).data.userId).toBe(b.id);
  });

  it("no session → upstream 401 passes through unchanged", async () => {
    const res = await callGateway("billing", "balance");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Authentication required.", code: "UNAUTHORIZED" });
  });

  it("POST body, method and status pass through (register 201, then login 200)", async () => {
    const email = uniqueEmail("gw");
    const reg = await callGateway("auth", "register", json({ email, password: PASSWORD, ...profile }));
    expect(reg.status).toBe(201);
    const login = await callGateway("auth", "login", json({ email, password: PASSWORD }));
    expect(login.status).toBe(200);
    expect((await login.json()).data.user.email).toBe(email);
  });

  it("PUT /api/users/profile with the cookie session updates the caller", async () => {
    const u = await createUser(db);
    const res = await callGateway("users", "profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Proxy" }),
      cookie: sessionCookie(tokenFor(u)),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.firstName).toBe("Proxy");
  });

  it("query strings are forwarded (history?limit=1)", async () => {
    const u = await createUser(db, { balance: 0 });
    for (const ref of ["a", "b"]) await db.query(`SELECT post_credit_transaction($1, 1, 'SIGNUP_BONUS', $2)`, [u.id, ref]);
    const res = await callGateway("billing", "history?limit=1", { cookie: sessionCookie(tokenFor(u)) });
    expect((await res.json()).data.transactions).toHaveLength(1);
  });

  it("upstream error bodies and codes are preserved (402 INSUFFICIENT_CREDITS)", async () => {
    const u = await createUser(db, { balance: 0 });
    const res = await callGateway("billing", "consume", {
      ...json({ operationType: "AI_CHAT_QUERY", referenceId: "x" }),
      cookie: sessionCookie(tokenFor(u)),
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "INSUFFICIENT_CREDITS", requiredCredits: 1, balance: 0 });
  });
});

describe("header hygiene", () => {
  it("forwards only allow-listed request headers; never the raw Cookie header", async () => {
    let seen: Record<string, string | string[] | undefined> = {};
    const fake = await startFakeUpstream((req, _body, res) => {
      seen = req.headers;
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    try {
      process.env.BILLING_SERVICE_URL = fake.origin;
      await callGateway("billing", "anything", {
        cookie: sessionCookie("tok123"),
        headers: { "x-request-id": "rid-1", "x-idempotency-key": "idem-1", "x-evil": "1", "accept-language": "tr" },
      });
      expect(seen.authorization).toBe("Bearer tok123");
      expect(seen.cookie).toBeUndefined();
      expect(seen["x-evil"]).toBeUndefined();
      expect(seen["x-request-id"]).toBe("rid-1");
      expect(seen["x-idempotency-key"]).toBe("idem-1");
      expect(seen["accept-language"]).toBe("tr");
      expect(seen["x-forwarded-by"]).toBe("moleculestudio-gateway");
      expect(seen["x-gateway-service"]).toBe("billing");
    } finally {
      await fake.close();
    }
  });

  it("returns only allow-listed response headers (no upstream Set-Cookie / X-Powered-By / server details)", async () => {
    const fake = await startFakeUpstream((_req, _body, res) => {
      res.writeHead(201, {
        "content-type": "application/json",
        "set-cookie": "session_token=evil; Path=/",
        "x-powered-by": "Express",
        "retry-after": "30",
        "x-internal-host": "10.0.0.5",
      });
      res.end('{"ok":true}');
    });
    try {
      process.env.BILLING_SERVICE_URL = fake.origin;
      const res = await callGateway("billing", "x");
      expect(res.status).toBe(201);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("x-powered-by")).toBeNull();
      expect(res.headers.get("x-internal-host")).toBeNull();
      expect(res.headers.get("retry-after")).toBe("30");
    } finally {
      await fake.close();
    }
  });
});

describe("failure mapping (no internal URL leakage)", () => {
  const leaksInternals = (text: string) => /127\.0\.0\.1|localhost:\d|ECONNREFUSED|_SERVICE_URL=|http:\/\//.test(text);

  it("upstream down → 503 SERVICE_UNAVAILABLE", async () => {
    process.env.BILLING_SERVICE_URL = await deadOrigin();
    const res = await callGateway("billing", "balance");
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ success: false, error: "Service temporarily unavailable.", code: "SERVICE_UNAVAILABLE", service: "billing" });
    expect(leaksInternals(text)).toBe(false);
  });

  it("upstream hangs → 504 UPSTREAM_TIMEOUT after the configured timeout", async () => {
    const fake = await startFakeUpstream(() => undefined); // never responds
    try {
      process.env.BILLING_SERVICE_URL = fake.origin;
      const res = await proxyToService({
        service: "billing",
        request: new Request("http://localhost:3000/api/billing/balance"),
        pathSegments: ["balance"],
        timeoutMs: 100,
      });
      expect(res.status).toBe(504);
      expect((await res.json()).code).toBe("UPSTREAM_TIMEOUT");
    } finally {
      await fake.close();
    }
  });

  it("service URL not configured → 503 SERVICE_NOT_CONFIGURED", async () => {
    delete process.env.USERS_SERVICE_URL;
    const res = await callGateway("users", "profile");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SERVICE_NOT_CONFIGURED");
  });

  it("upstream 500 with HTML passes status through without crashing", async () => {
    const fake = await startFakeUpstream((_req, _b, res) => res.writeHead(500, { "content-type": "text/html" }).end("<h1>oops</h1>"));
    try {
      process.env.BILLING_SERVICE_URL = fake.origin;
      const res = await callGateway("billing", "x");
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toBe("text/html");
    } finally {
      await fake.close();
    }
  });

  it("upstream redirects are not followed (redirect: manual) — Location is not forwarded", async () => {
    const fake = await startFakeUpstream((_req, _b, res) => res.writeHead(302, { location: "http://10.0.0.5/internal" }).end());
    try {
      process.env.BILLING_SERVICE_URL = fake.origin;
      const res = await callGateway("billing", "x");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      await fake.close();
    }
  });
});

describe("routing", () => {
  it("the legacy /api/ai/* proxy has no route handler (only empty leftover directories)", () => {
    const dir = path.join(process.cwd(), "src/app/api/ai");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()) : [];
    expect(files).toEqual([]);
  });

  it("path segments are percent-encoded per segment (no `/` smuggling inside a segment)", async () => {
    let seenUrl = "";
    const fake = await startFakeUpstream((req, _b, res) => {
      seenUrl = req.url ?? "";
      res.writeHead(200).end("{}");
    });
    try {
      process.env.BILLING_SERVICE_URL = `${fake.origin}/api/billing`;
      await proxyToService({ service: "billing", request: new Request("http://localhost:3000/x"), pathSegments: ["a/b", "c?d"] });
      expect(seenUrl).toBe("/api/billing/a%2Fb/c%3Fd");
    } finally {
      await fake.close();
    }
  });

  it("a `..` segment escapes the service prefix (resolved by URL normalisation) — out-of-scope observation", async () => {
    let seenUrl = "";
    const fake = await startFakeUpstream((req, _b, res) => {
      seenUrl = req.url ?? "";
      res.writeHead(200).end("{}");
    });
    try {
      process.env.BILLING_SERVICE_URL = `${fake.origin}/api/billing`;
      await proxyToService({ service: "billing", request: new Request("http://localhost:3000/x"), pathSegments: ["..", "users", "profile"] });
      expect(seenUrl).toBe("/api/users/profile");
    } finally {
      await fake.close();
    }
  });
});

describe("cross-cutting findings", () => {
  // FINDING-23 (Medium): the BFF catch-all also proxies /api/billing/webhooks/lemonsqueezy but drops
  // X-Signature, so a Lemon webhook pointed at the public Next host (as .env.example suggests:
  // "https://YOUR_PUBLIC_HOST/api/billing/webhooks/lemonsqueezy") is always rejected with 401 and
  // no purchase is ever credited. The route should either forward the signature or refuse.
  it.fails("a correctly signed webhook sent to the Next host is either accepted or refused explicitly (FINDING-23)", async () => {
    const { raw, signature } = signedBody(orderCreatedEvent({ eventName: "order_refunded" }));
    const res = await callGateway("billing", "webhooks/lemonsqueezy", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body: raw,
    });
    expect([200, 404, 405]).toContain(res.status);
  });

  // FINDING-24 (Medium): login/register/google responses carry the JWT in the JSON body through
  // the BFF; the browser then POSTs it to /api/auth/set-cookie. Any XSS can read it from the
  // response, defeating the httpOnly cookie. The BFF should set the cookie and strip `token`.
  it.fails("the BFF login response does not expose the JWT to page JavaScript (FINDING-24)", async () => {
    const email = uniqueEmail("tok");
    await createUser(db, { email, passwordHash: await hashPassword(PASSWORD) });
    const login = await callGateway("auth", "login", json({ email, password: PASSWORD }));
    expect(login.status).toBe(200);
    const body = await login.json();
    expect(body.data.token).toBeUndefined();
  });
});
