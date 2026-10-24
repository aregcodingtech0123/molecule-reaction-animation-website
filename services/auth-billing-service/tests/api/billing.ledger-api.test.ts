import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { bearer } from "../support/auth";
import { TEST_ENV } from "../setup/env";
import { spyConsole } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, waitFor } from "../support/db";

const app = createApp();
let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await closePool();
});
beforeEach(() => {
  spyConsole();
});

async function fundedUser(balance: number, opts: { verified?: boolean } = {}) {
  const u = await createUser(db, { balance: 0, verified: opts.verified ?? true });
  if (balance > 0) await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, balance]);
  return u;
}

type U = { id: string; email: string };
/** Internal metering calls as the BFF makes them: user JWT + internal service key. `key: null` omits it. */
function internalPost(path: string, u: U, body: Record<string, unknown>, key: string | null = TEST_ENV.INTERNAL_SERVICE_SECRET) {
  let req = request(app).post(path).set("Authorization", bearer(u));
  if (key !== null) req = req.set("X-Internal-Service-Key", key);
  return req.send(body);
}
const consume = (u: U, body: Record<string, unknown>) => internalPost("/api/billing/consume", u, body);
const capture = (u: U, referenceId: string) => internalPost("/api/billing/capture", u, { referenceId });
const refund = (u: U, body: Record<string, unknown>) => internalPost("/api/billing/refund", u, body);
const deduct = (u: U, body: Record<string, unknown>, key: string | null = null) => internalPost("/api/billing/deduct", u, body, key);

async function holdOf(u: U, referenceId: string) {
  const { rows } = await db.query(
    `SELECT status, amount, ledger_id::text, settle_reason FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`,
    [u.id, referenceId],
  );
  return rows[0] ?? null;
}
/** Hold the user's advisory lock until `n` sessions queue behind it, so the requests truly race. */
async function race<T>(u: U, n: number, fire: () => Promise<T>[]): Promise<T[]> {
  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();
  try {
    await locker.query(`SELECT pg_advisory_lock(hashtext($1))`, [u.id]);
    const inflight = fire();
    await waitFor(async () => {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`,
      );
      return rows[0].n >= n;
    });
    await locker.query(`SELECT pg_advisory_unlock(hashtext($1))`, [u.id]);
    return await Promise.all(inflight);
  } finally {
    await locker.end();
  }
}

describe("GET /api/billing/balance", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/api/billing/balance")).status).toBe(401);
  });

  it("returns the caller's own balance; query/body attempts to select another user are ignored", async () => {
    const a = await fundedUser(7);
    const b = await fundedUser(99);
    const res = await request(app).get(`/api/billing/balance?userId=${b.id}&user_id=${b.id}`).set("Authorization", bearer(a));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { userId: a.id, balance: 7, hasCredits: true } });
  });

  it("hasCredits is false at zero", async () => {
    const u = await fundedUser(0);
    const res = await request(app).get("/api/billing/balance").set("Authorization", bearer(u));
    expect(res.body.data).toMatchObject({ balance: 0, hasCredits: false });
  });

  it("404 BALANCE_NOT_FOUND when the balance row is missing", async () => {
    const u = await createUser(db);
    await db.query(`DELETE FROM user_balances WHERE user_id = $1`, [u.id]);
    const res = await request(app).get("/api/billing/balance").set("Authorization", bearer(u));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("BALANCE_NOT_FOUND");
  });
});

describe("GET /api/billing/history", () => {
  async function userWithRows(n: number) {
    const u = await fundedUser(n);
    // Separate autocommit statements → distinct created_at (NOW() is per transaction).
    for (let i = 0; i < n; i++) {
      await db.query(`SELECT post_credit_transaction($1, -1, 'CREDIT_CONSUMPTION', $2)`, [u.id, `turn-${i}`]);
    }
    return u;
  }

  it("requires auth", async () => {
    expect((await request(app).get("/api/billing/history")).status).toBe(401);
  });

  it("returns only the caller's rows (per-user isolation)", async () => {
    const a = await userWithRows(2);
    const b = await userWithRows(3);
    const res = await request(app).get(`/api/billing/history?userId=${b.id}`).set("Authorization", bearer(a));
    expect(res.status).toBe(200);
    const ids = new Set((await ledgerOf(db, a.id)).map((r) => r.id));
    expect(res.body.data.transactions).toHaveLength(3); // signup + 2 consumptions
    expect(res.body.data.transactions.every((t: { id: string }) => ids.has(t.id))).toBe(true);
  });

  it("orders newest first and returns the documented row shape", async () => {
    const u = await userWithRows(3);
    const res = await request(app).get("/api/billing/history").set("Authorization", bearer(u));
    const txs = res.body.data.transactions;
    const times = txs.map((t: { created_at: string }) => Date.parse(t.created_at));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect(txs[0]).toEqual({
      id: expect.any(String),
      amount: -1,
      transaction_type: "CREDIT_CONSUMPTION",
      reference_id: "turn-2",
      provider: null,
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(txs.at(-1).transaction_type).toBe("SIGNUP_BONUS");
  });

  it.each([
    ["2", 2],
    ["0", 1],
    ["-5", 1],
    ["1000", 6],
    ["1e999", 6],
    ["", 1],
  ])("limit=%s → %i rows (clamped 1..200)", async (limit, expected) => {
    const u = await userWithRows(5);
    const res = await request(app).get(`/api/billing/history?limit=${limit}`).set("Authorization", bearer(u));
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(expected);
  });

  // FINDING-08 (Low): Number("abc") is NaN, Math.min/max propagate NaN, and Postgres rejects
  // `LIMIT 'NaN'` → 500 INTERNAL_ERROR for any non-numeric limit.
  it.each([["abc"], ["2.7"], ["NaN"]])("non-integer limit=%j falls back to the default instead of 500 (FINDING-08)", async (limit) => {
    const u = await userWithRows(1);
    const res = await request(app).get(`/api/billing/history?limit=${limit}`).set("Authorization", bearer(u));
    expect(res.status).toBe(200);
  });

  it.each([["abc"], ["2.7"], ["NaN"], ["0x10"], ["3abc"]])("limit=%j is not a valid integer → the default page size, not a truncation (FINDING-08)", async (limit) => {
    const u = await userWithRows(3); // 4 rows; a truncating parser would return 2, 0 or 3
    const res = await request(app).get(`/api/billing/history?limit=${limit}`).set("Authorization", bearer(u));
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(4);
  });

  it("repeated limit parameters (?limit=1&limit=2) → default, not 500 (FINDING-08)", async () => {
    const u = await userWithRows(3);
    const res = await request(app).get(`/api/billing/history?limit=1&limit=2`).set("Authorization", bearer(u));
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(4);
  });

  /** Follow nextCursor until the end; returns every page. */
  async function walk(u: { id: string; email: string }, limit: number) {
    const pages: Array<{ transactions: Array<{ id: string; created_at: string }>; nextCursor: string | null }> = [];
    let cursor: string | null = null;
    do {
      const qs = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
      const res = await request(app).get(`/api/billing/history?${qs}`).set("Authorization", bearer(u));
      expect(res.status).toBe(200);
      pages.push(res.body.data);
      cursor = res.body.data.nextCursor;
      expect(pages.length).toBeLessThan(50);
    } while (cursor);
    return pages;
  }

  it("cursor pagination reaches every row beyond 200, each exactly once, newest first (FINDING-17)", async () => {
    const u = await userWithRows(204); // 205 rows with the signup bonus
    const pages = await walk(u, 200);
    expect(pages.map((p) => p.transactions.length)).toEqual([200, 5]);
    expect(pages.map((p) => p.nextCursor === null)).toEqual([false, true]);
    const ids = pages.flatMap((p) => p.transactions.map((t) => t.id));
    const ledgerIds = (await ledgerOf(db, u.id)).map((r) => String(r.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ledgerIds].sort());
    const times = pages.flatMap((p) => p.transactions.map((t) => Date.parse(t.created_at)));
    expect(times).toEqual([...times].sort((x, y) => y - x));
  }, 60_000);

  it("rows sharing one created_at (same transaction) are neither skipped nor repeated across pages (FINDING-17)", async () => {
    const u = await fundedUser(0);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < 7; i++) {
        await client.query(`SELECT post_credit_transaction($1, 1, 'ADMIN_ADJUSTMENT', $2)`, [u.id, `same-ts-${i}`]);
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const pages = await walk(u, 2);
    const ids = pages.flatMap((p) => p.transactions.map((t) => t.id));
    const ledgerIds = (await ledgerOf(db, u.id)).map((r) => String(r.id));
    expect(ledgerIds.length).toBeGreaterThanOrEqual(7);
    expect(ids).toHaveLength(ledgerIds.length);
    expect([...ids].sort()).toEqual([...ledgerIds].sort());
    // Ties are broken by id, descending.
    const sameTs = pages.flatMap((p) => p.transactions).filter((t) => t.created_at === pages[0]!.transactions[0]!.created_at);
    expect(sameTs.map((t) => Number(t.id))).toEqual([...sameTs.map((t) => Number(t.id))].sort((a, b) => b - a));
  });

  it("the first page is backward compatible: same rows and shape as before, plus nextCursor (FINDING-17)", async () => {
    const u = await userWithRows(2);
    const res = await request(app).get(`/api/billing/history`).set("Authorization", bearer(u));
    expect(Object.keys(res.body.data).sort()).toEqual(["nextCursor", "transactions"]);
    expect(res.body.data.transactions).toHaveLength(3);
    expect(res.body.data.nextCursor).toBeNull();
    // offset is still not a supported parameter: the newest row comes first.
    const withOffset = await request(app).get(`/api/billing/history?limit=1&offset=1`).set("Authorization", bearer(u));
    expect(withOffset.body.data.transactions[0].reference_id).toBe("turn-1");
    expect(withOffset.body.data.nextCursor).toEqual(expect.any(String));
  });

  it.each([
    ["garbage", "x"],
    ["not base64 JSON", Buffer.from("hello").toString("base64url")],
    ["non-numeric id", Buffer.from(JSON.stringify({ t: "2026-01-01T00:00:00.000000", i: "abc" })).toString("base64url")],
    ["SQL in the timestamp", Buffer.from(JSON.stringify({ t: "2026-01-01'; DROP TABLE users; --", i: "1" })).toString("base64url")],
    ["repeated parameter", ["a", "b"]],
  ])("cursor that is %s → 400 INVALID_CURSOR (FINDING-17)", async (_label, cursor) => {
    const u = await userWithRows(1);
    const qs = Array.isArray(cursor) ? cursor.map((c) => `cursor=${c}`).join("&") : `cursor=${encodeURIComponent(cursor)}`;
    const res = await request(app).get(`/api/billing/history?${qs}`).set("Authorization", bearer(u));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "INVALID_CURSOR" });
  });

  it("a cursor from another user's page only pages through the caller's own rows (FINDING-17)", async () => {
    const a = await userWithRows(3);
    const b = await userWithRows(3);
    const first = await request(app).get(`/api/billing/history?limit=1`).set("Authorization", bearer(b));
    const res = await request(app)
      .get(`/api/billing/history?cursor=${first.body.data.nextCursor}`)
      .set("Authorization", bearer(a));
    const own = new Set((await ledgerOf(db, a.id)).map((r) => String(r.id)));
    expect(res.status).toBe(200);
    expect(res.body.data.transactions.every((t: { id: string }) => own.has(t.id))).toBe(true);
  });
});

describe("GET /api/billing/operation-costs", () => {
  it("returns the server-authoritative price list (auth required)", async () => {
    expect((await request(app).get("/api/billing/operation-costs")).status).toBe(401);
    const u = await fundedUser(0);
    const res = await request(app).get("/api/billing/operation-costs").set("Authorization", bearer(u));
    expect(res.body).toEqual({
      success: true,
      data: { costs: { ATOM_GENERATE: 2, ARCH_RENDER_STD: 5, ARCH_RENDER_HD: 10, AI_CHAT_QUERY: 1 } },
    });
  });
});

describe("internal-only metering endpoints (FINDING-03)", () => {
  const routes = ["/api/billing/consume", "/api/billing/capture", "/api/billing/refund"];

  it.each(routes)("%s without the internal key → 404 identical to an unknown route; nothing reserved", async (path) => {
    const u = await fundedUser(10);
    const res = await internalPost(path, u, { operationType: "AI_CHAT_QUERY", referenceId: "k1" }, null);
    const unknown = await request(app).post("/api/billing/definitely-not-a-route").set("Authorization", bearer(u)).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: "Route not found." });
    expect(res.body).toEqual(unknown.body);
    expect(await holdOf(u, "k1")).toBeNull();
  });

  it.each(routes)("%s with a wrong key → 404, logged at warn level without the key", async (path) => {
    const logs = spyConsole();
    const u = await fundedUser(10);
    const wrong = "wrong-key-0123456789-abcdefghijklmnopqrstuv";
    const res = await internalPost(path, u, { operationType: "AI_CHAT_QUERY", referenceId: "k2" }, wrong);
    expect(res.status).toBe(404);
    const line = logs.lines().find((l) => l.includes("[internal-auth] Rejected internal-only request"));
    expect(line).toMatch(/^warn: .*"reason":"key_mismatch"/);
    expect(logs.lines().join("\n")).not.toContain(wrong);
    expect(logs.lines().join("\n")).not.toContain(TEST_ENV.INTERNAL_SERVICE_SECRET);
  });

  it("the key check runs before authentication (no JWT, no key → 404, not 401)", async () => {
    const res = await request(app).post("/api/billing/consume").send({ operationType: "AI_CHAT_QUERY", referenceId: "x" });
    expect(res.status).toBe(404);
  });

  it("a valid key does not replace the user: the user JWT is still required (401)", async () => {
    const res = await request(app)
      .post("/api/billing/consume")
      .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
      .send({ operationType: "AI_CHAT_QUERY", referenceId: "x" });
    expect(res.status).toBe(401);
  });

  it("an unconfigured service secret rejects everything (fail closed)", async () => {
    const saved = process.env.INTERNAL_SERVICE_SECRET;
    process.env.INTERNAL_SERVICE_SECRET = "";
    try {
      const u = await fundedUser(10);
      expect((await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "x" })).status).toBe(404);
    } finally {
      process.env.INTERNAL_SERVICE_SECRET = saved;
    }
  });
});

describe("POST /api/billing/consume (reserve)", () => {
  it("requires a verified email (403 EMAIL_NOT_VERIFIED) and charges nothing", async () => {
    const u = await fundedUser(10, { verified: false });
    const res = await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "t1" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(await balanceOf(db, u.id)).toBe(10);
    expect(await holdOf(u, "t1")).toBeNull();
  });

  it.each([[{ operationType: "FREE_STUFF", referenceId: "t" }], [{ referenceId: "t" }], [{ operationType: "toString", referenceId: "t" }]])(
    "unknown operation %j → 400 INVALID_OPERATION",
    async (body) => {
      const u = await fundedUser(10);
      const res = await consume(u, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_OPERATION");
    },
  );

  it.each([[{}], [{ referenceId: "   " }], [{ referenceId: "x".repeat(256) }], [{ referenceId: 42 }]])("bad referenceId %#  → 400 INVALID_REFERENCE", async (extra) => {
    const u = await fundedUser(10);
    const res = await consume(u, { operationType: "AI_CHAT_QUERY", ...extra });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REFERENCE");
  });

  it.each([
    ["AI_CHAT_QUERY", 1],
    ["ATOM_GENERATE", 2],
    ["ARCH_RENDER_STD", 5],
    ["ARCH_RENDER_HD", 10],
  ])("%s reserves %i credit(s) from the server price list; capture debits exactly that once", async (operationType, cost) => {
    const u = await fundedUser(20);
    const ref = randomUUID();
    const res = await consume(u, { operationType, referenceId: ref });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      operationType,
      cost,
      balance: 20 - cost,
      status: "held",
      expiresAt: expect.any(String),
      ledgerId: null,
      alreadyProcessed: false,
    });
    // Reserved, not yet charged.
    expect(await balanceOf(db, u.id)).toBe(20);
    expect((await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION")).toEqual([]);

    expect((await capture(u, ref)).status).toBe(200);
    expect(await balanceOf(db, u.id)).toBe(20 - cost);
    expect((await ledgerOf(db, u.id)).at(-1)).toMatchObject({ amount: -cost, transaction_type: "CREDIT_CONSUMPTION", reference_id: ref });
  });

  it("ignores any client-supplied price fields", async () => {
    const u = await fundedUser(20);
    const res = await consume(u, { operationType: "ARCH_RENDER_HD", referenceId: "x", cost: 0, amount: -50, metadata: { cost: 0 } });
    expect(res.body.data.cost).toBe(10);
    await capture(u, "x");
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it.each(["held", "captured", "released"])("re-using a reference that is %s → 409 OPERATION_ALREADY_EXISTS; never reserved or charged twice", async (state) => {
    const u = await fundedUser(5);
    await consume(u, { operationType: "ATOM_GENERATE", referenceId: "same" });
    if (state === "captured") await capture(u, "same");
    if (state === "released") await refund(u, { referenceId: "same" });

    const again = await consume(u, { operationType: "ATOM_GENERATE", referenceId: "same" });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "OPERATION_ALREADY_EXISTS", status: state });
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE user_id = $1`, [u.id]);
    expect(rows[0].n).toBe(1);
    expect(await balanceOf(db, u.id)).toBe(state === "captured" ? 3 : 5);
  });

  it("insufficient available balance → 402 with the shape the web client keys off", async () => {
    const u = await fundedUser(4);
    const res = await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "big" });
    expect(res.status).toBe(402);
    expect(res.body).toEqual({
      success: false,
      error: "Insufficient credits.",
      code: "INSUFFICIENT_CREDITS",
      requiredCredits: 5,
      balance: 4,
      operationType: "ARCH_RENDER_STD",
    });
    expect(await ledgerOf(db, u.id)).toHaveLength(1);
    expect(await holdOf(u, "big")).toBeNull();
  });

  it("open reservations count against the available balance (no overspend while a turn is in flight)", async () => {
    const u = await fundedUser(6);
    expect((await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "a" })).body.data.balance).toBe(1);
    const second = await consume(u, { operationType: "ATOM_GENERATE", referenceId: "b" });
    expect(second.status).toBe(402);
    expect(second.body.balance).toBe(1);
  });

  it("10 concurrent requests with the same reference: exactly one reservation, the rest 409; capture debits once", async () => {
    const u = await fundedUser(10);
    const results = await race(u, 10, () =>
      Array.from({ length: 10 }, () => consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "dup" }).then((r) => r)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    await capture(u, "dup");
    expect(await balanceOf(db, u.id)).toBe(9);
  });

  it("N parallel reservations against a balance worth K operations → exactly K succeed; never overdrawn after capture", async () => {
    const u = await fundedUser(10); // K = 2 × ARCH_RENDER_STD (5)
    const results = await race(u, 6, () =>
      Array.from({ length: 6 }, (_, i) => consume(u, { operationType: "ARCH_RENDER_STD", referenceId: `r${i}` }).then((r) => r)),
    );
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(2);
    expect(results.filter((r) => r.status === 402)).toHaveLength(4);
    // Promise.all keeps order: result i belongs to reference r{i}.
    for (const [i, r] of results.entries()) if (r.status === 200) expect((await capture(u, `r${i}`)).status).toBe(200);
    expect(await balanceOf(db, u.id)).toBe(0);
    expect((await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION")).toHaveLength(2);
  });
});

describe("POST /api/billing/capture", () => {
  it("charges a held reservation once and returns the balance after the debit", async () => {
    const u = await fundedUser(10);
    await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "c1" });
    const res = await capture(u, "c1");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ captured: true, amount: 5, balance: 5, ledgerId: expect.any(String), alreadyProcessed: false });
    expect(await holdOf(u, "c1")).toMatchObject({ status: "captured", ledger_id: res.body.data.ledgerId });
  });

  it("parallel duplicate captures → exactly one debit; every call succeeds", async () => {
    const u = await fundedUser(10);
    await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "c2" });
    const results = await race(u, 8, () => Array.from({ length: 8 }, () => capture(u, "c2").then((r) => r)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.data.alreadyProcessed === false)).toHaveLength(1);
    expect((await ledgerOf(db, u.id)).filter((r) => r.reference_id === "c2")).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(5);
  });

  it("an expired reservation cannot be captured: 409 HOLD_EXPIRED, settled as expired, never written to the ledger", async () => {
    const u = await fundedUser(10);
    await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "late" });
    await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1 AND reference_id = 'late'`, [u.id]);
    const res = await capture(u, "late");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("HOLD_EXPIRED");
    expect(await holdOf(u, "late")).toMatchObject({ status: "expired", ledger_id: null });
    expect((await ledgerOf(db, u.id)).filter((r) => r.reference_id === "late")).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it.each(["released", "expired"])("a %s reservation → 409 NOT_CAPTURABLE, no debit", async (state) => {
    const u = await fundedUser(10);
    await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "nc" });
    if (state === "released") await refund(u, { referenceId: "nc" });
    else {
      await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1`, [u.id]);
      await db.query(`SELECT release_expired_ai_holds()`);
    }
    const res = await capture(u, "nc");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_CAPTURABLE");
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("unknown reference, or another user's reference → 404 HOLD_NOT_FOUND", async () => {
    const owner = await fundedUser(10);
    const other = await fundedUser(10);
    await consume(owner, { operationType: "AI_CHAT_QUERY", referenceId: "mine" });
    expect((await capture(owner, "nope")).body.code).toBe("HOLD_NOT_FOUND");
    expect((await capture(other, "mine")).body.code).toBe("HOLD_NOT_FOUND");
    expect(await holdOf(owner, "mine")).toMatchObject({ status: "held" });
  });

  it("debits the amount recorded at reservation time, even if the price list changed since", async () => {
    const u = await fundedUser(10);
    // A reservation made under an older price (3) for an operation that now costs 1.
    await db.query(
      `INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, expires_at)
       VALUES ($1, 'old-price', 'AI_CHAT_QUERY', 3, NOW() + interval '10 minutes')`,
      [u.id],
    );
    const res = await capture(u, "old-price");
    expect(res.body.data.amount).toBe(3);
    expect(await balanceOf(db, u.id)).toBe(7);
  });

  it("a debit that cannot be posted is recorded durably as capture_failed, never charged, and reported by ledger_reconciliation()", async () => {
    const u = await fundedUser(5);
    await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "cf" });
    // Drain the balance behind the reservation's back (only possible at SQL level).
    await db.query(`SELECT post_credit_transaction($1, -5, 'ADMIN_ADJUSTMENT', 'drain')`, [u.id]);

    const res = await capture(u, "cf");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CAPTURE_FAILED");
    expect(await holdOf(u, "cf")).toMatchObject({ status: "capture_failed", ledger_id: null, settle_reason: "insufficient_credits_at_capture" });
    expect((await ledgerOf(db, u.id)).filter((r) => r.reference_id === "cf")).toEqual([]);

    const { rows } = await db.query(
      `SELECT issue, reference_id, difference::int FROM ledger_reconciliation() WHERE user_id = $1`,
      [u.id],
    );
    expect(rows).toEqual([{ issue: "capture_failed", reference_id: "cf", difference: 5 }]);
    const count = await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE status = 'capture_failed' AND user_id = $1`, [u.id]);
    expect(count.rows[0].n).toBe(1);
  });
});

describe("POST /api/billing/refund (release)", () => {
  it("nothing reserved for the reference → 200 refunded:false nothing_charged", async () => {
    const u = await fundedUser(3);
    const res = await refund(u, { referenceId: "never-charged" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ refunded: false, amount: 0, balance: 3, ledgerId: null, reason: "nothing_charged" });
  });

  it("releases a held reservation once (no ledger write ever); repeat → already_refunded", async () => {
    const u = await fundedUser(10);
    await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "job" });
    const first = await refund(u, { referenceId: "job", reason: "ai_generation_error" });
    const second = await refund(u, { referenceId: "job" });
    expect(first.body.data).toEqual({ refunded: true, amount: 5, balance: 10, ledgerId: null });
    expect(second.body.data).toMatchObject({ refunded: false, amount: 5, reason: "already_refunded" });
    expect(await balanceOf(db, u.id)).toBe(10);
    expect(await ledgerOf(db, u.id)).toHaveLength(1); // the signup bonus only
    expect(await holdOf(u, "job")).toMatchObject({ status: "released", settle_reason: "ai_generation_error" });
  });

  it("cannot release another user's reservation (isolation)", async () => {
    const victim = await fundedUser(10);
    const attacker = await fundedUser(0);
    await consume(victim, { operationType: "AI_CHAT_QUERY", referenceId: "victim-turn" });
    const res = await refund(attacker, { referenceId: "victim-turn" });
    expect(res.body.data.reason).toBe("nothing_charged");
    expect(await holdOf(victim, "victim-turn")).toMatchObject({ status: "held" });
  });

  it("concurrent releases of the same reservation release it once", async () => {
    const u = await fundedUser(10);
    await consume(u, { operationType: "ARCH_RENDER_HD", referenceId: "hd" });
    const results = await race(u, 8, () => Array.from({ length: 8 }, () => refund(u, { referenceId: "hd" }).then((r) => r)));
    expect(results.filter((r) => r.body.data.refunded === true)).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("a captured (successful) operation is never refundable, even with the internal key (FINDING-03)", async () => {
    const u = await fundedUser(1);
    await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "done" });
    await capture(u, "done");
    const res = await refund(u, { referenceId: "done" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ refunded: false, amount: 1, reason: "not_refundable" });
    expect(await balanceOf(db, u.id)).toBe(0);
  });

  // FINDING-03 (Critical) — fixed. Old expectation 403; the agreed design answers 404 for a missing
  // internal key (TEST_CHANGES TC-14).
  it("an end-user token cannot refund its own successful operation (FINDING-03)", async () => {
    const u = await fundedUser(1);
    const ref = randomUUID();
    await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: ref });
    await capture(u, ref);
    const history = await request(app).get("/api/billing/history").set("Authorization", bearer(u));
    const charged = history.body.data.transactions.find((t: { transaction_type: string }) => t.transaction_type === "CREDIT_CONSUMPTION");

    const res = await internalPost("/api/billing/refund", u, { referenceId: charged.reference_id }, null);
    expect(res.status).toBe(404);
    expect(await balanceOf(db, u.id)).toBe(0);
  });
});

describe("reservation expiry", () => {
  it("expired reservations no longer count against the available balance", async () => {
    const u = await fundedUser(5);
    await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "stale" });
    expect((await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "blocked" })).status).toBe(402);
    await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1 AND reference_id = 'stale'`, [u.id]);
    expect((await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "fresh" })).status).toBe(200);
  });

  it("release_expired_ai_holds() settles them as expired (never charged) and they are reported as hold_expired_unsettled", async () => {
    const u = await fundedUser(5);
    await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "abandoned" });
    await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1`, [u.id]);
    await db.query(`SELECT release_expired_ai_holds()`);
    expect(await holdOf(u, "abandoned")).toMatchObject({ status: "expired", ledger_id: null, settle_reason: "expired_unsettled" });
    expect(await balanceOf(db, u.id)).toBe(5);
    const { rows } = await db.query(`SELECT issue FROM ledger_reconciliation() WHERE user_id = $1`, [u.id]);
    expect(rows).toEqual([{ issue: "hold_expired_unsettled" }]);
  });

  it("the service-side sweeper wrapper returns the number settled", async () => {
    const { releaseExpiredHolds } = await import("../../src/services/aiCredits.service.js");
    const u = await fundedUser(5);
    await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "sweep-me" });
    await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1`, [u.id]);
    expect(await releaseExpiredHolds()).toBeGreaterThanOrEqual(1);
    expect(await holdOf(u, "sweep-me")).toMatchObject({ status: "expired" });
  });
});

describe("POST /api/billing/deduct (retired — FINDING-07)", () => {
  it.each([
    [{ amount: 1, type: "AI_GENERATION_DEDUCTION", referenceId: "r" }],
    [{ amount: 1, type: "ADMIN_ADJUSTMENT", referenceId: "self-admin" }],
    [{ amount: 1, type: "REFUND", referenceId: "r" }],
    [{ amount: 0, type: "AI_GENERATION_DEDUCTION", referenceId: "r" }],
  ])("%j → 404 with or without the internal key; the ledger is untouched", async (body) => {
    const u = await fundedUser(10);
    expect((await deduct(u, body)).status).toBe(404);
    expect((await deduct(u, body, TEST_ENV.INTERNAL_SERVICE_SECRET)).status).toBe(404);
    expect(await ledgerOf(db, u.id)).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("an end user can no longer write ADMIN_ADJUSTMENT / REFUND-typed rows into their own ledger (FINDING-07)", async () => {
    const u = await fundedUser(5);
    await deduct(u, { amount: 1, type: "ADMIN_ADJUSTMENT", referenceId: "self-admin" });
    expect((await ledgerOf(db, u.id)).map((r) => r.transaction_type)).toEqual(["SIGNUP_BONUS"]);
  });

  it("concurrent requests with the same referenceId deduct at most once — now: never (FINDING-07)", async () => {
    const u = await fundedUser(10);
    const results = await Promise.all(Array.from({ length: 5 }, () => deduct(u, { amount: 1, type: "AI_GENERATION_DEDUCTION", referenceId: "race" })));
    expect(results.every((r) => r.status === 404)).toBe(true);
    expect((await ledgerOf(db, u.id)).filter((r) => r.reference_id === "race")).toHaveLength(0);
  });
});
