/**
 * Phase 2 review (ledger & billing): the expiry sweeper and a capture racing for the same reservation.
 * Both orders are forced deterministically — a third session holds the hold's row lock until both callers
 * are queued behind it — and in each the hold settles exactly once: charged once, or never charged.
 */
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, waitFor } from "../support/db";
import { capabilityFor } from "../support/settlement";

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

type U = { id: string; email: string };
const internal = (path: string, u: U, body: Record<string, unknown>) =>
  request(app).post(path).set("Authorization", bearer(u)).set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET).send(body);
/** A capture as the BFF makes it since Step 7.4 (C6): the internal key and a capability for the hold as it is now, no session. */
const captureWith = (ref: string, settlementCapability: string) =>
  request(app).post("/api/billing/capture").set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET).send({ referenceId: ref, settlementCapability });

async function heldUser(ref: string) {
  const u = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
  expect((await internal("/api/billing/consume", u, { operationType: "AI_CHAT_QUERY", referenceId: ref })).status).toBe(200);
  return u;
}

/**
 * A session that holds the reservation's row lock; `queued(n)` waits until n sessions wait behind it. Only the
 * first waiter is blocked by the locker itself — later ones queue on the tuple lock behind the first.
 */
async function rowLocker(u: U, ref: string) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const pid = (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
  await c.query("BEGIN");
  await c.query(`SELECT 1 FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2 FOR UPDATE`, [u.id, ref]);
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

async function sweeper() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c.query(`SELECT release_expired_ai_holds()`).finally(() => c.end());
}

const holdOf = async (u: U, ref: string) =>
  (await db.query(`SELECT status, settle_reason, ledger_id::text FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`, [u.id, ref])).rows[0];

describe("expiry sweeper vs capture on the same reservation", () => {
  it("capture started before expiry, sweeper arrives after expiry: charged exactly once, not also expired", async () => {
    const u = await heldUser("race-capture-first");
    await db.query(
      `UPDATE ai_credit_holds SET expires_at = clock_timestamp() + interval '1500 milliseconds' WHERE user_id = $1 AND reference_id = 'race-capture-first'`,
      [u.id],
    );
    // Signed for the row after the fixture change above, and before the race starts, so the 1.5 s window is not spent here.
    const token = await capabilityFor(db, "capture", u.id, "race-capture-first");
    const lock = await rowLocker(u, "race-capture-first");
    const capture = captureWith("race-capture-first", token).then((r) => r);
    await lock.queued(1);
    // The capture's transaction started before expiry; now let the reservation expire for everyone else.
    await waitFor(
      async () =>
        (await db.query(`SELECT expires_at < clock_timestamp() AS past FROM ai_credit_holds WHERE user_id = $1 AND reference_id = 'race-capture-first'`, [u.id])).rows[0].past,
      { timeoutMs: 4_000 },
    );
    const sweep = sweeper();
    await lock.queued(2);
    await lock.release();

    const [res] = await Promise.all([capture, sweep]);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ captured: true, amount: 1 });
    expect(await holdOf(u, "race-capture-first")).toMatchObject({ status: "captured", settle_reason: null });
    expect((await ledgerOf(db, u.id)).filter((r) => r.reference_id === "race-capture-first")).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(9);
  });

  it("sweeper first on an expired reservation, capture queued behind it: never charged, capture refused", async () => {
    const u = await heldUser("race-sweep-first");
    await db.query(
      // created_at moves too: a capability's reservation expiry can never precede its issue time (as in expireHold elsewhere).
      `UPDATE ai_credit_holds SET created_at = NOW() - interval '1 hour', expires_at = NOW() - interval '1 second' WHERE user_id = $1 AND reference_id = 'race-sweep-first'`,
      [u.id],
    );
    const token = await capabilityFor(db, "capture", u.id, "race-sweep-first");
    const lock = await rowLocker(u, "race-sweep-first");
    const sweep = sweeper();
    await lock.queued(1);
    const capture = captureWith("race-sweep-first", token).then((r) => r);
    await lock.queued(2);
    await lock.release();

    const [, res] = await Promise.all([sweep, capture]);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_CAPTURABLE");
    expect(await holdOf(u, "race-sweep-first")).toMatchObject({ status: "expired", settle_reason: "expired_unsettled", ledger_id: null });
    expect((await ledgerOf(db, u.id)).filter((r) => r.reference_id === "race-sweep-first")).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("an expired-but-unswept reservation no longer counts against the available balance", async () => {
    const u = await heldUser("stale");
    await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1`, [u.id]);
    const res = await request(app).get("/api/billing/balance").set("Authorization", bearer(u));
    expect(res.status).toBe(200);
    // Ten credits, none reserved any more (the stale hold can never be captured).
    const next = await internal("/api/billing/consume", u, { operationType: "AI_CHAT_QUERY", referenceId: "after-stale" });
    expect(next.status).toBe(200);
    expect(next.body.data.balance).toBe(9);
  });
});
