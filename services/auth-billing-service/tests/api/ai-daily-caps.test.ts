/**
 * SEC-16: AI turns are capped per user and globally over a rolling 24 h, at reservation time (database-backed,
 * so the caps hold across instances). Every verified account gets free credits and each turn costs real model
 * money, so credits alone never bounded total spend. Own scratch database: the global count must not see
 * other suites' reservations.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/lib/migrator.mjs";
import { createApp } from "../../src/app.js";
import { closePool, verifyDatabaseConnection } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole } from "../support/console";
import { createUser } from "../support/db";
import { ScratchDb } from "../support/scratch-db";

const app = createApp();
const originalUrl = process.env.DATABASE_URL;
let scratch: ScratchDb;
let db: pg.Pool;

beforeAll(async () => {
  scratch = await ScratchDb.create();
  await migrate({ connectionString: scratch.url });
  db = scratch.pool;
  process.env.DATABASE_URL = scratch.url;
  expect(await verifyDatabaseConnection()).toBe(true);
}, 60_000);
afterAll(async () => {
  await closePool();
  process.env.DATABASE_URL = originalUrl;
  await scratch.destroy();
});
beforeEach(() => {
  spyConsole();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type U = { id: string; email: string };
async function funded(credits = 50): Promise<U> {
  const u = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, credits]);
  return u;
}
const consume = (u: U, referenceId = randomUUID()) =>
  request(app)
    .post("/api/billing/consume")
    .set("Authorization", bearer(u))
    .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
    .send({ operationType: "AI_CHAT_QUERY", referenceId });
const holdsOf = async (u: U) => (await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE user_id = $1`, [u.id])).rows[0].n;
const ageHolds = (u: U, interval: string) =>
  db.query(`UPDATE ai_credit_holds SET created_at = NOW() - $2::interval WHERE user_id = $1`, [u.id, interval]);

describe("per-user daily cap (SEC-16)", () => {
  it("the (N+1)th turn within 24 h → 429 AI_DAILY_LIMIT with Retry-After; nothing reserved", async () => {
    vi.stubEnv("AI_DAILY_TURNS_PER_USER", "3");
    const u = await funded();
    for (let i = 0; i < 3; i++) expect((await consume(u)).status).toBe(200);
    const res = await consume(u);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: "AI_DAILY_LIMIT", limit: 3 });
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.body.retryAfter).toBeLessThanOrEqual(24 * 3600);
    expect(await holdsOf(u)).toBe(3);
  });

  it("released, expired and captured turns all count (each one called the model)", async () => {
    vi.stubEnv("AI_DAILY_TURNS_PER_USER", "2");
    const u = await funded();
    await consume(u);
    await consume(u);
    await db.query(`UPDATE ai_credit_holds SET status = 'released', settled_at = NOW() WHERE user_id = $1`, [u.id]);
    expect((await consume(u)).status).toBe(429);
  });

  it("turns older than 24 h no longer count", async () => {
    vi.stubEnv("AI_DAILY_TURNS_PER_USER", "2");
    const u = await funded();
    await consume(u);
    await consume(u);
    await ageHolds(u, "24 hours 1 minute");
    expect((await consume(u)).status).toBe(200);
  });

  it("one user's cap does not affect another user", async () => {
    vi.stubEnv("AI_DAILY_TURNS_PER_USER", "1");
    const a = await funded();
    const b = await funded();
    expect((await consume(a)).status).toBe(200);
    expect((await consume(a)).status).toBe(429);
    expect((await consume(b)).status).toBe(200);
  });

  it("concurrent turns from one user cannot overshoot the cap (per-user lock)", async () => {
    vi.stubEnv("AI_DAILY_TURNS_PER_USER", "3");
    const u = await funded();
    const results = await Promise.all(Array.from({ length: 8 }, () => consume(u)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
    expect(await holdsOf(u)).toBe(3);
  });
});

describe("global daily cap (SEC-16)", () => {
  it("when the whole service reached its 24 h budget → 503 AI_CAPACITY_REACHED for everyone; nothing reserved", async () => {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours'`);
    vi.stubEnv("AI_DAILY_TURNS_GLOBAL", String(rows[0].n + 2));
    const a = await funded();
    const b = await funded();
    expect((await consume(a)).status).toBe(200);
    expect((await consume(b)).status).toBe(200);
    const res = await consume(b);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_CAPACITY_REACHED");
    expect(await holdsOf(b)).toBe(1);
  });

  it("defaults: 200 per user, 3000 globally; invalid values fall back to them", async () => {
    const { aiDailyTurnLimits } = await import("../../src/config/productionConfig.js");
    expect(aiDailyTurnLimits({})).toEqual({ perUser: 200, global: 3000 });
    expect(aiDailyTurnLimits({ AI_DAILY_TURNS_PER_USER: "0", AI_DAILY_TURNS_GLOBAL: "abc" })).toEqual({ perUser: 200, global: 3000 });
    expect(aiDailyTurnLimits({ AI_DAILY_TURNS_PER_USER: "50", AI_DAILY_TURNS_GLOBAL: "10000" })).toEqual({ perUser: 50, global: 10000 });
  });
});
