/**
 * Phase 2C step 5.2.2 Part B: the delivery_ack capability and POST /api/billing/delivery-attempt. Real routes, real database
 * (migrations 019 and 020 applied). A delivery attempt means the BFF reached the point of returning a settled answer; it is
 * recorded once, never touches a credit, and never changes how a reservation settles.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { mintSettlementCapability, verifySettlementCapability } from "../../src/utils/settlementCapability.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser, ledgerOf, waitFor } from "../support/db";
import { interceptClientQueries, sqlStateFault } from "../support/pg-fault";
import { CAPABILITY_FIELD, TEST_SETTLEMENT_KEYS, claimsOf, mintForRow, persistedBinding } from "../support/settlement";

const app = createApp();
let db: pg.Pool;
let logs: ConsoleSpies;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await closePool();
});
beforeEach(() => {
  logs = spyConsole();
});

type U = { id: string; email: string };
const NOT_AUTHORIZED = { success: false, error: "Settlement not authorized.", code: "SETTLEMENT_NOT_AUTHORIZED" };
const NOT_RECORDABLE = { success: false, error: "A delivery attempt cannot be recorded for this operation.", code: "DELIVERY_ATTEMPT_NOT_RECORDABLE" };

async function fundedUser(balance = 10): Promise<U> {
  const u = await createUser(db, { balance: 0, verified: true });
  if (balance > 0) await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, balance]);
  return u;
}

function post(path: string, body: Record<string, unknown> | undefined, opts: { key?: string | null; authorization?: string } = {}) {
  let req = request(app).post(`/api/billing${path}`);
  const key = opts.key === undefined ? TEST_ENV.INTERNAL_SERVICE_SECRET : opts.key;
  if (key !== null) req = req.set("X-Internal-Service-Key", key);
  if (opts.authorization) req = req.set("Authorization", opts.authorization);
  return body === undefined ? req : req.send(body);
}
const ack = (referenceId: unknown, token: unknown, opts: Parameters<typeof post>[2] = {}) =>
  post("/delivery-attempt", { referenceId, [CAPABILITY_FIELD]: token }, opts);
const capture = (referenceId: string, token: string) => post("/capture", { referenceId, [CAPABILITY_FIELD]: token });
const refund = (referenceId: string, token: string) => post("/refund", { referenceId, reason: "test", [CAPABILITY_FIELD]: token });

/** Reserve through the real route, as the BFF does. `trackDelivery` is the opt-in. */
async function reserve(u: U, opts: { trackDelivery?: unknown; referenceId?: string; operationType?: string } = {}) {
  const referenceId = opts.referenceId ?? randomUUID();
  const body: Record<string, unknown> = { operationType: opts.operationType ?? "AI_CHAT_QUERY", referenceId };
  if (opts.trackDelivery !== undefined) body.trackDelivery = opts.trackDelivery;
  const res = await post("/consume", body, { authorization: bearer(u) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const data = res.body.data as Record<string, unknown>;
  return {
    referenceId,
    data,
    captureToken: data.captureCapabilityToken as string,
    refundToken: data.refundCapabilityToken as string,
    ackToken: data.deliveryAckCapabilityToken as string | undefined,
  };
}
/** A tracked reservation that has been captured: the only state an acknowledgement is for. */
async function capturedTracked(u: U) {
  const r = await reserve(u, { trackDelivery: true });
  const res = await capture(r.referenceId, r.captureToken);
  expect(res.status).toBe(200);
  return r;
}

async function holdOf(u: U, referenceId: string) {
  const { rows } = await db.query(
    `SELECT status, amount, ledger_id::text, settled_at, settle_reason, delivery_tracking_enabled, answer_delivery_attempted_at FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`,
    [u.id, referenceId],
  );
  return rows[0] ?? null;
}
/** Everything financial, as one comparable value: every hold column except the two delivery ones, the ledger and the balance. */
async function financialState(u: U) {
  const holds = await db.query(`SELECT user_id, reference_id, operation_type, amount, status, created_at, expires_at, settled_at, ledger_id, settle_reason FROM ai_credit_holds WHERE user_id = $1 ORDER BY reference_id`, [u.id]);
  const ledger = await db.query(`SELECT * FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY id`, [u.id]);
  const balance = await db.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [u.id]);
  return JSON.stringify([holds.rows, ledger.rows, balance.rows]);
}
const allLogs = () => logs.lines().join("\n");

function withAlteredPayload(token: string, change: Record<string, unknown>): string {
  const [prefix, payload, mac] = token.split(".") as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  return `${prefix}.${Buffer.from(JSON.stringify({ ...claims, ...change })).toString("base64url")}.${mac}`;
}
const withAlteredMac = (token: string) => `${token.slice(0, -1)}${token.at(-1) === "A" ? "B" : "A"}`;

/** A session holding the reservation's row lock; `queued(n)` waits until n sessions are blocked behind it. */
async function rowLocker(u: U, referenceId: string) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const pid = (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
  await c.query("BEGIN");
  await c.query(`SELECT 1 FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2 FOR UPDATE`, [u.id, referenceId]);
  return {
    queued: (n: number) =>
      waitFor(async () => {
        const { rows } = await db.query<{ pid: number; blockers: number[] }>(`SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname = current_database()`);
        // Later waiters queue behind the first waiter, not behind the lock holder, so count everything transitively behind it.
        const behind = new Set([pid]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const r of rows) {
            if (!behind.has(r.pid) && r.blockers.some((b) => behind.has(b))) {
              behind.add(r.pid);
              grew = true;
            }
          }
        }
        return behind.size - 1 >= n;
      }),
    release: async () => {
      await c.query("COMMIT");
      await c.end();
    },
  };
}

describe("A: tracking is a per-reservation opt-in, and only an opted-in reservation gets the third capability", () => {
  it("without the opt-in: no delivery token, the hold is untracked, and the response is exactly what it was", async () => {
    const u = await fundedUser();
    const r = await reserve(u);
    expect(r.ackToken).toBeUndefined();
    expect(Object.keys(r.data).sort()).toEqual(
      ["alreadyProcessed", "balance", "captureCapabilityToken", "cost", "expiresAt", "ledgerId", "operationType", "refundCapabilityToken", "status"],
    );
    expect(await holdOf(u, r.referenceId)).toMatchObject({ delivery_tracking_enabled: false, answer_delivery_attempted_at: null });
  });

  it("with trackDelivery: true: a third token that verifies for delivery_ack only, and a tracked hold", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    expect(r.ackToken).toMatch(/^msc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(new Set([r.ackToken, r.captureToken, r.refundToken]).size).toBe(3);
    const keys = TEST_SETTLEMENT_KEYS;
    expect(verifySettlementCapability(r.ackToken, { purpose: "delivery_ack", referenceId: r.referenceId }, keys)).toMatchObject({ ok: true, claims: { pur: "delivery_ack" } });
    for (const purpose of ["capture", "refund"] as const) {
      expect(verifySettlementCapability(r.ackToken, { purpose, referenceId: r.referenceId }, keys)).toEqual({ ok: false, reason: "wrong_purpose" });
    }
    expect(verifySettlementCapability(r.captureToken, { purpose: "delivery_ack", referenceId: r.referenceId }, keys)).toEqual({ ok: false, reason: "wrong_purpose" });
    expect(verifySettlementCapability(r.refundToken, { purpose: "delivery_ack", referenceId: r.referenceId }, keys)).toEqual({ ok: false, reason: "wrong_purpose" });
    expect(await holdOf(u, r.referenceId)).toMatchObject({ delivery_tracking_enabled: true, answer_delivery_attempted_at: null, status: "held" });
  });

  it("the delivery token binds the same claims as the other two (user, reference, amount, operation, issue and expiry)", async () => {
    const u = await fundedUser(20);
    const r = await reserve(u, { trackDelivery: true, operationType: "ATOM_GENERATE" });
    const row = await persistedBinding(db, u.id, r.referenceId);
    const claims = claimsOf(r.ackToken!);
    expect(claims).toMatchObject({ pur: "delivery_ack", aud: "auth-billing-service/settlement", sub: u.id, ref: r.referenceId, amt: 2, op: "ATOM_GENERATE", iat: row.createdAtSeconds, rexp: row.reservationExpiresAtSeconds });
    expect(claims.exp).toBe(claims.rexp + 60);
    expect(Object.keys(claims).sort()).toEqual(Object.keys(claimsOf(r.captureToken)).sort());
  });

  it.each([["the string 'true'", "true"], ["the number 1", 1], ["'yes'", "yes"], ["an object", {}], ["an array", [true]], ["null", null], ["false", false]])(
    "only the boolean true opts in: %s does not",
    async (_name, value) => {
      const u = await fundedUser();
      const r = await reserve(u, { trackDelivery: value });
      expect(r.ackToken).toBeUndefined();
      expect(await holdOf(u, r.referenceId)).toMatchObject({ delivery_tracking_enabled: false });
    },
  );

  it("the opt-in changes nothing else: same status, balance, expiry rules and the same two tokens' behavior", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    expect(r.data).toMatchObject({ status: "held", cost: 1, balance: 9, alreadyProcessed: false });
    expect((await capture(r.referenceId, r.captureToken)).status).toBe(200);
    const again = await reserve(u);
    expect((await refund(again.referenceId, again.refundToken)).body.data).toMatchObject({ outcome: "released" });
  });

  it("re-using a reference stays 409 and hands out no tokens", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    const again = await post("/consume", { operationType: "AI_CHAT_QUERY", referenceId: r.referenceId, trackDelivery: true }, { authorization: bearer(u) });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).not.toContain("msc1.");
  });
});

describe("B: a delivery attempt is recorded once, for a captured and tracked reservation", () => {
  it("the first valid acknowledgement records the time and reports it", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const before = await db.query(`SELECT NOW() AS t`);

    const res = await ack(r.referenceId, r.ackToken);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ success: true, data: { recorded: true, alreadyRecorded: false } });
    const hold = await holdOf(u, r.referenceId);
    expect(hold.answer_delivery_attempted_at).toBeInstanceOf(Date);
    expect(hold.answer_delivery_attempted_at.getTime()).toBeGreaterThanOrEqual(before.rows[0].t.getTime() - 1);
    expect(hold).toMatchObject({ status: "captured", delivery_tracking_enabled: true });
  });

  it("needs no user session: no Authorization header, and a garbage one changes nothing", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    expect((await ack(r.referenceId, r.ackToken, { authorization: "Bearer not-a-jwt" })).status).toBe(200);
  });

  it("a repeat is idempotent: the same answer shape, and the ORIGINAL timestamp is kept", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    await ack(r.referenceId, r.ackToken);
    const first = (await holdOf(u, r.referenceId)).answer_delivery_attempted_at as Date;
    await new Promise((resolve) => setTimeout(resolve, 25));

    for (let i = 0; i < 3; i++) {
      const again = await ack(r.referenceId, r.ackToken);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ success: true, data: { recorded: true, alreadyRecorded: true } });
    }
    expect(((await holdOf(u, r.referenceId)).answer_delivery_attempted_at as Date).getTime()).toBe(first.getTime());
  });

  it("8 parallel acknowledgements queued behind one row lock: exactly one records, seven report it, one timestamp", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const lock = await rowLocker(u, r.referenceId);
    const inflight = Array.from({ length: 8 }, () => ack(r.referenceId, r.ackToken).then((res) => res));
    await lock.queued(8);
    await lock.release();
    const results = await Promise.all(inflight);

    expect(results.map((x) => x.status)).toEqual(Array(8).fill(200));
    const flags = results.map((x) => x.body.data.alreadyRecorded as boolean);
    expect(flags.filter((f) => f === false)).toHaveLength(1);
    expect(flags.filter((f) => f === true)).toHaveLength(7);
    const { rows } = await db.query(`SELECT count(*)::int AS n, count(DISTINCT answer_delivery_attempted_at)::int AS stamps FROM ai_credit_holds WHERE user_id = $1 AND answer_delivery_attempted_at IS NOT NULL`, [u.id]);
    expect(rows[0]).toEqual({ n: 1, stamps: 1 });
  });

  it("the response carries no token and nothing else", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const res = await ack(r.referenceId, r.ackToken);
    expect(JSON.stringify(res.body)).not.toContain("msc1.");
    expect(Object.keys(res.body.data).sort()).toEqual(["alreadyRecorded", "recorded"]);
  });

  it("it never touches money: holds, ledger and balance are identical before and after, and no ledger row is added", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const before = await financialState(u);
    const ledgerBefore = (await ledgerOf(db, u.id)).length;

    await ack(r.referenceId, r.ackToken);
    await ack(r.referenceId, r.ackToken);

    expect(await financialState(u)).toBe(before);
    expect((await ledgerOf(db, u.id)).length).toBe(ledgerBefore);
  });

  it("it works after the capture's own tokens are long spent: a captured hold is final, so the order of events does not matter", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    expect((await capture(r.referenceId, r.captureToken)).body.data.alreadyProcessed).toBe(true);
    expect((await ack(r.referenceId, r.ackToken)).status).toBe(200);
  });
});

describe("C: a reservation that is not captured and tracked cannot be acknowledged", () => {
  const unchanged = async (u: U, referenceId: string, statusBefore: string) => {
    const hold = await holdOf(u, referenceId);
    expect(hold.answer_delivery_attempted_at).toBeNull();
    expect(hold.status).toBe(statusBefore);
  };

  it("held: 409, nothing recorded, and the hold stays held", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    const state = await financialState(u);
    const res = await ack(r.referenceId, r.ackToken);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(NOT_RECORDABLE);
    await unchanged(u, r.referenceId, "held");
    expect(await financialState(u)).toBe(state);
  });

  it("released through the real /refund: 409 and the refund stays a refund", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    expect((await refund(r.referenceId, r.refundToken)).body.data.outcome).toBe("released");
    const state = await financialState(u);
    const res = await ack(r.referenceId, r.ackToken);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(NOT_RECORDABLE);
    await unchanged(u, r.referenceId, "released");
    expect(await financialState(u)).toBe(state);
  });

  it("expired: 409, and it does not become captured", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    await db.query(`UPDATE ai_credit_holds SET created_at = NOW() - interval '1 hour', expires_at = NOW() - interval '1 second' WHERE user_id = $1 AND reference_id = $2`, [u.id, r.referenceId]);
    await db.query(`SELECT release_expired_ai_holds()`);
    const res = await ack(r.referenceId, await mintForRow(db, "delivery_ack", u.id, r.referenceId));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(NOT_RECORDABLE);
    await unchanged(u, r.referenceId, "expired");
  });

  it("capture_failed: 409", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    await db.query(`UPDATE ai_credit_holds SET status = 'capture_failed', settled_at = NOW(), settle_reason = 'test' WHERE user_id = $1 AND reference_id = $2`, [u.id, r.referenceId]);
    const res = await ack(r.referenceId, await mintForRow(db, "delivery_ack", u.id, r.referenceId));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(NOT_RECORDABLE);
    await unchanged(u, r.referenceId, "capture_failed");
  });

  it("captured but NOT tracked (an older BFF, or the flag off): 409, so a historical row can never look acknowledged", async () => {
    const u = await fundedUser();
    const r = await reserve(u);
    expect((await capture(r.referenceId, r.captureToken)).status).toBe(200);
    const res = await ack(r.referenceId, await mintForRow(db, "delivery_ack", u.id, r.referenceId));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(NOT_RECORDABLE);
    expect(await holdOf(u, r.referenceId)).toMatchObject({ status: "captured", delivery_tracking_enabled: false, answer_delivery_attempted_at: null });
  });

  it("the refusals are indistinguishable from each other: the body names no status", async () => {
    const u = await fundedUser();
    const held = await reserve(u, { trackDelivery: true });
    const released = await reserve(u, { trackDelivery: true });
    await refund(released.referenceId, released.refundToken);
    const bodies = [(await ack(held.referenceId, held.ackToken)).body, (await ack(released.referenceId, released.ackToken)).body];
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it("a signed token for a reservation that does not exist → 404 HOLD_NOT_FOUND, nothing created", async () => {
    const u = await fundedUser();
    const referenceId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = mintSettlementCapability("delivery_ack", { userId: u.id, referenceId, amount: 1, operationType: "AI_CHAT_QUERY", createdAtSeconds: now, reservationExpiresAtSeconds: now + 600 }, TEST_SETTLEMENT_KEYS);
    const res = await ack(referenceId, token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("HOLD_NOT_FOUND");
    expect(await holdOf(u, referenceId)).toBeNull();
  });
});

describe("D: authorization: the internal key AND the delivery capability, nothing weaker", () => {
  it("a capture capability is refused (403, uniform), and so is a refund capability; nothing is recorded", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const captureForAck = await mintForRow(db, "capture", u.id, r.referenceId);
    const refundForAck = await mintForRow(db, "refund", u.id, r.referenceId);
    for (const token of [captureForAck, refundForAck, r.captureToken, r.refundToken]) {
      const res = await ack(r.referenceId, token);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(NOT_AUTHORIZED);
    }
    expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
  });

  it("the delivery capability cannot capture or refund: refused at /capture and /refund, and the reservation is unchanged", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    const state = await financialState(u);
    const asCapture = await capture(r.referenceId, r.ackToken!);
    const asRefund = await refund(r.referenceId, r.ackToken!);
    expect(asCapture.status).toBe(403);
    expect(asCapture.body).toEqual(NOT_AUTHORIZED);
    expect(asRefund.status).toBe(403);
    expect(asRefund.body).toEqual(NOT_AUTHORIZED);
    expect(await financialState(u)).toBe(state);
    expect((await holdOf(u, r.referenceId)).status).toBe("held");
  });

  it("the delivery capability is not a session: it opens no user route", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    expect((await request(app).get("/api/billing/balance").set("Authorization", `Bearer ${r.ackToken}`)).status).toBe(401);
  });

  it("no internal key → the generic 404, even with a perfect capability; a wrong key too", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    for (const key of [null, "", "wrong-key"]) {
      const res = await ack(r.referenceId, r.ackToken, { key });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: "Route not found." });
    }
    expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
  });

  it("the internal key alone is not enough: no capability → 403, not a fall-through to a 404", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const bodies: Array<[string, Record<string, unknown> | undefined]> = [
      ["no body", undefined],
      ["empty body", {}],
      ["reference only", { referenceId: r.referenceId }],
      ["null capability", { referenceId: r.referenceId, [CAPABILITY_FIELD]: null }],
      ["empty capability", { referenceId: r.referenceId, [CAPABILITY_FIELD]: "" }],
      ["blank capability", { referenceId: r.referenceId, [CAPABILITY_FIELD]: "   " }],
      ["numeric capability", { referenceId: r.referenceId, [CAPABILITY_FIELD]: 42 }],
      ["object capability", { referenceId: r.referenceId, [CAPABILITY_FIELD]: { token: r.ackToken } }],
      ["capability only", { [CAPABILITY_FIELD]: r.ackToken }],
      ["a user id and amount instead", { referenceId: r.referenceId, userId: u.id, amount: 1 }],
    ];
    for (const [name, body] of bodies) {
      const res = await post("/delivery-attempt", body);
      expect(res.status, name).toBe(403);
      expect(res.body, name).toEqual(NOT_AUTHORIZED);
    }
    expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
  });

  it.each([
    ["not a token", "garbage"],
    ["a bare prefix", "msc1"],
    ["three dots of nothing", "a.b.c"],
    ["an oversized token", `msc1.${"A".repeat(5000)}.${"B".repeat(43)}`],
  ])("a malformed capability (%s) is refused, uniformly", async (_name, token) => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const res = await ack(r.referenceId, token);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_AUTHORIZED);
  });

  it("a token with a changed claim or a changed MAC is refused, and the real one still works", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    for (const token of [withAlteredMac(r.ackToken!), withAlteredPayload(r.ackToken!, { amt: 2 }), withAlteredPayload(r.ackToken!, { pur: "capture" }), withAlteredPayload(r.ackToken!, { sub: randomUUID() })]) {
      const res = await ack(r.referenceId, token);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(NOT_AUTHORIZED);
    }
    expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
    expect((await ack(r.referenceId, r.ackToken)).status).toBe(200);
  });

  it("a token signed with another key is refused", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const forged = mintSettlementCapability("delivery_ack", await persistedBinding(db, u.id, r.referenceId), { current: "test-only-settlement-other-key-6c1e8a3f0d7b4925" });
    expect((await ack(r.referenceId, forged)).status).toBe(403);
  });

  it("an expired capability is refused, and the reason is logged for operators only", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const now = Math.floor(Date.now() / 1000);
    const expired = mintSettlementCapability("delivery_ack", { ...(await persistedBinding(db, u.id, r.referenceId)), createdAtSeconds: now - 7200, reservationExpiresAtSeconds: now - 3600 }, TEST_SETTLEMENT_KEYS);
    const res = await ack(r.referenceId, expired);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("expired");
    expect(logs.lines().some((l) => l.includes("SETTLEMENT_AUTH_REJECTED") && l.includes('"reason":"expired"') && l.includes('"purpose":"delivery_ack"'))).toBe(true);
    expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
  });

  it("a token for ANOTHER reservation of the same user is refused for this reference (and the reverse)", async () => {
    const u = await fundedUser();
    const a = await capturedTracked(u);
    const b = await capturedTracked(u);
    const res = await ack(a.referenceId, b.ackToken);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_AUTHORIZED);
    expect((await holdOf(u, a.referenceId)).answer_delivery_attempted_at).toBeNull();
    expect((await holdOf(u, b.referenceId)).answer_delivery_attempted_at).toBeNull();
  });

  it("a body reference that differs from the token's is refused, and the body can name no other user or hold", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const other = await fundedUser();
    const o = await capturedTracked(other);
    const res = await post("/delivery-attempt", { referenceId: o.referenceId, userId: other.id, holdId: o.referenceId, [CAPABILITY_FIELD]: r.ackToken });
    expect(res.status).toBe(403);
    expect((await holdOf(other, o.referenceId)).answer_delivery_attempted_at).toBeNull();
    expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
  });

  it("the user comes only from the signed claims: a token minted for another user finds no such reservation", async () => {
    const u = await fundedUser();
    const stranger = await fundedUser();
    const r = await capturedTracked(u);
    const wrongUser = await mintForRow(db, "delivery_ack", u.id, r.referenceId, { userId: stranger.id });
    const res = await ack(r.referenceId, wrongUser);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("HOLD_NOT_FOUND");
    expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
    expect(await holdOf(stranger, r.referenceId)).toBeNull();
  });

  it.each([
    ["amount", { amount: 2 }],
    ["operation", { operationType: "ATOM_GENERATE" }],
    ["issue time", { createdAtSeconds: 1 }],
    ["reservation expiry", { reservationExpiresAtSeconds: 4_000_000_000 }],
  ])("a correctly signed token whose %s does not match the row is refused", async (_name, override) => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const token = await mintForRow(db, "delivery_ack", u.id, r.referenceId, override);
    const res = await ack(r.referenceId, token);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_AUTHORIZED);
    expect(logs.lines().some((l) => l.includes("SETTLEMENT_AUTH_REJECTED") && l.includes('"reason":"row_mismatch"'))).toBe(true);
    expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
  });

  it("a token minted before a key rotation still works while the old key is configured as the previous one", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const saved = process.env.SETTLEMENT_CAPABILITY_SECRET;
    const rotated = "test-only-settlement-rotated-key-90a3c7e1b5d24f68";
    process.env.SETTLEMENT_CAPABILITY_SECRET = rotated;
    process.env.SETTLEMENT_CAPABILITY_SECRET_PREVIOUS = saved;
    try {
      expect((await ack(r.referenceId, r.ackToken)).status).toBe(200);
    } finally {
      process.env.SETTLEMENT_CAPABILITY_SECRET = saved;
      delete process.env.SETTLEMENT_CAPABILITY_SECRET_PREVIOUS;
    }
  });

  it("neither a token nor the reason ever reaches a response or a log", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const responses = [await ack(r.referenceId, r.ackToken), await ack(r.referenceId, r.ackToken), await ack(r.referenceId, withAlteredMac(r.ackToken!)), await ack(r.referenceId, r.captureToken)];
    for (const res of responses) expect(JSON.stringify(res.body)).not.toMatch(/msc1\./);
    for (const token of [r.ackToken!, r.captureToken, r.refundToken]) {
      const [, payload, mac] = token.split(".") as [string, string, string];
      for (const part of [token, payload, mac]) expect(allLogs()).not.toContain(part);
    }
    expect(allLogs()).not.toContain(TEST_ENV.INTERNAL_SERVICE_SECRET);
  });
});

describe("E: failures leave the reservation exactly as it was", () => {
  it("a transient database error on the write → 503 and a retry works; nothing half-written", async () => {
    const u = await fundedUser();
    const r = await capturedTracked(u);
    const state = await financialState(u);
    const fired = { n: 0 };
    const restore = interceptClientQueries((q) => {
      if (fired.n > 0 || !/SET answer_delivery_attempted_at/.test(q.sql)) return null;
      fired.n += 1;
      return q.proceed(sqlStateFault("40001"));
    });
    try {
      const res = await ack(r.referenceId, r.ackToken);
      expect(fired.n).toBe(1);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("TRANSIENT_DATABASE_ERROR");
      expect((await holdOf(u, r.referenceId)).answer_delivery_attempted_at).toBeNull();
      expect(await financialState(u)).toBe(state);
    } finally {
      restore();
    }
    const retry = await ack(r.referenceId, r.ackToken);
    expect(retry.body).toEqual({ success: true, data: { recorded: true, alreadyRecorded: false } });
  });

  it("the database refuses the write if the state is wrong, even if the service were to attempt it (the CHECK from migration 019)", async () => {
    const u = await fundedUser();
    const r = await reserve(u, { trackDelivery: true });
    await expect(db.query(`UPDATE ai_credit_holds SET answer_delivery_attempted_at = NOW() WHERE user_id = $1 AND reference_id = $2`, [u.id, r.referenceId])).rejects.toMatchObject({
      code: "23514",
      constraint: "ai_credit_holds_delivery_attempt_consistent",
    });
  });

  it("the route does not exist for a browser-style call without the key, and the public router never serves it", async () => {
    expect((await request(app).post("/api/billing/delivery-attempt").send({ referenceId: "x", [CAPABILITY_FIELD]: "y" })).status).toBe(404);
    expect((await request(app).get("/api/billing/delivery-attempt")).status).toBe(404);
  });
});
