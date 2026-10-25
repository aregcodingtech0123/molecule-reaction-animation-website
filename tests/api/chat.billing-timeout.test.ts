/**
 * SEC-17: every BFF → billing call is bounded (BILLING_CALL_TIMEOUT_MS). Before, a billing service that accepted
 * the connection and never answered held the AI turn open for undici's ~300 s per attempt: the browser hung, and a
 * capture that finally landed after the hold's TTL left a delivered answer uncharged.
 */
import http from "node:http";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { createTestPool, createUser } from "../../services/auth-billing-service/tests/support/db";
import { sessionCookie } from "../support/bff";
import { startAuthBillingService, startFakeUpstream, type RunningService } from "../support/express-server";

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: gemini.generateContent } };
  }),
}));

import { POST } from "@/app/api/chat/route";

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
  process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
  vi.stubEnv("BILLING_CALL_TIMEOUT_MS", "300");
  gemini.generateContent.mockReset();
  gemini.generateContent.mockResolvedValue({ text: "Water is H2O." });
});

async function funded(balance = 5) {
  const u = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, balance]);
  return u;
}
const chat = (u: { id: string; email: string }) =>
  POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie(tokenFor(u)) },
      body: JSON.stringify({ messages: [{ role: "user", content: "What is water?" }] }),
    }),
  );

/** Forwards to the real billing service, except that `hang(path, n)` can swallow the n-th call to a path. */
async function billingThatHangs(hang: (path: string, n: number) => boolean) {
  const seen = new Map<string, number>();
  const parked: http.ServerResponse[] = [];
  const upstream = await startFakeUpstream(async (req, body, res) => {
    const path = req.url ?? "";
    const n = (seen.get(path) ?? 0) + 1;
    seen.set(path, n);
    if (hang(path, n)) {
      parked.push(res); // never answered
      return;
    }
    const forwarded = await fetch(`${service.origin}/api/billing${path}`, {
      method: req.method,
      headers: {
        authorization: String(req.headers.authorization),
        "content-type": "application/json",
        "x-internal-service-key": String(req.headers["x-internal-service-key"] ?? ""),
      },
      body: req.method === "GET" ? undefined : body,
    });
    res.writeHead(forwarded.status, { "content-type": "application/json" }).end(await forwarded.text());
  });
  process.env.BILLING_SERVICE_URL = upstream.origin;
  return Object.assign(upstream, { seen });
}

describe("BFF → billing calls are bounded (SEC-17)", () => {
  it("a reservation that never answers → 503 BILLING_UNAVAILABLE after the timeout; the model is not called", async () => {
    const billing = await billingThatHangs((path) => path === "/consume");
    try {
      const u = await funded();
      const started = Date.now();
      const res = await chat(u);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("BILLING_UNAVAILABLE");
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(gemini.generateContent).not.toHaveBeenCalled();
    } finally {
      await billing.close();
    }
  });

  it("a capture that hangs once is retried and charges exactly once", async () => {
    const billing = await billingThatHangs((path, n) => path === "/capture" && n === 1);
    try {
      vi.stubEnv("BILLING_RETRY_DELAYS_MS", "10,10,10");
      const u = await funded();
      const res = await chat(u);
      expect(res.status).toBe(200);
      expect(billing.seen.get("/capture")).toBe(2);
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM credit_ledger_transactions WHERE user_id = $1 AND transaction_type = 'CREDIT_CONSUMPTION'`,
        [u.id],
      );
      expect(rows[0].n).toBe(1);
      expect((await db.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [u.id])).rows[0].balance).toBe(4);
    } finally {
      await billing.close();
    }
  });

  it("defaults to 10 s; invalid values fall back", async () => {
    const { billingCallTimeoutMs } = await import("@/lib/billing/server-billing");
    expect(billingCallTimeoutMs({} as NodeJS.ProcessEnv)).toBe(10_000);
    expect(billingCallTimeoutMs({ BILLING_CALL_TIMEOUT_MS: "0" } as unknown as NodeJS.ProcessEnv)).toBe(10_000);
    expect(billingCallTimeoutMs({ BILLING_CALL_TIMEOUT_MS: "2500" } as unknown as NodeJS.ProcessEnv)).toBe(2_500);
  });
});
