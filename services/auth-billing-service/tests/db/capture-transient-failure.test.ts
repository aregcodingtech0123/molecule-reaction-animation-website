/**
 * A database failure during capture (Phase 2B.1). Real service functions on a real database. Faults are real server
 * errors, a real deadlock and real terminated backends, injected by tests/support/pg-fault.ts.
 *
 * The four cases that must not be confused:
 *   1. Failed before commit and the transaction rolled back: safe to retry.
 *   2. Failed inside the debit's savepoint: the savepoint rolled back, but today capture commits 'capture_failed'.
 *      For a transient error that forfeits a legitimate charge (known defect below).
 *   3. COMMIT outcome unknown to the caller: retrying must give one debit whichever way it went.
 *   4. Permanent business state or a deterministic error: must stay terminal, never retried into a charge.
 *
 * The known-defect tests do not prescribe how the fix works: capture may fail with a retryable error or retry
 * internally, so long as the reservation stays settleable and one retry charges exactly once.
 */
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "../../src/db/index.js";
import { captureOperation, releaseOperation, reserveCreditsForOperation, type CaptureResult } from "../../src/services/aiCredits.service.js";
import { AppError } from "../../src/types/index.js";
import { spyConsole } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, ledgerSum, waitFor, type TestUser } from "../support/db";
import { itKnownDefect } from "../support/known-defect";
import { backendPid, interceptClientQueries, killConnection, sqlStateFault, type InterceptedQuery } from "../support/pg-fault";

const START_BALANCE = 10;
const DEBIT = /post_credit_transaction/;
const HOLD_LOCK = /SELECT status, amount, operation_type/;
const MARK_CAPTURED = /SET status = 'captured'/;

let db: pg.Pool;
let restores: Array<() => void> = [];
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
afterEach(() => {
  for (const restore of restores) restore();
  restores = [];
});

let refCounter = 0;
async function heldReservation(): Promise<{ u: TestUser; ref: string }> {
  const ref = `transient-${++refCounter}`;
  const u = await createUser(db, { balance: 0 });
  await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, START_BALANCE]);
  await reserveCreditsForOperation(u.id, "AI_CHAT_QUERY", ref);
  return { u, ref };
}

/** Run `action` for the first promise-style query matching `pattern`. */
function faultOnce(pattern: RegExp, action: (q: InterceptedQuery) => Promise<unknown>) {
  const state = { fired: false };
  restores.push(
    interceptClientQueries((q) => {
      if (state.fired || !pattern.test(q.sql)) return null;
      state.fired = true;
      return action(q);
    }),
  );
  return state;
}

/** Run `action` for the COMMIT of the transaction that posted the debit. */
function faultOnCommitOfDebit(action: (q: InterceptedQuery) => Promise<unknown>) {
  const state = { fired: false };
  let debitClient: pg.Client | null = null;
  restores.push(
    interceptClientQueries((q) => {
      if (DEBIT.test(q.sql)) debitClient = q.client;
      if (state.fired || q.sql !== "COMMIT" || q.client !== debitClient) return null;
      state.fired = true;
      return action(q);
    }),
  );
  return state;
}

const attempt = async (u: TestUser, ref: string) => (await Promise.allSettled([captureOperation(u.id, ref)]))[0];

const holdOf = async (u: TestUser, ref: string) =>
  (
    await db.query<{ status: string; ledger_id: string | null; settled_at: Date | null; settle_reason: string | null }>(
      `SELECT status, ledger_id::text, settled_at, settle_reason FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`,
      [u.id, ref],
    )
  ).rows[0]!;

const debitsOf = async (u: TestUser, ref: string) =>
  (await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION" && r.reference_id === ref);

function expectInfrastructureFailure(result: PromiseSettledResult<CaptureResult>) {
  expect(result.status).toBe("rejected");
  // A business refusal is an AppError and the BFF never retries it. This one must stay retryable (5xx).
  expect((result as PromiseRejectedResult).reason).not.toBeInstanceOf(AppError);
}

async function expectUntouched(u: TestUser, ref: string) {
  const hold = await holdOf(u, ref);
  expect(hold).toMatchObject({ status: "held", ledger_id: null, settled_at: null, settle_reason: null });
  expect(await debitsOf(u, ref)).toEqual([]);
  expect(await balanceOf(db, u.id)).toBe(START_BALANCE);
  expect(await ledgerSum(db, u.id)).toBe(START_BALANCE);
}

async function expectChargedOnce(u: TestUser, ref: string) {
  const hold = await holdOf(u, ref);
  expect(hold.status).toBe("captured");
  expect(await debitsOf(u, ref)).toEqual([expect.objectContaining({ id: hold.ledger_id, amount: -1 })]);
  expect(await balanceOf(db, u.id)).toBe(START_BALANCE - 1);
  expect(await ledgerSum(db, u.id)).toBe(START_BALANCE - 1);
  return hold;
}

/** One retry after a failure that left the reservation open, plus a duplicate retry. */
async function expectRetryChargesOnce(u: TestUser, ref: string) {
  await expect(captureOperation(u.id, ref)).resolves.toMatchObject({ captured: true, amount: 1, alreadyProcessed: false, balance: START_BALANCE - 1 });
  const hold = await expectChargedOnce(u, ref);
  await expect(captureOperation(u.id, ref)).resolves.toMatchObject({ captured: true, alreadyProcessed: true, ledgerId: hold.ledger_id });
  await expectChargedOnce(u, ref);
}

describe("case 1: the transaction rolled back as a whole, so a retry is safe", () => {
  describe.each(["40P01", "40001"])("SQLSTATE %s", (sqlState) => {
    it("while locking the hold, before any debit: nothing changes, the retry charges once", async () => {
      const { u, ref } = await heldReservation();
      const fault = faultOnce(HOLD_LOCK, (q) => q.proceed(sqlStateFault(sqlState)));

      const first = await attempt(u, ref);

      expect(fault.fired).toBe(true);
      expectInfrastructureFailure(first);
      expect((first as PromiseRejectedResult).reason).toMatchObject({ code: sqlState });
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    });

    it("while marking the hold captured, after the debit: the debit rolls back with it, the retry charges once", async () => {
      const { u, ref } = await heldReservation();
      const fault = faultOnce(MARK_CAPTURED, (q) => q.proceed(sqlStateFault(sqlState)));

      const first = await attempt(u, ref);

      expect(fault.fired).toBe(true);
      expectInfrastructureFailure(first);
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    });
  });
});

/** A real deadlock: this session holds the balance row and waits for the hold, while capture holds the hold and waits for the balance. */
async function captureHittingRealDeadlock(u: TestUser, ref: string) {
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await blocker.connect();
  try {
    // Capture's session keeps the default 1 s, so it detects the cycle first and is the victim.
    await blocker.query(`SET deadlock_timeout = '5s'`);
    await blocker.query("BEGIN");
    await blocker.query(`SELECT 1 FROM user_balances WHERE user_id = $1 FOR UPDATE`, [u.id]);

    const seen: { code?: string; pid?: number } = {};
    faultOnce(DEBIT, (q) => {
      seen.pid = backendPid(q.client);
      return q.proceed().catch((err: { code?: string }) => {
        seen.code = err.code;
        throw err;
      });
    });
    const first = attempt(u, ref);
    await waitFor(async () => {
      if (!seen.pid) return false;
      const { rows } = await db.query<{ blockers: number[] }>(`SELECT pg_blocking_pids($1) AS blockers`, [seen.pid]);
      return rows[0]!.blockers.includes(backendPid(blocker));
    });
    const closesTheCycle = blocker.query(`SELECT 1 FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2 FOR UPDATE`, [u.id, ref]);
    const result = await first;
    await closesTheCycle;
    await blocker.query("COMMIT");
    return { result, observedSqlState: seen.code };
  } finally {
    await blocker.end();
  }
}

async function captureHittingInjectedError(u: TestUser, ref: string, sqlState: string) {
  const seen: { code?: string } = {};
  faultOnce(DEBIT, (q) =>
    q.proceed(sqlStateFault(sqlState)).catch((err: { code?: string }) => {
      seen.code = err.code;
      throw err;
    }),
  );
  return { result: await attempt(u, ref), observedSqlState: seen.code };
}

const TRANSIENT_DEBIT_FAULTS: Array<[string, string, (u: TestUser, ref: string) => ReturnType<typeof captureHittingRealDeadlock>]> = [
  ["a real deadlock", "40P01", captureHittingRealDeadlock],
  ["a serialization failure", "40001", (u, ref) => captureHittingInjectedError(u, ref, "40001")],
];

describe("case 2: a transient error inside the debit's savepoint", () => {
  it.each(TRANSIENT_DEBIT_FAULTS)("harness: %s reaches the debit as %s and never leaves a partial debit", async (_name, sqlState, run) => {
    const { u, ref } = await heldReservation();

    const { observedSqlState } = await run(u, ref);

    expect(observedSqlState).toBe(sqlState);
    const debits = await debitsOf(u, ref);
    expect(debits.length).toBeLessThanOrEqual(1);
    expect(await balanceOf(db, u.id)).toBe(START_BALANCE - debits.length);
    expect(await ledgerSum(db, u.id)).toBe(START_BALANCE - debits.length);
  });

  // Today: recorded as terminal 'capture_failed' (reason db_error_<code>), so the turn is free forever.
  itKnownDefect.each(TRANSIENT_DEBIT_FAULTS)("%s (%s) does not permanently invalidate the reservation; a retry charges once", async (_name, _sqlState, run) => {
    const { u, ref } = await heldReservation();

    const { result } = await run(u, ref);

    expect(result).not.toMatchObject({ reason: { code: "CAPTURE_FAILED" } });
    const hold = await holdOf(u, ref);
    expect(hold.status).not.toBe("capture_failed");
    if (hold.status === "captured") {
      await expectChargedOnce(u, ref);
    } else {
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    }
  });
});

describe("connection lost: the server rolls the open transaction back", () => {
  const killAt = (arm: (action: (q: InterceptedQuery) => Promise<unknown>) => { fired: boolean }) => {
    const seen: { errorListenersBefore?: number } = {};
    const fault = arm(async (q) => {
      Object.assign(seen, await killConnection(db, q.client));
      return q.proceed();
    });
    return { seen, fault };
  };

  const POINTS: Array<[string, (action: (q: InterceptedQuery) => Promise<unknown>) => { fired: boolean }]> = [
    ["during the debit", (action) => faultOnce(DEBIT, action)],
    ["before COMMIT reaches the server", faultOnCommitOfDebit],
  ];

  it.each(POINTS)("%s: not recorded as capture_failed, nothing charged, the retry charges once", async (_name, arm) => {
    const { u, ref } = await heldReservation();
    const { fault } = killAt(arm);

    const first = await attempt(u, ref);

    expect(fault.fired).toBe(true);
    expectInfrastructureFailure(first);
    await expectUntouched(u, ref);
    await expectRetryChargesOnce(u, ref);
  });

  // pg-pool removes its own 'error' listener at checkout, and the service has no uncaughtException handler, so without
  // withTransaction's listener this event ends the Node process (Phase 2B.2, with-transaction-connection-loss.test.ts).
  // The harness adds a listener to keep the test run alive, and this test looks at the count from before that.
  it.each(POINTS)("%s: the dead connection's 'error' event is handled, so it cannot crash the service", async (_name, arm) => {
    const { u, ref } = await heldReservation();
    const { seen } = killAt(arm);

    await attempt(u, ref);

    expect(seen.errorListenersBefore).toBeGreaterThan(0);
  });
});

describe("case 3: COMMIT succeeded but its response was lost", () => {
  it("the caller sees a failure, the capture stands, and the retry reports the original charge without a second debit", async () => {
    const { u, ref } = await heldReservation();
    const fault = faultOnCommitOfDebit(async (q) => {
      await q.proceed();
      throw new Error("Connection terminated unexpectedly");
    });

    const first = await attempt(u, ref);

    expect(fault.fired).toBe(true);
    expectInfrastructureFailure(first);
    const hold = await expectChargedOnce(u, ref);
    await expect(captureOperation(u.id, ref)).resolves.toMatchObject({
      captured: true,
      alreadyProcessed: true,
      ledgerId: hold.ledger_id,
      balance: START_BALANCE - 1,
    });
    await expect(releaseOperation(u.id, ref, "too late")).resolves.toMatchObject({ refunded: false, reason: "not_refundable" });
    expect(await holdOf(u, ref)).toEqual(hold);
    await expectChargedOnce(u, ref);
  });
});

describe("case 4: permanent outcomes stay terminal", () => {
  const preDebitFault = () => faultOnce(HOLD_LOCK, (q) => q.proceed(sqlStateFault("40P01")));

  it("insufficient credits (P0001): capture_failed, retries refused, nothing charged", async () => {
    const { u, ref } = await heldReservation();
    await db.query(`SELECT post_credit_transaction($1, $2, 'ADMIN_ADJUSTMENT', 'drain')`, [u.id, -START_BALANCE]);

    await expect(captureOperation(u.id, ref)).rejects.toMatchObject({ statusCode: 409, code: "CAPTURE_FAILED" });
    expect(await holdOf(u, ref)).toMatchObject({ status: "capture_failed", settle_reason: "insufficient_credits_at_capture", ledger_id: null });

    await expect(captureOperation(u.id, ref)).rejects.toMatchObject({ statusCode: 409, code: "NOT_CAPTURABLE" });
    await expect(releaseOperation(u.id, ref, "retry")).resolves.toMatchObject({ refunded: false, reason: "nothing_charged" });
    expect(await debitsOf(u, ref)).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(0);
  });

  it("a deterministic debit error (23505, the reference is already in the ledger) stays terminal: not every database error is retryable", async () => {
    const { u, ref } = await heldReservation();
    await db.query(`SELECT post_credit_transaction($1, -1, 'CREDIT_CONSUMPTION', $2)`, [u.id, ref]);

    await expect(captureOperation(u.id, ref)).rejects.toMatchObject({ statusCode: 409, code: "CAPTURE_FAILED" });
    expect(await holdOf(u, ref)).toMatchObject({ status: "capture_failed", settle_reason: "db_error_23505", ledger_id: null });

    await expect(captureOperation(u.id, ref)).rejects.toMatchObject({ statusCode: 409, code: "NOT_CAPTURABLE" });
    expect(await debitsOf(u, ref)).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(START_BALANCE - 1);
    expect(await ledgerSum(db, u.id)).toBe(START_BALANCE - 1);
  });

  it("released after a transient failure: the retried capture is refused, nothing charged", async () => {
    const { u, ref } = await heldReservation();
    preDebitFault();
    expectInfrastructureFailure(await attempt(u, ref));

    await expect(releaseOperation(u.id, ref, "gave_up")).resolves.toMatchObject({ refunded: true });

    await expect(captureOperation(u.id, ref)).rejects.toMatchObject({ statusCode: 409, code: "NOT_CAPTURABLE", details: { status: "released" } });
    expect(await holdOf(u, ref)).toMatchObject({ status: "released", ledger_id: null });
    expect(await debitsOf(u, ref)).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(START_BALANCE);
  });

  it("expired after a transient failure: the retried capture settles it as expired, nothing charged", async () => {
    const { u, ref } = await heldReservation();
    preDebitFault();
    expectInfrastructureFailure(await attempt(u, ref));

    await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1 AND reference_id = $2`, [u.id, ref]);

    await expect(captureOperation(u.id, ref)).rejects.toMatchObject({ statusCode: 409, code: "HOLD_EXPIRED" });
    expect(await holdOf(u, ref)).toMatchObject({ status: "expired", settle_reason: "capture_after_expiry", ledger_id: null });
    await expect(captureOperation(u.id, ref)).rejects.toMatchObject({ statusCode: 409, code: "NOT_CAPTURABLE" });
    expect(await debitsOf(u, ref)).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(START_BALANCE);
  });
});
