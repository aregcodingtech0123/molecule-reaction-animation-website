/**
 * Capture racing release for the same reservation: exactly one terminal outcome, whichever commits first.
 * Calls the real service functions on the service's own pool, so the database decides the interleaving.
 *
 * Both orders are forced deterministically (a third session holds the hold's row lock until both callers are
 * queued, as in tests/api/hold-expiry-race.test.ts). The unforced rounds then start both at once.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "../../src/db/index.js";
import { captureOperation, releaseOperation, reserveCreditsForOperation, type CaptureResult, type RefundResult } from "../../src/services/aiCredits.service.js";
import { AppError } from "../../src/types/index.js";
import { spyConsole } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, ledgerSum, waitFor, type TestUser } from "../support/db";

const START_BALANCE = 10;
const UNFORCED_ROUNDS = 25;

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

async function heldReservation(ref: string): Promise<TestUser> {
  const u = await createUser(db, { balance: 0 });
  await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, START_BALANCE]);
  await reserveCreditsForOperation(u.id, "AI_CHAT_QUERY", ref);
  return u;
}

/** A session holding the reservation's row lock; `queued(n)` waits until n sessions are blocked behind it, directly or not. */
async function rowLocker(u: TestUser, ref: string) {
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

const holdOf = async (u: TestUser, ref: string) =>
  (
    await db.query<{ status: string; ledger_id: string | null; settled_at: Date | null; settle_reason: string | null }>(
      `SELECT status, ledger_id::text, settled_at, settle_reason FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`,
      [u.id, ref],
    )
  ).rows[0]!;

const debitsOf = async (u: TestUser, ref: string) =>
  (await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION" && r.reference_id === ref);

/** The losing capture must be this exact refusal: nothing else counts as "release won". */
function expectRefusedAsAlreadyReleased(captureResult: PromiseSettledResult<CaptureResult>) {
  expect(captureResult.status).toBe("rejected");
  const reason = (captureResult as PromiseRejectedResult).reason as AppError;
  expect(reason).toBeInstanceOf(AppError);
  expect(reason).toMatchObject({ statusCode: 409, code: "NOT_CAPTURABLE", details: { status: "released" } });
}

async function expectCaptureWon(u: TestUser, ref: string, capture: PromiseSettledResult<CaptureResult>, release: RefundResult) {
  expect(capture.status).toBe("fulfilled");
  const captured = (capture as PromiseFulfilledResult<CaptureResult>).value;
  expect(captured).toMatchObject({ captured: true, amount: 1, alreadyProcessed: false, balance: START_BALANCE - 1 });
  expect(release).toMatchObject({ refunded: false, reason: "not_refundable" });

  const hold = await holdOf(u, ref);
  expect(hold).toMatchObject({ status: "captured", ledger_id: captured.ledgerId, settle_reason: null });
  expect(hold.settled_at).not.toBeNull();

  // Retries report the same outcome and change nothing.
  await expect(captureOperation(u.id, ref)).resolves.toMatchObject({
    captured: true,
    alreadyProcessed: true,
    ledgerId: captured.ledgerId,
    balance: START_BALANCE - 1,
  });
  await expect(releaseOperation(u.id, ref, "retry")).resolves.toMatchObject({ refunded: false, reason: "not_refundable" });

  expect(await holdOf(u, ref)).toEqual(hold);
  expect(await debitsOf(u, ref)).toEqual([expect.objectContaining({ id: captured.ledgerId, amount: -1 })]);
  expect(await balanceOf(db, u.id)).toBe(START_BALANCE - 1);
  expect(await ledgerSum(db, u.id)).toBe(START_BALANCE - 1);
}

async function expectReleaseWon(u: TestUser, ref: string, capture: PromiseSettledResult<CaptureResult>, release: RefundResult) {
  expectRefusedAsAlreadyReleased(capture);
  expect(release).toMatchObject({ refunded: true, amount: 1, ledgerId: null, balance: START_BALANCE });

  const hold = await holdOf(u, ref);
  expect(hold).toMatchObject({ status: "released", ledger_id: null, settle_reason: "race" });
  expect(hold.settled_at).not.toBeNull();

  // Retries report the same outcome and change nothing.
  const [retriedCapture] = await Promise.allSettled([captureOperation(u.id, ref)]);
  expectRefusedAsAlreadyReleased(retriedCapture);
  await expect(releaseOperation(u.id, ref, "retry")).resolves.toMatchObject({ refunded: false, reason: "already_refunded" });

  expect(await holdOf(u, ref)).toEqual(hold);
  expect(await debitsOf(u, ref)).toEqual([]);
  expect(await balanceOf(db, u.id)).toBe(START_BALANCE);
  expect(await ledgerSum(db, u.id)).toBe(START_BALANCE);
}

describe("capture vs release on the same reservation", () => {
  it("capture queued first, release behind it: charged once, release reports not_refundable, retries agree", async () => {
    const ref = "race-capture-first";
    const u = await heldReservation(ref);
    const lock = await rowLocker(u, ref);
    const capture = Promise.allSettled([captureOperation(u.id, ref)]);
    await lock.queued(1);
    const release = releaseOperation(u.id, ref, "race");
    await lock.queued(2);
    await lock.release();

    const [[captured], released] = await Promise.all([capture, release]);
    await expectCaptureWon(u, ref, captured, released);
  });

  it("release queued first, capture behind it: never charged, capture refused, retries agree", async () => {
    const ref = "race-release-first";
    const u = await heldReservation(ref);
    const lock = await rowLocker(u, ref);
    const release = releaseOperation(u.id, ref, "race");
    await lock.queued(1);
    const capture = Promise.allSettled([captureOperation(u.id, ref)]);
    await lock.queued(2);
    await lock.release();

    const [released, [captured]] = await Promise.all([release, capture]);
    await expectReleaseWon(u, ref, captured, released);
  });

  it(`${UNFORCED_ROUNDS} unforced rounds, alternating start order: every round settles exactly once and consistently`, async () => {
    for (let round = 0; round < UNFORCED_ROUNDS; round++) {
      const ref = `race-unforced-${round}`;
      const u = await heldReservation(ref);
      const startCapture = () => captureOperation(u.id, ref);
      const startRelease = () => releaseOperation(u.id, ref, "race");

      let captured: PromiseSettledResult<CaptureResult>;
      let released: RefundResult;
      if (round % 2 === 0) {
        const c = startCapture();
        const r = startRelease();
        [[captured], released] = await Promise.all([Promise.allSettled([c]), r]);
      } else {
        const r = startRelease();
        const c = startCapture();
        [released, [captured]] = await Promise.all([r, Promise.allSettled([c])]);
      }

      if (captured.status === "fulfilled") await expectCaptureWon(u, ref, captured, released);
      else await expectReleaseWon(u, ref, captured, released);
    }
  }, 60_000);
});
