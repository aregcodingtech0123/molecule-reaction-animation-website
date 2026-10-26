/**
 * PERF-29 / R18: when every pool connection is busy (a slow or overloaded database), each money route answers
 * 503 DATABASE_UNAVAILABLE with Retry-After — not 500 INTERNAL_ERROR — and nothing is charged or written.
 * The pool is genuinely exhausted here (all of the service's own connections checked out), so each request
 * waits the real connection timeout and fails with pg-pool's own error.
 */
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool, getPool, verifyDatabaseConnection } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf } from "../support/db";

const app = createApp();
let db: pg.Pool;
let logs: ConsoleSpies;
beforeAll(async () => {
  db = createTestPool();
  expect(await verifyDatabaseConnection()).toBe(true); // the service considers the database ready
});
afterAll(async () => {
  await db.end();
  await closePool();
});
beforeEach(() => {
  logs = spyConsole();
});

type U = { id: string; email: string };
const internal = (path: string, u: U, body: Record<string, unknown>) =>
  request(app).post(path).set("Authorization", bearer(u)).set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET).send(body);

/** Runs `fn` while every connection of the service's pool is checked out. */
async function withPoolExhausted<T>(fn: () => Promise<T>): Promise<T> {
  const pool = getPool();
  const max = (pool as unknown as { options: { max: number } }).options.max;
  const held = await Promise.all(Array.from({ length: max }, () => pool.connect()));
  try {
    return await fn();
  } finally {
    for (const c of held) c.release();
  }
}

describe("pool exhaustion → 503 DATABASE_UNAVAILABLE + Retry-After on every money route (R18)", () => {
  it("balance, history, checkout, consume, capture and refund", async () => {
    const u = await createUser(db, { balance: 0, verified: true });
    await db.query(`SELECT post_credit_transaction($1, 20, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    // A reservation to capture and one to release, made while the pool is healthy.
    expect((await internal("/api/billing/consume", u, { operationType: "AI_CHAT_QUERY", referenceId: "r18-capture" })).status).toBe(200);
    expect((await internal("/api/billing/consume", u, { operationType: "AI_CHAT_QUERY", referenceId: "r18-refund" })).status).toBe(200);
    const ledgerBefore = await ledgerOf(db, u.id);

    const routes: Array<[string, () => request.Test]> = [
      ["GET /balance", () => request(app).get("/api/billing/balance").set("Authorization", bearer(u))],
      ["GET /history", () => request(app).get("/api/billing/history").set("Authorization", bearer(u))],
      ["POST /checkout", () => request(app).post("/api/billing/checkout").set("Authorization", bearer(u)).send({ packageId: "starter" })],
      ["POST /consume", () => internal("/api/billing/consume", u, { operationType: "AI_CHAT_QUERY", referenceId: "r18-new" })],
      ["POST /capture", () => internal("/api/billing/capture", u, { referenceId: "r18-capture" })],
      ["POST /refund", () => internal("/api/billing/refund", u, { referenceId: "r18-refund" })],
    ];
    const results = await withPoolExhausted(() => Promise.all(routes.map(([, send]) => send())));

    for (const [i, res] of results.entries()) {
      expect({ route: routes[i]![0], status: res.status, retryAfter: res.headers["retry-after"], body: res.body }).toEqual({
        route: routes[i]![0],
        status: 503,
        retryAfter: "5",
        body: { success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" },
      });
    }
    expect(logs.lines().some((l) => l.includes("[db] Request failed: database unavailable"))).toBe(true);
    expect(logs.lines().some((l) => l.includes("Internal server error"))).toBe(false);

    // Nothing was written while the database was unavailable; the same calls succeed afterwards.
    expect(await ledgerOf(db, u.id)).toEqual(ledgerBefore);
    expect((await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE user_id = $1`, [u.id])).rows[0].n).toBe(2);
    expect((await internal("/api/billing/capture", u, { referenceId: "r18-capture" })).status).toBe(200);
    expect((await internal("/api/billing/refund", u, { referenceId: "r18-refund" })).status).toBe(200);
    expect(await balanceOf(db, u.id)).toBe(20 - 1);
  });
});
