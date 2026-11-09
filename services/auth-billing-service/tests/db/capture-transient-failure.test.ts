/**
 * A database failure during capture (Phase 2B.1). Real service functions on a real database. Faults are real server
 * errors, a real deadlock and real terminated backends, injected by tests/support/pg-fault.ts.
 *
 * The five cases that must not be confused:
 *   1. Failed before commit and the transaction rolled back: safe to retry.
 *   2. A retryable error inside the debit: the whole transaction rolls back, the hold stays 'held', a retry charges once.
 *   3. COMMIT outcome unknown to the caller: a new transaction reads the hold under its lock, and the caller gets the
 *      original charge, a retryable failure, or an explicit "could not be established". Never a second debit.
 *   4. Permanent business state or a deterministic error: must stay terminal, never retried into a charge.
 *   5. An unknown error: fully rolled back, the hold stays 'held' for reconciliation, never retried, never terminal.
 *
 * Where a test simulates something instead of causing it, it says so. A real transport loss during COMMIT has its own test.
 */
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "../../src/db/index.js";
import { CAPTURE_INSPECTION_LOCK_TIMEOUT_MS, captureOperation, releaseOperation, reserveCreditsForOperation, type CaptureResult } from "../../src/services/aiCredits.service.js";
import { AppError } from "../../src/types/index.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, ledgerSum, waitFor, type TestUser } from "../support/db";
import {
  armRealCommitRejection,
  armSlowCommit,
  backendPid,
  destroySocket,
  interceptClientQueries,
  killConnection,
  sqlStateFault,
  terminateBackend,
  waitUntilCommitInFlight,
  type InterceptedQuery,
} from "../support/pg-fault";

const START_BALANCE = 10;
const DEBIT = /post_credit_transaction/;
const HOLD_LOCK = /SELECT status, amount, operation_type/;
const MARK_CAPTURED = /SET status = 'captured'/;

let db: pg.Pool;
let logs: ConsoleSpies;
let restores: Array<() => void> = [];
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
afterEach(() => {
  // Last in, first out: each interceptor wraps the one installed before it.
  for (const restore of restores.reverse()) restore();
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

  it.each(TRANSIENT_DEBIT_FAULTS)("%s (%s) does not permanently invalidate the reservation; a retry charges once", async (_name, _sqlState, run) => {
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

  it.each(["40P01", "40001"])("%s inside the debit: the caller gets the raw retryable error, and the whole transaction rolls back, not just the savepoint", async (sqlState) => {
    const { u, ref } = await heldReservation();
    const sent: string[] = [];
    restores.push(
      interceptClientQueries((q) => {
        sent.push(q.sql);
        return null;
      }),
    );
    faultOnce(DEBIT, (q) => q.proceed(sqlStateFault(sqlState)));

    const first = await attempt(u, ref);

    expectInfrastructureFailure(first);
    expect((first as PromiseRejectedResult).reason).toMatchObject({ code: sqlState });
    expect(sent).toContain("ROLLBACK");
    expect(sent).not.toContain("ROLLBACK TO SAVEPOINT capture_debit");
    expect(sent.filter((s) => s === "BEGIN")).toHaveLength(1); // no retry inside the service
    await expectUntouched(u, ref);
    await expectRetryChargesOnce(u, ref);
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

/**
 * An ambiguous COMMIT, then the new transaction that inspects the hold.
 *  - `landed: true`: the COMMIT really commits, then its answer is lost. The loss is SIMULATED: a thrown error with no
 *    server severity, as pg gives for a dropped socket. The real thing is in the transport-loss test below.
 *  - `landed: false`: the backend is really terminated before the COMMIT reaches it, so the server really rolls back.
 *  - `beforeInspection` runs after the COMMIT failed and before the inspection reads anything.
 *  - `onInspection` takes over the inspection's read of the hold.
 */
function ambiguousCommit(opts: { landed: boolean; beforeInspection?: () => Promise<void>; onInspection?: (q: InterceptedQuery) => Promise<unknown> }) {
  const state = { fired: false, inspected: false };
  let debitClient: pg.Client | null = null;
  let armed = false;
  restores.push(
    interceptClientQueries((q) => {
      if (DEBIT.test(q.sql)) debitClient = q.client;
      if (!state.fired && q.sql === "COMMIT" && q.client === debitClient) {
        state.fired = true;
        return (async () => {
          try {
            if (opts.landed) {
              await q.proceed();
              throw new Error("Connection terminated unexpectedly");
            }
            await killConnection(db, q.client);
            return await q.proceed();
          } finally {
            await opts.beforeInspection?.();
            armed = true;
          }
        })();
      }
      if (armed && !state.inspected && HOLD_LOCK.test(q.sql)) {
        state.inspected = true;
        return opts.onInspection?.(q) ?? null;
      }
      return null;
    }),
  );
  return state;
}

/** Every statement sent on the service's clients from now on. */
function recordStatements() {
  const sent: string[] = [];
  restores.push(
    interceptClientQueries((q) => {
      sent.push(q.sql);
      return null;
    }),
  );
  return sent;
}

describe("case 3: the COMMIT's outcome is unknown to the caller", () => {
  describe("the COMMIT landed and its answer was lost (simulated loss, real commit)", () => {
    it("a new transaction finds the capture: the caller gets the original ledger id, and there is no second debit", async () => {
      const { u, ref } = await heldReservation();
      const fault = ambiguousCommit({ landed: true });

      const first = await attempt(u, ref);

      expect(fault.fired).toBe(true);
      expect(fault.inspected).toBe(true);
      const hold = await expectChargedOnce(u, ref);
      expect(first).toEqual({
        status: "fulfilled",
        value: { captured: true, amount: 1, balance: START_BALANCE - 1, ledgerId: hold.ledger_id, alreadyProcessed: true },
      });
      await expect(captureOperation(u.id, ref)).resolves.toMatchObject({ captured: true, alreadyProcessed: true, ledgerId: hold.ledger_id, balance: START_BALANCE - 1 });
      await expect(releaseOperation(u.id, ref, "too late")).resolves.toMatchObject({ refunded: false, reason: "not_refundable" });
      expect(await holdOf(u, ref)).toEqual(hold);
      await expectChargedOnce(u, ref);
    });

    it("the inspection only reads: exactly one debit statement was ever sent, and nothing was updated after the COMMIT", async () => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      ambiguousCommit({ landed: true });

      await attempt(u, ref);

      expect(sent.filter((s) => DEBIT.test(s))).toHaveLength(1);
      const afterCommit = sent.slice(sent.indexOf("COMMIT") + 1);
      // Statements that write. The read's own `FOR UPDATE` is its lock, not a write.
      expect(afterCommit.some((s) => /^\s*(INSERT|UPDATE|DELETE)\b|post_credit_transaction/.test(s))).toBe(false);
      expect(afterCommit.some((s) => HOLD_LOCK.test(s))).toBe(true);
    });
  });

  describe("the COMMIT never landed (real terminated backend, real rollback)", () => {
    it("a new transaction finds the hold still held: a retryable failure, nothing charged, and the retry charges once", async () => {
      const { u, ref } = await heldReservation();
      const fault = ambiguousCommit({ landed: false });

      const first = await attempt(u, ref);

      expect(fault.fired).toBe(true);
      expect(fault.inspected).toBe(true);
      expectInfrastructureFailure(first);
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    });

    it("a release wins while the outcome is unknown: refused accurately, and capture and release never both succeed", async () => {
      const { u, ref } = await heldReservation();
      let released: unknown;
      ambiguousCommit({
        landed: false,
        beforeInspection: async () => {
          released = await releaseOperation(u.id, ref, "gave_up");
        },
      });

      const first = await attempt(u, ref);

      expect(released).toMatchObject({ refunded: true, outcome: "released" });
      expect(first).toMatchObject({ status: "rejected", reason: { statusCode: 409, code: "NOT_CAPTURABLE", details: { status: "released" } } });
      expect(await holdOf(u, ref)).toMatchObject({ status: "released", ledger_id: null });
      expect(await debitsOf(u, ref)).toEqual([]);
      expect(await balanceOf(db, u.id)).toBe(START_BALANCE);
    });
  });

  describe("the outcome cannot be established: an explicit, retryable indeterminate result", () => {
    const expectUnresolved = (result: PromiseSettledResult<CaptureResult>) =>
      expect(result).toMatchObject({ status: "rejected", reason: { statusCode: 503, code: "CAPTURE_INDETERMINATE", details: { commitOutcome: "unknown" } } });

    it.each([
      ["a server error while reading the hold", (q: InterceptedQuery) => q.proceed(sqlStateFault("XX000"))],
      ["a retryable error while reading the hold", (q: InterceptedQuery) => q.proceed(sqlStateFault("40P01"))],
      ["the inspection's own connection dying", async (q: InterceptedQuery) => {
        await killConnection(db, q.client);
        return q.proceed();
      }],
    ])("the COMMIT landed, %s: indeterminate, and the later retry reports the original charge without a second debit", async (_name, onInspection) => {
      const { u, ref } = await heldReservation();
      const fault = ambiguousCommit({ landed: true, onInspection });

      const first = await attempt(u, ref);

      expect(fault.inspected).toBe(true);
      expectUnresolved(first);
      const hold = await expectChargedOnce(u, ref);
      await expect(captureOperation(u.id, ref)).resolves.toMatchObject({ captured: true, alreadyProcessed: true, ledgerId: hold.ledger_id });
      await expectChargedOnce(u, ref);
    });

    it("the COMMIT did not land, and the inspection fails: indeterminate, the hold stays held, and the later retry charges once", async () => {
      const { u, ref } = await heldReservation();
      ambiguousCommit({ landed: false, onInspection: (q) => q.proceed(sqlStateFault("XX000")) });

      const first = await attempt(u, ref);

      expectUnresolved(first);
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    });

    it("another session holds the row: the inspection gives up at its lock timeout (a real 55P03) instead of hanging", async () => {
      const { u, ref } = await heldReservation();
      const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await locker.connect();
      try {
        ambiguousCommit({
          landed: true,
          beforeInspection: async () => {
            await locker.query("BEGIN");
            await locker.query(`SELECT 1 FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2 FOR UPDATE`, [u.id, ref]);
          },
        });
        const started = Date.now();

        const first = await attempt(u, ref);

        expectUnresolved(first);
        expect(Date.now() - started).toBeGreaterThanOrEqual(CAPTURE_INSPECTION_LOCK_TIMEOUT_MS - 100);
        expect(logs.lines().join("\n")).toMatch(/CAPTURE_AMBIGUOUS_COMMIT.*"resolution":"unresolved".*"sqlstate":"55P03"/);
      } finally {
        await locker.query("ROLLBACK").catch(() => undefined);
        await locker.end();
      }
      const hold = await expectChargedOnce(u, ref);
      await expect(captureOperation(u.id, ref)).resolves.toMatchObject({ alreadyProcessed: true, ledgerId: hold.ledger_id });
    }, 30_000);
  });

  describe("a real transport loss: the socket is destroyed right after COMMIT is written", () => {
    // Whether the server received that COMMIT is genuinely unknown, which is the point: either outcome may happen and each
    // must stay consistent. SHOW_FAULT_OUTCOMES=1 prints how often each one was seen.
    it("in every round: an established result matches the database, and one retry leaves exactly one debit", async () => {
      const seen = { committed: 0, rolledBack: 0, unresolved: 0 };
      for (let round = 0; round < 15; round++) {
        const { u, ref } = await heldReservation();
        let debitClient: pg.Client | null = null;
        let fired = false;
        const restore = interceptClientQueries((q) => {
          if (DEBIT.test(q.sql)) debitClient = q.client;
          if (fired || q.sql !== "COMMIT" || q.client !== debitClient) return null;
          fired = true;
          const answer = q.proceed();
          (q.client as unknown as { connection: { stream: { destroy(): void } } }).connection.stream.destroy();
          return answer;
        });
        const first = await attempt(u, ref);
        restore();

        expect(fired).toBe(true);
        if (first.status === "fulfilled") {
          seen.committed++;
          const hold = await expectChargedOnce(u, ref);
          expect(first.value).toMatchObject({ captured: true, alreadyProcessed: true, ledgerId: hold.ledger_id });
        } else if ((first.reason as AppError).code === "CAPTURE_INDETERMINATE") {
          seen.unresolved++;
          expect(first.reason).toMatchObject({ statusCode: 503, details: { commitOutcome: "unknown" } });
        } else {
          seen.rolledBack++;
          expectInfrastructureFailure(first);
          await expectUntouched(u, ref);
        }
        await expect(captureOperation(u.id, ref)).resolves.toMatchObject({ captured: true, amount: 1 });
        await expectChargedOnce(u, ref);
      }
      if (process.env.SHOW_FAULT_OUTCOMES === "1") console.info("[real transport loss]", JSON.stringify(seen));
    }, 60_000);
  });

  // SIMULATION, not a COMMIT rejection: a failing DO statement is sent instead of COMMIT. It proves how an answered statement
  // in the COMMIT phase is classified for these two SQLSTATEs. Real rejections are in "COMMIT outcomes, caused for real".
  describe("a failing statement sent in place of COMMIT, with a server answer", () => {
    it("with a retryable SQLSTATE: the raw error, no inspection, the retry charges once", async () => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      faultOnCommitOfDebit((q) => q.proceed(sqlStateFault("40001")));

      const first = await attempt(u, ref);

      expectInfrastructureFailure(first);
      expect((first as PromiseRejectedResult).reason).toMatchObject({ code: "40001" });
      expect(sent.filter((s) => s === "BEGIN")).toHaveLength(1);
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    });

    it("with an unknown SQLSTATE: rolled back, so indeterminate and not retried, with no inspection", async () => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      faultOnCommitOfDebit((q) => q.proceed(sqlStateFault("XX000")));

      const first = await attempt(u, ref);

      expect(first).toMatchObject({ status: "rejected", reason: { statusCode: 409, code: "CAPTURE_INDETERMINATE", details: { commitOutcome: "rolled_back" } } });
      expect(sent.filter((s) => s === "BEGIN")).toHaveLength(1);
      await expectUntouched(u, ref);
    });
  });
});

/**
 * The four COMMIT outcomes on a real capture transaction, each caused for real (see the helpers in pg-fault.ts).
 * What the service can prove differs per case, and a generic network error must prove nothing about a rollback.
 */
describe("COMMIT outcomes, caused for real", () => {
  const inspections = (sent: string[]) => sent.filter((s) => s.startsWith("SET LOCAL lock_timeout")).length;

  describe("A: the server really rejects COMMIT, and its answer arrives", () => {
    it("a deferred constraint fails inside COMMIT: indeterminate and rolled back, with no inspection, because the server said so", async () => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      let rejection: { code?: string; severity?: string } | undefined;
      const fault = faultOnCommitOfDebit(async (q) => {
        await armRealCommitRejection(q.client);
        return q.proceed().catch((err: { code?: string; severity?: string }) => {
          rejection = err;
          throw err;
        });
      });

      const first = await attempt(u, ref);

      expect(fault.fired).toBe(true);
      expect(rejection).toMatchObject({ code: "23503", severity: "ERROR" });
      expect(first).toMatchObject({ status: "rejected", reason: { statusCode: 409, code: "CAPTURE_INDETERMINATE", details: { commitOutcome: "rolled_back" } } });
      expect(inspections(sent)).toBe(0);
      // The debit before it was really undone: the claim "nothing was charged" holds.
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    });
  });

  describe("B: the connection is lost before COMMIT is sent", () => {
    it("the backend is gone and the client knows it: COMMIT cannot reach any server, so no inspection, and the retry charges once", async () => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      let client!: pg.Client;
      // The capture's last query. Once it answers, the connection dies, and capture then goes on to COMMIT.
      const fault = faultOnce(/SELECT balance FROM user_balances/, async (q) => {
        client = q.client;
        const answer = await q.proceed();
        const ended = new Promise((resolve) => q.client.once("end", resolve));
        await killConnection(db, q.client);
        await ended;
        return answer;
      });

      const first = await attempt(u, ref);

      expect(fault.fired).toBe(true);
      expect(client).toBeDefined();
      expectInfrastructureFailure(first);
      expect(((first as PromiseRejectedResult).reason as Error).message).toMatch(/not queryable/);
      expect(sent).toContain("COMMIT");
      expect(inspections(sent)).toBe(0);
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    });
  });

  describe("C: the connection is lost while COMMIT is in flight", () => {
    it("the backend is terminated inside COMMIT (57P01): the service cannot prove a rollback, so it inspects, finds the hold held, and stays retryable", async () => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      let rejection: { code?: string; severity?: string } | undefined;
      faultOnCommitOfDebit(async (q) => {
        await armSlowCommit(q.client, 30);
        const answer = q.proceed().catch((err: { code?: string; severity?: string }) => {
          rejection = err;
          throw err;
        });
        const [result] = await Promise.allSettled([answer, waitUntilCommitInFlight(db, q.client).then(() => terminateBackend(db, q.client))]);
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });

      const first = await attempt(u, ref);

      expect(rejection).toMatchObject({ code: "57P01", severity: "FATAL" });
      expect(inspections(sent)).toBe(1);
      expectInfrastructureFailure(first);
      expect((first as PromiseRejectedResult).reason).toBe(rejection);
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    }, 40_000);

    it("the socket dies with COMMIT in flight, then the backend dies before its commit point: the same generic error as the next test, and the opposite outcome", async () => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      let killed: Promise<void> = Promise.resolve();
      faultOnCommitOfDebit(async (q) => {
        await armSlowCommit(q.client, 30);
        const answer = q.proceed();
        await waitUntilCommitInFlight(db, q.client);
        destroySocket(q.client);
        // The inspection is waiting for this backend's locks when it dies.
        killed = new Promise((r) => setTimeout(r, 300)).then(() => terminateBackend(db, q.client));
        return answer;
      });

      const first = await attempt(u, ref);
      await killed;

      expect(inspections(sent)).toBe(1);
      expectInfrastructureFailure(first);
      expect(((first as PromiseRejectedResult).reason as { severity?: string }).severity).toBeUndefined();
      await expectUntouched(u, ref);
      await expectRetryChargesOnce(u, ref);
    }, 40_000);

    it("the backend outlasts the inspection's lock timeout: a real 55P03, an explicit indeterminate result, and the later retry reports the charge that landed meanwhile", async () => {
      const { u, ref } = await heldReservation();
      faultOnCommitOfDebit(async (q) => {
        await armSlowCommit(q.client, (CAPTURE_INSPECTION_LOCK_TIMEOUT_MS + 1000) / 1000);
        const answer = q.proceed();
        await waitUntilCommitInFlight(db, q.client);
        destroySocket(q.client);
        return answer;
      });

      const first = await attempt(u, ref);

      expect(first).toMatchObject({ status: "rejected", reason: { statusCode: 503, code: "CAPTURE_INDETERMINATE", details: { commitOutcome: "unknown" } } });
      expect(logs.lines().join("\n")).toMatch(/CAPTURE_AMBIGUOUS_COMMIT.*"resolution":"unresolved".*"sqlstate":"55P03"/);
      // This retry waits for the same locks, with no shorter timeout, and then reads what really happened.
      const retry = await captureOperation(u.id, ref);
      const hold = await expectChargedOnce(u, ref);
      expect(retry).toMatchObject({ captured: true, alreadyProcessed: true, ledgerId: hold.ledger_id });
    }, 30_000);
  });

  describe("D: COMMIT succeeds and its response is lost", () => {
    it("the socket dies with COMMIT in flight and the server finishes it anyway: the inspection waits for the locks and returns the original ledger id", async () => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      let lost: { severity?: string; message?: string } | undefined;
      faultOnCommitOfDebit(async (q) => {
        await armSlowCommit(q.client, 1);
        const answer = q.proceed().catch((err: { severity?: string; message?: string }) => {
          lost = err;
          throw err;
        });
        await waitUntilCommitInFlight(db, q.client);
        destroySocket(q.client);
        return answer;
      });

      const first = await attempt(u, ref);

      // The client saw a generic network error with no server answer...
      expect(lost?.severity).toBeUndefined();
      expect(inspections(sent)).toBe(1);
      // ...and the commit happened all the same. Treating that error as a rollback would have been wrong.
      const hold = await expectChargedOnce(u, ref);
      expect(first).toEqual({
        status: "fulfilled",
        value: { captured: true, amount: 1, balance: START_BALANCE - 1, ledgerId: hold.ledger_id, alreadyProcessed: true },
      });
      await expect(captureOperation(u.id, ref)).resolves.toMatchObject({ alreadyProcessed: true, ledgerId: hold.ledger_id });
      await expectChargedOnce(u, ref);
    }, 30_000);

    it("a terminal settlement whose COMMIT answer is lost: the inspection reports the settled state, nothing is charged, and it is not called indeterminate", async () => {
      const { u, ref } = await heldReservation();
      await db.query(`SELECT post_credit_transaction($1, $2, 'ADMIN_ADJUSTMENT', 'drain')`, [u.id, -START_BALANCE]);
      ambiguousCommit({ landed: true });

      const first = await attempt(u, ref);

      expect(first).toMatchObject({ status: "rejected", reason: { statusCode: 409, code: "NOT_CAPTURABLE", details: { status: "capture_failed" } } });
      expect(await holdOf(u, ref)).toMatchObject({ status: "capture_failed", settle_reason: "insufficient_credits_at_capture", ledger_id: null });
      expect(await debitsOf(u, ref)).toEqual([]);
    });
  });
});

describe("case 5: an unknown error is indeterminate", () => {
  const POINTS: Array<[string, RegExp]> = [
    ["while locking the hold", HOLD_LOCK],
    ["inside the debit", DEBIT],
    ["after the debit, while marking the hold captured", MARK_CAPTURED],
  ];
  const UNKNOWN_SQLSTATES = ["XX000", "55P03", "57014", "42P01"];

  const expectIndeterminate = (result: PromiseSettledResult<CaptureResult>) =>
    expect(result).toMatchObject({ status: "rejected", reason: { statusCode: 409, code: "CAPTURE_INDETERMINATE", details: { commitOutcome: "rolled_back" } } });

  describe.each(UNKNOWN_SQLSTATES)("SQLSTATE %s", (sqlState) => {
    it.each(POINTS)("%s: fully rolled back, not retried, never capture_failed, the hold stays held", async (_name, pattern) => {
      const { u, ref } = await heldReservation();
      const sent = recordStatements();
      const fault = faultOnce(pattern, (q) => q.proceed(sqlStateFault(sqlState)));

      const first = await attempt(u, ref);

      expect(fault.fired).toBe(true);
      expectIndeterminate(first);
      expect(sent.filter((s) => s === "BEGIN")).toHaveLength(1);
      expect(sent.filter((s) => DEBIT.test(s)).length).toBeLessThanOrEqual(1);
      expect(sent).not.toContain("ROLLBACK TO SAVEPOINT capture_debit");
      await expectUntouched(u, ref);
    });
  });

  it("an error with no SQLSTATE at all, inside the debit", async () => {
    const { u, ref } = await heldReservation();
    faultOnce(DEBIT, async () => {
      throw new Error("something unexpected");
    });

    expectIndeterminate(await attempt(u, ref));
    await expectUntouched(u, ref);
  });

  it("classification is not by message: an error that only SAYS 'not queryable', on a healthy client, is not a connection loss", async () => {
    const { u, ref } = await heldReservation();
    faultOnce(MARK_CAPTURED, async () => {
      throw new Error("Client has encountered a connection error and is not queryable");
    });

    expectIndeterminate(await attempt(u, ref));
    await expectUntouched(u, ref);
  });

  it("the hold stays available: released on request, and listed by ledger_reconciliation() if it simply expires", async () => {
    const a = await heldReservation();
    faultOnce(DEBIT, (q) => q.proceed(sqlStateFault("XX000")));
    expectIndeterminate(await attempt(a.u, a.ref));
    await expect(releaseOperation(a.u.id, a.ref, "manual")).resolves.toMatchObject({ refunded: true, outcome: "released" });

    const b = await heldReservation();
    faultOnce(DEBIT, (q) => q.proceed(sqlStateFault("XX000")));
    expectIndeterminate(await attempt(b.u, b.ref));
    await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1`, [b.u.id]);
    await db.query(`SELECT release_expired_ai_holds()`);
    const { rows } = await db.query(`SELECT issue, reference_id FROM ledger_reconciliation() WHERE user_id = $1`, [b.u.id]);
    expect(rows).toEqual([{ issue: "hold_expired_unsettled", reference_id: b.ref }]);
    expect(await debitsOf(b.u, b.ref)).toEqual([]);
  });
});

describe("what the classification logs", () => {
  const MARKER = "SENSITIVE-DB-DETAIL-MARKER";

  it.each([
    ["40P01", "retryable"],
    ["XX000", "indeterminate"],
  ])("%s: one structured line with %s, and no message, SQL or parameters", async (sqlState, bucket) => {
    const { u, ref } = await heldReservation();
    faultOnce(DEBIT, (q) => q.proceed(`DO $$ BEGIN RAISE EXCEPTION '${MARKER}' USING ERRCODE = '${sqlState}', DETAIL = '${MARKER}'; END $$`));

    await attempt(u, ref);

    const lines = logs.lines().filter((l) => l.includes("CAPTURE_ERROR_CLASSIFIED"));
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]!.slice(lines[0]!.indexOf("{"))) as Record<string, unknown>;
    expect(payload).toMatchObject({ event: "CAPTURE_ERROR_CLASSIFIED", operation: "capture", referenceId: ref, sqlstate: sqlState, severity: "ERROR", bucket, connectionLost: false });
    expect(Object.keys(payload).sort()).toEqual(["bucket", "connectionLost", "constraint", "event", "operation", "referenceId", "routine", "severity", "sqlstate"].sort());

    const everything = logs.lines().join("\n");
    expect(everything).not.toContain(MARKER);
    expect(everything).not.toContain("post_credit_transaction");
    expect(everything).not.toContain("RAISE EXCEPTION");
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
