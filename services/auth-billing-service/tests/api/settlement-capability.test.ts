/**
 * Phase 2C step 2: /consume mints capture and refund capabilities, and /capture and /refund accept them without a live
 * user session. Runs the real routes against the real database. The legacy session path must keep working unchanged
 * until step 6, and an invalid capability must never fall back to it.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/index.js";
import {
  SETTLEMENT_EXPIRY_GRACE_SECONDS,
  matchesHoldRow,
  mintSettlementCapability,
  verifySettlementCapability,
} from "../../src/utils/settlementCapability.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, waitFor } from "../support/db";
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
const OLD_KEY = "test-only-settlement-old-key-b7d41f9e2c6a0835";
const OTHER_KEY = "test-only-settlement-other-key-6c1e8a3f0d7b4925";

async function fundedUser(balance = 10, opts: { verified?: boolean } = {}): Promise<U> {
  const u = await createUser(db, { balance: 0, verified: opts.verified ?? true });
  if (balance > 0) await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, balance]);
  return u;
}

/** A metering call with the internal key only: no user session unless `authorization` is given. */
function post(path: string, body: Record<string, unknown> | undefined, opts: { key?: string | null; authorization?: string } = {}) {
  let req = request(app).post(`/api/billing${path}`);
  const key = opts.key === undefined ? TEST_ENV.INTERNAL_SERVICE_SECRET : opts.key;
  if (key !== null) req = req.set("X-Internal-Service-Key", key);
  if (opts.authorization) req = req.set("Authorization", opts.authorization);
  return body === undefined ? req : req.send(body);
}
const capture = (referenceId: unknown, token: unknown, opts: Parameters<typeof post>[2] = {}) =>
  post("/capture", { referenceId, [CAPABILITY_FIELD]: token }, opts);
const refund = (referenceId: unknown, token: unknown, extra: Record<string, unknown> = {}, opts: Parameters<typeof post>[2] = {}) =>
  post("/refund", { referenceId, [CAPABILITY_FIELD]: token, ...extra }, opts);

/** Reserve through the real route, as the BFF does: with the user's session. */
async function reserve(u: U, referenceId = randomUUID(), operationType = "AI_CHAT_QUERY") {
  const res = await post("/consume", { operationType, referenceId }, { authorization: bearer(u) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return {
    referenceId,
    body: res.body.data as Record<string, unknown>,
    captureToken: res.body.data.captureCapabilityToken as string,
    refundToken: res.body.data.refundCapabilityToken as string,
  };
}

async function holdOf(u: U, referenceId: string) {
  const { rows } = await db.query(
    `SELECT status, amount, operation_type, ledger_id::text, settled_at, settle_reason, expires_at FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`,
    [u.id, referenceId],
  );
  return rows[0] ?? null;
}
const debits = async (u: U, referenceId: string) =>
  (await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION" && r.reference_id === referenceId);

/** Move a hold into the past. created_at moves too, because a capability's reservation expiry can never precede its issue time. */
async function expireHold(u: U, referenceId: string, secondsAgo = 1) {
  await db.query(
    `UPDATE ai_credit_holds SET created_at = NOW() - interval '1 hour', expires_at = NOW() - make_interval(secs => $3) WHERE user_id = $1 AND reference_id = $2`,
    [u.id, referenceId, secondsAgo],
  );
}

async function withEnv<T>(vars: Record<string, string | undefined>, work: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await work();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A session holding the reservation's row lock; `queued(n)` waits until n sessions are blocked behind it, directly or not. */
async function rowLocker(u: U, referenceId: string) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const pid = (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
  await c.query("BEGIN");
  await c.query(`SELECT 1 FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2 FOR UPDATE`, [u.id, referenceId]);
  return {
    queued: (n: number) =>
      waitFor(async () => {
        const { rows } = await db.query<{ pid: number; blockers: number[] }>(
          `SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname = current_database()`,
        );
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

// ── Tampering helpers: a token's parts, changed without re-signing ───────────────────────────────────────
function withAlteredPayload(token: string, change: Record<string, unknown>): string {
  const [prefix, payload, mac] = token.split(".") as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  return `${prefix}.${Buffer.from(JSON.stringify({ ...claims, ...change })).toString("base64url")}.${mac}`;
}
function withAlteredMac(token: string): string {
  const last = token.at(-1) === "A" ? "B" : "A";
  return `${token.slice(0, -1)}${last}`;
}

describe("A: /consume mints a capture and a refund capability", () => {
  it("returns both, as distinct tokens that each verify for their own purpose only", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    expect(captureToken).toMatch(/^msc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(refundToken).toMatch(/^msc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(captureToken).not.toBe(refundToken);

    const keys = TEST_SETTLEMENT_KEYS;
    expect(verifySettlementCapability(captureToken, { purpose: "capture", referenceId }, keys)).toMatchObject({ ok: true, claims: { pur: "capture" } });
    expect(verifySettlementCapability(refundToken, { purpose: "refund", referenceId }, keys)).toMatchObject({ ok: true, claims: { pur: "refund" } });
    expect(verifySettlementCapability(captureToken, { purpose: "refund", referenceId }, keys)).toEqual({ ok: false, reason: "wrong_purpose" });
    expect(verifySettlementCapability(refundToken, { purpose: "capture", referenceId }, keys)).toEqual({ ok: false, reason: "wrong_purpose" });
  });

  it.each([
    ["AI_CHAT_QUERY", 1],
    ["ATOM_GENERATE", 2],
    ["ARCH_RENDER_STD", 5],
    ["ARCH_RENDER_HD", 10],
  ])("binds every claim to the persisted row (%s, %i credits)", async (operationType, amount) => {
    const u = await fundedUser(20);
    const { referenceId, captureToken, refundToken } = await reserve(u, randomUUID(), operationType);
    const row = await persistedBinding(db, u.id, referenceId);

    for (const token of [captureToken, refundToken]) {
      const claims = claimsOf(token);
      expect(claims).toMatchObject({
        aud: "auth-billing-service/settlement",
        sub: u.id,
        ref: referenceId,
        amt: amount,
        op: operationType,
        iat: row.createdAtSeconds,
        rexp: row.reservationExpiresAtSeconds,
      });
      expect(
        matchesHoldRow(claims, {
          userId: row.userId,
          referenceId: row.referenceId,
          amount: row.amount,
          operationType: row.operationType,
          createdAtSeconds: row.createdAtSeconds,
          expiresAtSeconds: row.reservationExpiresAtSeconds,
        }),
      ).toEqual({ ok: true });
    }
  });

  it("claims are numbers, as the strict verifier requires (the driver must not hand back numeric strings)", async () => {
    const u = await fundedUser();
    const { captureToken } = await reserve(u);
    const { amt, iat, rexp, exp } = claimsOf(captureToken);
    for (const value of [amt, iat, rexp, exp]) expect(Number.isSafeInteger(value)).toBe(true);
  });

  it("the reservation expiry in the token is the row's expiry and the response's expiresAt; exp adds only the approved grace", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken, body } = await reserve(u);
    const row = await persistedBinding(db, u.id, referenceId);
    const responseExpiry = Math.floor(Date.parse(body.expiresAt as string) / 1000);
    for (const token of [captureToken, refundToken]) {
      const { rexp, exp } = claimsOf(token);
      expect(rexp).toBe(row.reservationExpiresAtSeconds);
      expect(rexp).toBe(responseExpiry);
      expect(exp).toBe(rexp + SETTLEMENT_EXPIRY_GRACE_SECONDS);
    }
  });

  it("the grace gives no power to charge: inside it, the database still refuses an expired hold and nothing is debited", async () => {
    const u = await fundedUser();
    const { referenceId } = await reserve(u);
    await expireHold(u, referenceId);
    const token = await mintForRow(db, "capture", u.id, referenceId);

    const res = await capture(referenceId, token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("HOLD_EXPIRED");
    expect(await debits(u, referenceId)).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(10);
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "expired", ledger_id: null });
  });

  it("new tokens are signed with the current key only, even when a previous key is configured", async () => {
    await withEnv({ SETTLEMENT_CAPABILITY_SECRET_PREVIOUS: OLD_KEY }, async () => {
      const u = await fundedUser();
      const { referenceId, captureToken } = await reserve(u);
      expect(verifySettlementCapability(captureToken, { purpose: "capture", referenceId }, { current: TEST_ENV.SETTLEMENT_CAPABILITY_SECRET })).toMatchObject({ ok: true });
      expect(verifySettlementCapability(captureToken, { purpose: "capture", referenceId }, { current: OLD_KEY })).toEqual({ ok: false, reason: "bad_signature" });
    });
  });

  it("re-using a reference stays 409 and hands out no tokens; exactly one hold exists", async () => {
    const u = await fundedUser();
    const { referenceId } = await reserve(u);
    const again = await post("/consume", { operationType: "AI_CHAT_QUERY", referenceId }, { authorization: bearer(u) });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "OPERATION_ALREADY_EXISTS", status: "held" });
    expect(JSON.stringify(again.body)).not.toContain("msc1.");
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE user_id = $1`, [u.id]);
    expect(rows[0].n).toBe(1);
  });

  it("an insufficient balance hands out no tokens and reserves nothing", async () => {
    const u = await fundedUser(0);
    const ref = randomUUID();
    const res = await post("/consume", { operationType: "AI_CHAT_QUERY", referenceId: ref }, { authorization: bearer(u) });
    expect(res.status).toBe(402);
    expect(JSON.stringify(res.body)).not.toContain("msc1.");
    expect(await holdOf(u, ref)).toBeNull();
  });

  it("a capability alone cannot reserve: /consume still needs the internal key and the user's session", async () => {
    const u = await fundedUser();
    const ref = randomUUID();
    const body = { operationType: "AI_CHAT_QUERY", referenceId: ref };
    expect((await post("/consume", body, { key: null, authorization: bearer(u) })).status).toBe(404);
    expect((await post("/consume", body)).status).toBe(401);
    expect(await holdOf(u, ref)).toBeNull();
  });

  it("minting failure rolls the reservation back: no hold is ever left without tokens", async () => {
    const u = await fundedUser();
    const ref = randomUUID();
    await withEnv({ SETTLEMENT_CAPABILITY_SECRET: "" }, async () => {
      const res = await post("/consume", { operationType: "AI_CHAT_QUERY", referenceId: ref }, { authorization: bearer(u) });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: "Internal server error.", code: "INTERNAL_ERROR" });
    });
    expect(await holdOf(u, ref)).toBeNull();
    expect(await balanceOf(db, u.id)).toBe(10);
  });
});

describe("B: the capture capability", () => {
  it("settles without any user session; charges once", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken } = await reserve(u, randomUUID(), "ARCH_RENDER_STD");
    const res = await capture(referenceId, captureToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ captured: true, amount: 5, balance: 5, ledgerId: expect.any(String), alreadyProcessed: false });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "captured", ledger_id: res.body.data.ledgerId });
    expect(await debits(u, referenceId)).toHaveLength(1);
  });

  it("settles after the session was revoked, where the legacy path answers 401", async () => {
    const u = await fundedUser();
    const stale = bearer(u);
    const { referenceId, captureToken } = await reserve(u);
    await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [u.id]);

    const legacy = await post("/capture", { referenceId }, { authorization: stale });
    expect(legacy.status).toBe(401);
    expect(legacy.body.code).toBe("TOKEN_REVOKED");
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });

    const res = await capture(referenceId, captureToken);
    expect(res.status).toBe(200);
    expect(await debits(u, referenceId)).toHaveLength(1);
  });

  it("ignores an expired or garbage Authorization header entirely", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken } = await reserve(u);
    const res = await capture(referenceId, captureToken, { authorization: "Bearer not-a-real-token" });
    expect(res.status).toBe(200);
  });

  it("the user comes only from the token: another user's session or a userId in the body changes nothing", async () => {
    const owner = await fundedUser();
    const other = await fundedUser();
    const { referenceId, captureToken } = await reserve(owner);
    const res = await post("/capture", { referenceId, [CAPABILITY_FIELD]: captureToken, userId: other.id, user_id: other.id, amount: 0 }, { authorization: bearer(other) });
    expect(res.status).toBe(200);
    expect(await debits(owner, referenceId)).toHaveLength(1);
    expect(await balanceOf(db, owner.id)).toBe(9);
    expect(await balanceOf(db, other.id)).toBe(10);
  });

  it("a repeat with the same token (lost response) reports the same charge and debits nothing more", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken } = await reserve(u, randomUUID(), "ARCH_RENDER_STD");
    const first = await capture(referenceId, captureToken);
    const second = await capture(referenceId, captureToken);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ captured: true, amount: 5, balance: 5, ledgerId: first.body.data.ledgerId, alreadyProcessed: true });
    expect(await debits(u, referenceId)).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(5);
  });

  it("8 parallel captures with the same token: one debit, and every caller told the same ledger id", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken } = await reserve(u);
    const lock = await rowLocker(u, referenceId);
    const inflight = Array.from({ length: 8 }, () => capture(referenceId, captureToken).then((r) => r));
    await lock.queued(8);
    await lock.release();
    const results = await Promise.all(inflight);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.data.alreadyProcessed === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.data.ledgerId)).size).toBe(1);
    expect(await debits(u, referenceId)).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(9);
  });

  it("the database stays authoritative: a released hold refuses capture with the same token", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    expect((await refund(referenceId, refundToken)).status).toBe(200);
    const res = await capture(referenceId, captureToken);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "NOT_CAPTURABLE", status: "released" });
    expect(await debits(u, referenceId)).toEqual([]);
  });

  it("a token whose hold does not exist → 404 HOLD_NOT_FOUND, as today", async () => {
    const u = await fundedUser();
    const ref = randomUUID();
    const token = mintSettlementCapability(
      "capture",
      { userId: u.id, referenceId: ref, amount: 1, operationType: "AI_CHAT_QUERY", createdAtSeconds: Math.floor(Date.now() / 1000), reservationExpiresAtSeconds: Math.floor(Date.now() / 1000) + 600 },
      TEST_SETTLEMENT_KEYS,
    );
    const res = await capture(ref, token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("HOLD_NOT_FOUND");
  });

  it("a valid capability during a database outage answers the retryable 503, charges nothing, and works once it is over", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    const pool = getPool();
    const max = (pool as unknown as { options: { max: number } }).options.max;
    const held = await Promise.all(Array.from({ length: max }, () => pool.connect()));
    let responses: request.Response[];
    try {
      responses = await Promise.all([capture(referenceId, captureToken).then((r) => r), refund(referenceId, refundToken).then((r) => r)]);
    } finally {
      for (const c of held) c.release();
    }
    for (const res of responses) {
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("DATABASE_UNAVAILABLE");
    }
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
    expect((await capture(referenceId, captureToken)).status).toBe(200);
    expect(await debits(u, referenceId)).toHaveLength(1);
  }, 60_000);

  it("a bad token during a database outage is refused without touching the database", async () => {
    const pool = getPool();
    const max = (pool as unknown as { options: { max: number } }).options.max;
    const held = await Promise.all(Array.from({ length: max }, () => pool.connect()));
    try {
      const res = await capture("any-reference", "not-a-token");
      expect(res.status).toBe(403);
      expect(res.body).toEqual(NOT_AUTHORIZED);
    } finally {
      for (const c of held) c.release();
    }
  }, 60_000);
});

describe("B: the refund capability", () => {
  it("releases without any user session, and after the session was revoked", async () => {
    const u = await fundedUser();
    const { referenceId, refundToken } = await reserve(u);
    await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [u.id]);
    const res = await refund(referenceId, refundToken, { reason: "ai_generation_error" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ refunded: true, amount: 1, balance: 10, ledgerId: null, outcome: "released" });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "released", settle_reason: "ai_generation_error" });
    expect(await ledgerOf(db, u.id)).toHaveLength(1); // the signup bonus only
  });

  it("8 parallel refunds with the same token: exactly one released, the rest told it was already released", async () => {
    const u = await fundedUser();
    const { referenceId, refundToken } = await reserve(u, randomUUID(), "ARCH_RENDER_HD");
    const lock = await rowLocker(u, referenceId);
    const inflight = Array.from({ length: 8 }, () => refund(referenceId, refundToken).then((r) => r));
    await lock.queued(8);
    await lock.release();
    const results = await Promise.all(inflight);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.data.refunded === true)).toHaveLength(1);
    expect(results.filter((r) => r.body.data.outcome === "released")).toHaveLength(1);
    expect(results.filter((r) => r.body.data.outcome === "already_released")).toHaveLength(7);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("a held reservation past its expiry can still be released (never charged), as today", async () => {
    const u = await fundedUser();
    const { referenceId } = await reserve(u);
    await expireHold(u, referenceId);
    const res = await refund(referenceId, await mintForRow(db, "refund", u.id, referenceId));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ refunded: true, outcome: "released" });
  });
});

describe("the refund contract: every outcome, on both authentication paths", () => {
  type Path = "capability" | "legacy session";
  const PATHS: Path[] = ["capability", "legacy session"];

  /** One refund, through the path under test. The legacy path has no capability; the capability path has no session. */
  async function refundVia(path: Path, u: U, referenceId: string) {
    if (path === "legacy session") return post("/refund", { referenceId }, { authorization: bearer(u) });
    const row = await db.query(`SELECT 1 FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`, [u.id, referenceId]);
    if (row.rowCount === 0) {
      const now = Math.floor(Date.now() / 1000);
      const token = mintSettlementCapability(
        "refund",
        { userId: u.id, referenceId, amount: 1, operationType: "AI_CHAT_QUERY", createdAtSeconds: now, reservationExpiresAtSeconds: now + 600 },
        TEST_SETTLEMENT_KEYS,
      );
      return refund(referenceId, token);
    }
    return refund(referenceId, await mintForRow(db, "refund", u.id, referenceId));
  }

  describe.each(PATHS)("through the %s path", (path) => {
    it("released: the first release of a held reservation", async () => {
      const u = await fundedUser();
      const { referenceId } = await reserve(u, randomUUID(), "ARCH_RENDER_STD");
      const res = await refundVia(path, u, referenceId);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ refunded: true, amount: 5, balance: 10, ledgerId: null, outcome: "released" });
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "released" });
    });

    it("already_released: a repeat refund (with the compatibility reason)", async () => {
      const u = await fundedUser();
      const { referenceId } = await reserve(u, randomUUID(), "ARCH_RENDER_STD");
      await refundVia(path, u, referenceId);
      const settled = await holdOf(u, referenceId);
      const res = await refundVia(path, u, referenceId);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ refunded: false, amount: 5, balance: 10, ledgerId: null, outcome: "already_released", reason: "already_refunded", alreadyProcessed: true });
      expect(await holdOf(u, referenceId)).toEqual(settled);
    });

    it("already_expired: settled by the sweeper, then refunded (with the compatibility reason)", async () => {
      const u = await fundedUser();
      const { referenceId } = await reserve(u, randomUUID(), "ARCH_RENDER_STD");
      await expireHold(u, referenceId);
      await db.query(`SELECT release_expired_ai_holds()`);
      const res = await refundVia(path, u, referenceId);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ refunded: false, amount: 5, balance: 10, ledgerId: null, outcome: "already_expired", reason: "already_refunded", alreadyProcessed: true });
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "expired", settle_reason: "expired_unsettled" });
    });

    it("already_captured: never reverses the charge, is not a repeat refund, and changes nothing", async () => {
      const u = await fundedUser();
      const { referenceId, captureToken } = await reserve(u, randomUUID(), "ARCH_RENDER_STD");
      expect((await capture(referenceId, captureToken)).status).toBe(200);
      const settled = await holdOf(u, referenceId);
      const res = await refundVia(path, u, referenceId);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ refunded: false, amount: 5, balance: 5, ledgerId: null, outcome: "already_captured", reason: "not_refundable" });
      expect(res.body.data).not.toHaveProperty("alreadyProcessed");
      expect(await holdOf(u, referenceId)).toEqual(settled);
      expect(await debits(u, referenceId)).toHaveLength(1);
      expect(await balanceOf(db, u.id)).toBe(5);
    });

    it("capture_failed: terminal and never charged", async () => {
      const u = await fundedUser(5);
      const { referenceId, captureToken } = await reserve(u, randomUUID(), "ARCH_RENDER_STD");
      await db.query(`SELECT post_credit_transaction($1, -5, 'ADMIN_ADJUSTMENT', 'drain')`, [u.id]);
      expect((await capture(referenceId, captureToken)).body.code).toBe("CAPTURE_FAILED");
      const res = await refundVia(path, u, referenceId);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ refunded: false, amount: 5, balance: 0, ledgerId: null, outcome: "capture_failed", reason: "nothing_charged" });
      expect(res.body.data).not.toHaveProperty("alreadyProcessed");
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "capture_failed", settle_reason: "insufficient_credits_at_capture" });
    });

    it("not_found: no reservation for this user and reference", async () => {
      const u = await fundedUser(3);
      const res = await refundVia(path, u, randomUUID());
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ refunded: false, amount: 0, balance: 3, ledgerId: null, outcome: "not_found", reason: "nothing_charged" });
    });
  });
});

describe("ordering: first commit wins, and a settlement is never reversed", () => {
  it("refund then capture: the capture is refused and nothing is ever debited", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: true, outcome: "released" });
    const settled = await holdOf(u, referenceId);
    expect((await capture(referenceId, captureToken)).status).toBe(409);
    expect(await holdOf(u, referenceId)).toEqual(settled);
    expect(await debits(u, referenceId)).toEqual([]);
  });

  it("capture then refund: the refund reports already_captured; the hold row is identical before and after", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    expect((await capture(referenceId, captureToken)).status).toBe(200);
    const settled = await holdOf(u, referenceId);
    expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: false, outcome: "already_captured" });
    expect(await holdOf(u, referenceId)).toEqual(settled);
    expect(await debits(u, referenceId)).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(9);
  });

  it("forced race, capture queued first: charged once, and the refund agrees", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    const lock = await rowLocker(u, referenceId);
    const captured = capture(referenceId, captureToken).then((r) => r);
    await lock.queued(1);
    const refunded = refund(referenceId, refundToken).then((r) => r);
    await lock.queued(2);
    await lock.release();
    const [c, r] = await Promise.all([captured, refunded]);
    expect(c.status).toBe(200);
    expect(r.body.data).toMatchObject({ refunded: false, outcome: "already_captured" });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "captured" });
    expect(await debits(u, referenceId)).toHaveLength(1);
  });

  it("forced race, refund queued first: released, never charged, and the capture agrees", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    const lock = await rowLocker(u, referenceId);
    const refunded = refund(referenceId, refundToken).then((r) => r);
    await lock.queued(1);
    const captured = capture(referenceId, captureToken).then((r) => r);
    await lock.queued(2);
    await lock.release();
    const [r, c] = await Promise.all([refunded, captured]);
    expect(r.body.data).toMatchObject({ refunded: true, outcome: "released" });
    expect(c.status).toBe(409);
    expect(c.body).toMatchObject({ code: "NOT_CAPTURABLE", status: "released" });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "released", ledger_id: null });
    expect(await debits(u, referenceId)).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("unforced rounds: exactly one terminal state, the two answers agree with it, the ledger matches", async () => {
    for (let round = 0; round < 10; round++) {
      const u = await fundedUser();
      const { referenceId, captureToken, refundToken } = await reserve(u);
      const [c, r] = await Promise.all([capture(referenceId, captureToken).then((x) => x), refund(referenceId, refundToken).then((x) => x)]);
      const hold = await holdOf(u, referenceId);
      if (hold.status === "captured") {
        expect(c.status).toBe(200);
        expect(r.body.data.outcome).toBe("already_captured");
        expect(await debits(u, referenceId)).toHaveLength(1);
      } else {
        expect(hold.status).toBe("released");
        expect(c.status).toBe(409);
        expect(r.body.data.outcome).toBe("released");
        expect(await debits(u, referenceId)).toEqual([]);
      }
    }
  }, 60_000);
});

describe("an invalid capability is refused uniformly, with no state change and no fallback to the session", () => {
  const ROUTES = [
    { route: "/capture" as const, purpose: "capture" as const, wrong: "refund" as const },
    { route: "/refund" as const, purpose: "refund" as const, wrong: "capture" as const },
  ];

  describe.each(ROUTES)("$route", ({ route, purpose, wrong }) => {
    /** Every case sends the owner's VALID session too: a fallback would make it succeed. */
    async function expectRefused(makeToken: (ctx: { token: string; referenceId: string; u: U }) => unknown | Promise<unknown>, referenceOf?: (ref: string) => unknown) {
      const u = await fundedUser();
      const { referenceId, captureToken, refundToken } = await reserve(u);
      const token = purpose === "capture" ? captureToken : refundToken;
      const before = await holdOf(u, referenceId);
      const res = await post(
        route,
        { referenceId: referenceOf ? referenceOf(referenceId) : referenceId, [CAPABILITY_FIELD]: await makeToken({ token, referenceId, u }) },
        { authorization: bearer(u) },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toEqual(NOT_AUTHORIZED);
      expect(await holdOf(u, referenceId)).toEqual(before);
      expect(await debits(u, referenceId)).toEqual([]);
      expect(await balanceOf(db, u.id)).toBe(10);
    }

    it.each<[string, (t: string) => unknown]>([
      ["an empty string", () => ""],
      ["null", () => null],
      ["a number", () => 12345],
      ["an object", () => ({ token: "x" })],
      ["an array", (t) => [t]],
      ["a truncated token", (t) => t.slice(0, -5)],
      ["a token with a trailing space", (t) => `${t} `],
      ["a non-capability string", () => "not-a-token"],
      ["a user JWT in place of a capability", () => "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
      ["a 4097-character string", (t) => t.padEnd(4097, "A")],
      ["a tampered signature", withAlteredMac],
    ])("malformed: %s", async (_label, make) => {
      await expectRefused(({ token }) => make(token));
    });

    it.each(["pur", "sub", "ref", "amt", "op", "iat", "rexp", "exp"])("tampered: claim %s edited without re-signing", async (claim) => {
      const change: Record<string, unknown> = {
        pur: wrong,
        sub: randomUUID(),
        ref: "other-reference",
        amt: 1000,
        op: "ARCH_RENDER_HD",
        iat: 1,
        rexp: 4_000_000_000,
        exp: 4_000_000_060,
      };
      await expectRefused(({ token }) => withAlteredPayload(token, { [claim]: change[claim] }));
    });

    it("wrong purpose: the other operation's genuine token", async () => {
      await expectRefused(({ u, referenceId }) => mintForRow(db, wrong, u.id, referenceId));
    });

    it("signed with an unrelated key", async () => {
      await expectRefused(({ u, referenceId }) => mintForRow(db, purpose, u.id, referenceId, {}, { current: OTHER_KEY }));
    });

    it("expired: past the capability's own expiry", async () => {
      await expectRefused(({ u, referenceId }) => mintForRow(db, purpose, u.id, referenceId, { createdAtSeconds: 1000, reservationExpiresAtSeconds: 1600 }));
    });

    it("another reference in the body than in the token", async () => {
      await expectRefused(({ token }) => token, () => "some-other-reference");
    });

    it.each<[string, Record<string, unknown>]>([
      ["amount", { amount: 7 }],
      ["operation", { operationType: "ARCH_RENDER_HD" }],
      ["creation time", { createdAtSeconds: 1_800_000_000 }],
      ["reservation expiry", { reservationExpiresAtSeconds: 4_000_000_000 }],
    ])("correctly signed, but the row's %s differs: refused under the lock, nothing changes, logged", async (_label, overrides) => {
      await expectRefused(async ({ u, referenceId }) => {
        const binding = await persistedBinding(db, u.id, referenceId);
        const merged = { ...binding, ...overrides };
        // A bigger creation time must not be refused by the mint's own iat <= rexp check; this test is about the route.
        if (merged.reservationExpiresAtSeconds < merged.createdAtSeconds) merged.reservationExpiresAtSeconds = merged.createdAtSeconds + 600;
        return mintSettlementCapability(purpose, merged, TEST_SETTLEMENT_KEYS);
      });
      const line = await logs.waitForLine("SETTLEMENT_AUTH_REJECTED");
      expect(line).toMatch(/^error: /);
    });

    it("a correctly signed token of a user who does not own the row cannot touch it", async () => {
      const owner = await fundedUser();
      const { referenceId } = await reserve(owner);
      const before = await holdOf(owner, referenceId);
      const stranger = await fundedUser();
      const binding = await persistedBinding(db, owner.id, referenceId);
      const token = mintSettlementCapability(purpose, { ...binding, userId: stranger.id }, TEST_SETTLEMENT_KEYS);
      const res = await post(route, { referenceId, [CAPABILITY_FIELD]: token });
      // It selects the stranger's (absent) row, so it behaves like "no hold": never the owner's.
      if (route === "/capture") expect(res.status).toBe(404);
      else expect(res.body.data).toMatchObject({ refunded: false, outcome: "not_found" });
      expect(await holdOf(owner, referenceId)).toEqual(before);
    });

    it("a replaced row: a token from an earlier hold on the same reference does not settle the later one", async () => {
      await expectRefused(({ u, referenceId }) => mintForRow(db, purpose, u.id, referenceId, { createdAtSeconds: 1_000_000_000 }));
    });

    it("the valid capability still needs the internal key: without it, 404 like an unknown route", async () => {
      const u = await fundedUser();
      const { referenceId, captureToken, refundToken } = await reserve(u);
      const token = purpose === "capture" ? captureToken : refundToken;
      const res = await post(route, { referenceId, [CAPABILITY_FIELD]: token }, { key: null });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: "Route not found." });
      const wrongKey = await post(route, { referenceId, [CAPABILITY_FIELD]: token }, { key: "wrong-key-0123456789-abcdefghijklmnopqrstuv" });
      expect(wrongKey.status).toBe(404);
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
    });

    it("the internal key alone authorises nothing: no capability and no session → 401, nothing changes", async () => {
      const u = await fundedUser();
      const { referenceId } = await reserve(u);
      const res = await post(route, { referenceId });
      expect(res.status).toBe(401);
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
    });

    it("no JSON body at all → 401 from the legacy path, never a crash", async () => {
      const res = await post(route, undefined);
      expect(res.status).toBe(401);
    });

    it("a non-object JSON body does not count as a capability", async () => {
      const res = await request(app).post(`/api/billing${route}`).set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET).send([1, 2]);
      expect(res.status).toBe(401);
    });

    it("an inherited field does not count as a capability: only the body's own property", async () => {
      const res = await request(app)
        .post(`/api/billing${route}`)
        .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
        .set("Content-Type", "application/json")
        .send(`{"__proto__":{"${CAPABILITY_FIELD}":"x"},"referenceId":"r"}`);
      expect(res.status).toBe(401);
    });
  });

  it("every refusal looks the same to the caller: no reason is ever revealed", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    const responses = await Promise.all([
      capture(referenceId, refundToken).then((r) => r),
      capture(referenceId, withAlteredMac(captureToken)).then((r) => r),
      capture(referenceId, "junk").then((r) => r),
      capture("other", captureToken).then((r) => r),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual(NOT_AUTHORIZED);
    }
  });
});

describe("keys at request time", () => {
  it("rotation: a token signed with the previous key settles while that key is configured, and not once it is removed", async () => {
    const u = await fundedUser();
    const { referenceId } = await reserve(u);
    const oldToken = await mintForRow(db, "capture", u.id, referenceId, {}, { current: OLD_KEY });

    expect((await capture(referenceId, oldToken)).status).toBe(403);
    await withEnv({ SETTLEMENT_CAPABILITY_SECRET_PREVIOUS: OLD_KEY }, async () => {
      expect((await capture(referenceId, oldToken)).status).toBe(200);
    });
    expect((await capture(referenceId, oldToken)).status).toBe(403);
    expect(await debits(u, referenceId)).toHaveLength(1);
  });

  it.each(["", "   "])("a blank previous key (%j) verifies nothing, including a token signed with an empty key", async (previous) => {
    const u = await fundedUser();
    const { referenceId } = await reserve(u);
    await withEnv({ SETTLEMENT_CAPABILITY_SECRET_PREVIOUS: previous }, async () => {
      const [prefix, payload] = (await mintForRow(db, "capture", u.id, referenceId)).split(".") as [string, string];
      const { createHmac } = await import("node:crypto");
      const forged = `${prefix}.${payload}.${createHmac("sha256", "").update(`${prefix}.${payload}`).digest("base64url")}`;
      expect((await capture(referenceId, forged)).status).toBe(403);
    });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
  });

  it("an unconfigured key at request time: uniform 403 (not a retried 500), even for a token that was once valid, and the session path is not used", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken } = await reserve(u);
    await withEnv({ SETTLEMENT_CAPABILITY_SECRET: "" }, async () => {
      const res = await capture(referenceId, captureToken, { authorization: bearer(u) });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(NOT_AUTHORIZED);
    });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
    expect(logs.lines().join("\n")).toMatch(/SETTLEMENT_AUTH_REJECTED.*secret_not_configured/);
  });
});

describe("the legacy session path keeps working until step 6", () => {
  it("capture and refund with the user's JWT and no capability behave as before", async () => {
    const u = await fundedUser();
    const a = await reserve(u);
    const captured = await post("/capture", { referenceId: a.referenceId }, { authorization: bearer(u) });
    expect(captured.status).toBe(200);
    expect(captured.body.data).toMatchObject({ captured: true, alreadyProcessed: false });

    const b = await reserve(u);
    const released = await post("/refund", { referenceId: b.referenceId, reason: "x" }, { authorization: bearer(u) });
    expect(released.status).toBe(200);
    expect(released.body.data).toMatchObject({ refunded: true, outcome: "released" });
  });

  it.each(["/capture", "/refund"])("%s without a capability still enforces the session: revoked 401, unverified 403, another user's hold untouched", async (route) => {
    const u = await fundedUser();
    const stale = bearer(u);
    const { referenceId } = await reserve(u);
    await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [u.id]);
    const revoked = await post(route, { referenceId }, { authorization: stale });
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe("TOKEN_REVOKED");

    const unverified = await fundedUser(5, { verified: false });
    const refused = await post(route, { referenceId }, { authorization: bearer(unverified) });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("EMAIL_NOT_VERIFIED");

    const other = await fundedUser();
    const res = await post(route, { referenceId }, { authorization: bearer(other) });
    if (route === "/capture") expect(res.status).toBe(404);
    else expect(res.body.data).toMatchObject({ refunded: false, outcome: "not_found" });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
  });

  it.each(["/capture", "/refund"])("%s without the internal key is still 404, with a valid session", async (route) => {
    const u = await fundedUser();
    const { referenceId } = await reserve(u);
    expect((await post(route, { referenceId }, { key: null, authorization: bearer(u) })).status).toBe(404);
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
  });
});

describe("tokens and secrets never reach a log line or an error body", () => {
  it("across reserve, capture, refund, repeats and every kind of rejection", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    const second = await reserve(u);
    const mismatched = await mintForRow(db, "capture", u.id, second.referenceId, { amount: 9 });
    const tampered = withAlteredMac(captureToken);
    const bodies: unknown[] = [];
    for (const res of await Promise.all([
      capture(referenceId, tampered).then((r) => r),
      capture(referenceId, refundToken).then((r) => r),
      capture(second.referenceId, mismatched).then((r) => r),
      capture("spoofed-reference-marker", captureToken).then((r) => r),
    ])) {
      expect(res.status).toBe(403);
      bodies.push(res.body);
    }
    await capture(referenceId, captureToken);
    await capture(referenceId, captureToken);
    await refund(second.referenceId, second.refundToken);
    await refund(second.referenceId, second.refundToken);

    const logged = logs.lines().join("\n");
    expect(logged).toContain("SETTLEMENT_AUTH_REJECTED");
    for (const token of [captureToken, refundToken, second.captureToken, second.refundToken, mismatched, tampered]) {
      for (const part of [token, ...token.split(".").slice(1)]) {
        expect(logged).not.toContain(part);
        expect(JSON.stringify(bodies)).not.toContain(part);
      }
    }
    for (const secret of [TEST_ENV.SETTLEMENT_CAPABILITY_SECRET, TEST_ENV.INTERNAL_SERVICE_SECRET, TEST_ENV.JWT_SECRET]) {
      expect(logged).not.toContain(secret);
    }
    // An unverified, caller-supplied reference is never logged.
    expect(logged).not.toContain("spoofed-reference-marker");
  });

  it("a capture or refund response never hands a capability back", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    expect(JSON.stringify((await capture(referenceId, captureToken)).body)).not.toContain("msc1.");
    expect(JSON.stringify((await refund(referenceId, refundToken)).body)).not.toContain("msc1.");
  });
});
