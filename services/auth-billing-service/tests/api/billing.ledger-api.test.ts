import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { bearer } from "../support/auth";
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

const consume = (u: { id: string; email: string }, body: Record<string, unknown>) =>
  request(app).post("/api/billing/consume").set("Authorization", bearer(u)).send(body);
const refund = (u: { id: string; email: string }, body: Record<string, unknown>) =>
  request(app).post("/api/billing/refund").set("Authorization", bearer(u)).send(body);
const deduct = (u: { id: string; email: string }, body: Record<string, unknown>) =>
  request(app).post("/api/billing/deduct").set("Authorization", bearer(u)).send(body);

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
  it.fails.each([["abc"], ["2.7"], ["NaN"]])("non-integer limit=%j falls back to the default instead of 500 (FINDING-08)", async (limit) => {
    const u = await userWithRows(1);
    const res = await request(app).get(`/api/billing/history?limit=${limit}`).set("Authorization", bearer(u));
    expect(res.status).toBe(200);
  });

  it("offers no offset/cursor: rows beyond 200 are unreachable (pagination gap, FINDING-17)", async () => {
    const u = await userWithRows(1);
    const res = await request(app).get(`/api/billing/history?limit=1&offset=1&cursor=x`).set("Authorization", bearer(u));
    // Offset is ignored — the newest row is returned again.
    expect(res.body.data.transactions[0].reference_id).toBe("turn-0");
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

describe("POST /api/billing/consume", () => {
  it("requires a verified email (403 EMAIL_NOT_VERIFIED) and charges nothing", async () => {
    const u = await fundedUser(10, { verified: false });
    const res = await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "t1" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(await balanceOf(db, u.id)).toBe(10);
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

  it.each([[{}], [{ referenceId: "   " }], [{ referenceId: "x".repeat(256) }]])("bad referenceId %#  → 400 INVALID_REFERENCE", async (extra) => {
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
  ])("%s charges %i credit(s) from the server price list", async (operationType, cost) => {
    const u = await fundedUser(20);
    const ref = randomUUID();
    const res = await consume(u, { operationType, referenceId: ref });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ operationType, cost, balance: 20 - cost, ledgerId: expect.any(String), alreadyProcessed: false });
    expect((await ledgerOf(db, u.id)).at(-1)).toMatchObject({ amount: -cost, transaction_type: "CREDIT_CONSUMPTION", reference_id: ref });
  });

  it("ignores any client-supplied price fields", async () => {
    const u = await fundedUser(20);
    const res = await consume(u, { operationType: "ARCH_RENDER_HD", referenceId: "x", cost: 0, amount: -50, metadata: { cost: 0 } });
    expect(res.body.data.cost).toBe(10);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("replaying a reference returns alreadyProcessed and does not charge twice", async () => {
    const u = await fundedUser(5);
    await consume(u, { operationType: "ATOM_GENERATE", referenceId: "same" });
    const res = await consume(u, { operationType: "ATOM_GENERATE", referenceId: "same" });
    expect(res.body.data).toMatchObject({ alreadyProcessed: true, balance: 3 });
    expect(await balanceOf(db, u.id)).toBe(3);
  });

  it("insufficient balance → 402 with the shape the web client keys off", async () => {
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
  });

  it("10 concurrent requests with the same reference charge exactly once and all succeed", async () => {
    const u = await fundedUser(10);
    const results = await Promise.all(Array.from({ length: 10 }, () => consume(u, { operationType: "AI_CHAT_QUERY", referenceId: "dup" })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.data.alreadyProcessed === false)).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(9);
  });

  it("concurrent distinct operations never overdraw (402 for the losers, balance ≥ 0)", async () => {
    const u = await fundedUser(10);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => consume(u, { operationType: "ARCH_RENDER_STD", referenceId: `r${i}` })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 402)).toHaveLength(4);
    expect(await balanceOf(db, u.id)).toBe(0);
  });
});

describe("POST /api/billing/refund", () => {
  it("nothing charged for the reference → 200 refunded:false nothing_charged", async () => {
    const u = await fundedUser(3);
    const res = await refund(u, { referenceId: "never-charged" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ refunded: false, amount: 0, balance: 3, ledgerId: null, reason: "nothing_charged" });
  });

  it("refunds exactly the charged amount once; repeat → already_refunded", async () => {
    const u = await fundedUser(10);
    await consume(u, { operationType: "ARCH_RENDER_STD", referenceId: "job" });
    const first = await refund(u, { referenceId: "job", reason: "ai_generation_error" });
    const second = await refund(u, { referenceId: "job" });
    expect(first.body.data).toMatchObject({ refunded: true, amount: 5, balance: 10 });
    expect(second.body.data).toMatchObject({ refunded: false, amount: 5, reason: "already_refunded" });
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("refunds the amount actually charged, not the current price", async () => {
    const u = await fundedUser(10);
    // Simulate a historical charge at an older price.
    await db.query(`SELECT post_credit_transaction($1, -3, 'CREDIT_CONSUMPTION', 'old-price')`, [u.id]);
    const res = await refund(u, { referenceId: "old-price" });
    expect(res.body.data).toMatchObject({ refunded: true, amount: 3 });
  });

  it("cannot refund another user's reference (isolation)", async () => {
    const victim = await fundedUser(10);
    const attacker = await fundedUser(0);
    await consume(victim, { operationType: "AI_CHAT_QUERY", referenceId: "victim-turn" });
    const res = await refund(attacker, { referenceId: "victim-turn" });
    expect(res.body.data.reason).toBe("nothing_charged");
    expect(await balanceOf(db, attacker.id)).toBe(0);
  });

  it("concurrent refunds of the same reference credit back once", async () => {
    const u = await fundedUser(10);
    await consume(u, { operationType: "ARCH_RENDER_HD", referenceId: "hd" });
    await Promise.all(Array.from({ length: 8 }, () => refund(u, { referenceId: "hd" })));
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  // FINDING-03 (Critical): /refund is reachable with an end-user token (and through the BFF at
  // /api/billing/refund). /history discloses every charge's reference_id, so a user can refund
  // every SUCCESSFUL AI operation and use the AI for free. See tests/api/chat.route.test.ts (root)
  // for the end-to-end exploit through /api/chat.
  it.fails("an end-user token cannot refund its own successful operation (FINDING-03)", async () => {
    const u = await fundedUser(1);
    await consume(u, { operationType: "AI_CHAT_QUERY", referenceId: randomUUID() });
    const history = await request(app).get("/api/billing/history").set("Authorization", bearer(u));
    const charged = history.body.data.transactions.find((t: { transaction_type: string }) => t.transaction_type === "CREDIT_CONSUMPTION");

    const res = await refund(u, { referenceId: charged.reference_id });
    expect(res.status).toBe(403);
    expect(await balanceOf(db, u.id)).toBe(0);
  });
});

describe("POST /api/billing/deduct (legacy)", () => {
  it.each([
    [{ amount: 0, type: "AI_GENERATION_DEDUCTION", referenceId: "r" }, "INVALID_AMOUNT"],
    [{ amount: -5, type: "AI_GENERATION_DEDUCTION", referenceId: "r" }, "INVALID_AMOUNT"],
    [{ amount: 1.5, type: "AI_GENERATION_DEDUCTION", referenceId: "r" }, "INVALID_AMOUNT"],
    [{ amount: "abc", type: "AI_GENERATION_DEDUCTION", referenceId: "r" }, "INVALID_AMOUNT"],
    [{ amount: 1, type: "CREDIT_PURCHASE", referenceId: "r" }, "INVALID_TRANSACTION_TYPE"],
    [{ amount: 1, type: "SIGNUP_BONUS", referenceId: "r" }, "INVALID_TRANSACTION_TYPE"],
    [{ amount: 1, type: "AI_GENERATION_DEDUCTION" }, "INVALID_REFERENCE"],
  ])("rejects %j → 400 %s", async (body, code) => {
    const u = await fundedUser(10);
    const res = await deduct(u, body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("deducts once per reference (sequential replay is idempotent)", async () => {
    const u = await fundedUser(10);
    const a = await deduct(u, { amount: 2, type: "AI_GENERATION_DEDUCTION", referenceId: "leg" });
    const b = await deduct(u, { amount: 2, type: "AI_GENERATION_DEDUCTION", referenceId: "leg" });
    expect(a.body.data).toMatchObject({ newBalance: 8, alreadyProcessed: false });
    expect(b.body.data).toMatchObject({ newBalance: 8, alreadyProcessed: true });
  });

  it("insufficient → 402 INSUFFICIENT_CREDITS", async () => {
    const u = await fundedUser(1);
    const res = await deduct(u, { amount: 2, type: "AI_GENERATION_DEDUCTION", referenceId: "x" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("lets an end user write ADMIN_ADJUSTMENT / REFUND-typed rows into their own ledger (audit noise, FINDING-07)", async () => {
    const u = await fundedUser(5);
    await deduct(u, { amount: 1, type: "ADMIN_ADJUSTMENT", referenceId: "self-admin" });
    expect((await ledgerOf(db, u.id)).at(-1)).toMatchObject({ transaction_type: "ADMIN_ADJUSTMENT", amount: -1 });
  });

  // FINDING-07 (Medium): idempotency is check-then-insert with no unique index for these types,
  // so concurrent requests with the same referenceId all pass the check and all deduct.
  it.fails("concurrent requests with the same referenceId deduct once (FINDING-07)", async () => {
    const u = await fundedUser(10);
    const charged = await raceDeduct(u, 5);
    expect(charged).toBe(1);
  });

  it("characterises the race: N concurrent same-reference requests deduct N times", async () => {
    const u = await fundedUser(10);
    expect(await raceDeduct(u, 4)).toBe(4);
  });

  /** Hold the user's advisory lock until all N requests are queued inside post_credit_transaction. */
  async function raceDeduct(u: { id: string; email: string }, n: number) {
    const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await locker.connect();
    try {
      await locker.query(`SELECT pg_advisory_lock(hashtext($1))`, [u.id]);
      const inflight = Array.from({ length: n }, () => deduct(u, { amount: 1, type: "AI_GENERATION_DEDUCTION", referenceId: "race" }).then((r) => r));
      await waitFor(async () => {
        const { rows } = await db.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`,
        );
        return rows[0].n >= n;
      });
      await locker.query(`SELECT pg_advisory_unlock(hashtext($1))`, [u.id]);
      await Promise.all(inflight);
    } finally {
      await locker.end();
    }
    const rows = await ledgerOf(db, u.id);
    return rows.filter((r) => r.reference_id === "race").length;
  }
});
