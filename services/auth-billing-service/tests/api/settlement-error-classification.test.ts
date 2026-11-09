/**
 * Phase 2C step 3 over HTTP: how each class of database failure reaches the caller of /capture and /refund, using the real
 * routes, capabilities and database. A status of 5xx or 429 is what the BFF retries, so the status here IS the retry policy.
 * How a loss is produced is stated per test; the classification itself is covered in tests/db/capture-transient-failure.test.ts.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool, verifyDatabaseConnection } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf } from "../support/db";
import { armRealCommitRejection, armSlowCommit, destroySocket, interceptClientQueries, killConnection, sqlStateFault, waitUntilCommitInFlight, type InterceptedQuery } from "../support/pg-fault";
import { CAPABILITY_FIELD, mintForRow } from "../support/settlement";

const DEBIT = /post_credit_transaction/;
const HOLD_LOCK = /SELECT status, amount, operation_type/;
const MARKER = "SENSITIVE-DB-DETAIL-MARKER";

const app = createApp();
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
  for (const restore of restores.reverse()) restore();
  restores = [];
});

type U = { id: string; email: string };

async function reservation() {
  const u: U = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
  const referenceId = randomUUID();
  const res = await internal("/consume", { operationType: "AI_CHAT_QUERY", referenceId }).set("Authorization", bearer(u));
  expect(res.status).toBe(200);
  return { u, referenceId, captureToken: res.body.data.captureCapabilityToken as string, refundToken: res.body.data.refundCapabilityToken as string };
}

function internal(path: string, body: Record<string, unknown>) {
  return request(app).post(`/api/billing${path}`).set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET).send(body);
}
const capture = (referenceId: string, token: string) => internal("/capture", { referenceId, [CAPABILITY_FIELD]: token });
const refund = (referenceId: string, token: string) => internal("/refund", { referenceId, [CAPABILITY_FIELD]: token });

const holdOf = async (u: U, referenceId: string) =>
  (await db.query(`SELECT status, ledger_id::text, settled_at, settle_reason FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`, [u.id, referenceId])).rows[0];
const debits = async (u: U, referenceId: string) =>
  (await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION" && r.reference_id === referenceId);

function faultOnce(pattern: RegExp, action: (q: InterceptedQuery) => Promise<unknown>) {
  let fired = false;
  restores.push(
    interceptClientQueries((q) => {
      if (fired || !pattern.test(q.sql)) return null;
      fired = true;
      return action(q);
    }),
  );
}

/** An ambiguous COMMIT. `landed`: it really commits, and the loss of its answer is simulated. Otherwise: the backend is really terminated first. */
function ambiguousCommit(opts: { landed: boolean; failInspection?: boolean }) {
  let debitClient: pg.Client | null = null;
  let fired = false;
  let inspected = false;
  restores.push(
    interceptClientQueries((q) => {
      if (DEBIT.test(q.sql)) debitClient = q.client;
      if (!fired && q.sql === "COMMIT" && q.client === debitClient) {
        fired = true;
        return (async () => {
          if (opts.landed) {
            await q.proceed();
            throw new Error("Connection terminated unexpectedly");
          }
          await killConnection(db, q.client);
          return q.proceed();
        })();
      }
      if (fired && !inspected && opts.failInspection && HOLD_LOCK.test(q.sql)) {
        inspected = true;
        return q.proceed(sqlStateFault("XX000"));
      }
      return null;
    }),
  );
}

describe("/capture: a retryable SQLSTATE", () => {
  it.each(["40P01", "40001"])("%s before the debit: 503 with Retry-After, nothing charged, and the same token then charges once", async (sqlState) => {
    const { u, referenceId, captureToken } = await reservation();
    faultOnce(HOLD_LOCK, (q) => q.proceed(sqlStateFault(sqlState)));

    const res = await capture(referenceId, captureToken);

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.body).toEqual({ success: false, error: "The database is temporarily busy.", code: "TRANSIENT_DATABASE_ERROR" });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held", ledger_id: null, settled_at: null });

    const retry = await capture(referenceId, captureToken);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({ captured: true, alreadyProcessed: false });
    expect(await debits(u, referenceId)).toHaveLength(1);
    expect(await balanceOf(db, u.id)).toBe(9);
  });

  it.each(["40P01", "40001"])("%s inside the debit: 503, never CAPTURE_FAILED, the hold stays held, and the same token then charges once", async (sqlState) => {
    const { u, referenceId, captureToken } = await reservation();
    faultOnce(DEBIT, (q) => q.proceed(sqlStateFault(sqlState)));

    const res = await capture(referenceId, captureToken);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("TRANSIENT_DATABASE_ERROR");
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held", settle_reason: null });
    expect(await debits(u, referenceId)).toEqual([]);

    expect((await capture(referenceId, captureToken)).status).toBe(200);
    expect(await debits(u, referenceId)).toHaveLength(1);
  });
});

describe("/capture: an unknown error", () => {
  it("409 CAPTURE_INDETERMINATE: not retried by the BFF, nothing charged, the hold stays held", async () => {
    const { u, referenceId, captureToken } = await reservation();
    faultOnce(DEBIT, (q) => q.proceed(sqlStateFault("XX000")));

    const res = await capture(referenceId, captureToken);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: "Capture could not be confirmed; nothing was charged.", code: "CAPTURE_INDETERMINATE", commitOutcome: "rolled_back" });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held", settle_reason: null });
    expect(await debits(u, referenceId)).toEqual([]);
  });
});

describe("/capture: an ambiguous COMMIT", () => {
  it("it landed (simulated loss, real commit): 200 with the original ledger id, marked as already processed", async () => {
    const { u, referenceId, captureToken } = await reservation();
    ambiguousCommit({ landed: true });

    const res = await capture(referenceId, captureToken);

    const hold = await holdOf(u, referenceId);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ captured: true, amount: 1, balance: 9, ledgerId: hold.ledger_id, alreadyProcessed: true });
    expect(await debits(u, referenceId)).toHaveLength(1);
  });

  it("it did not land (real terminated backend): 503 DATABASE_UNAVAILABLE, nothing charged, and the same token then charges once", async () => {
    const { u, referenceId, captureToken } = await reservation();
    ambiguousCommit({ landed: false });

    const res = await capture(referenceId, captureToken);

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.body).toEqual({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" });
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });

    expect((await capture(referenceId, captureToken)).status).toBe(200);
    expect(await debits(u, referenceId)).toHaveLength(1);
  });

  it("it cannot be established: 503 CAPTURE_INDETERMINATE, which the BFF does retry, and the retry reports the truth with no second debit", async () => {
    const { u, referenceId, captureToken } = await reservation();
    ambiguousCommit({ landed: true, failInspection: true });

    const res = await capture(referenceId, captureToken);

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.body).toEqual({ success: false, error: "The capture outcome could not be confirmed.", code: "CAPTURE_INDETERMINATE", commitOutcome: "unknown" });

    const hold = await holdOf(u, referenceId);
    const retry = await capture(referenceId, captureToken);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({ alreadyProcessed: true, ledgerId: hold.ledger_id });
    expect(await debits(u, referenceId)).toHaveLength(1);
  });
});

/**
 * The contract Step 5 consumes. Each case pins the status, the whole body, Retry-After and the database state, then what a later
 * attempt does. Where the COMMIT is involved it is a real one (see pg-fault.ts). The BFF retries on status >= 500 or 429.
 */
describe("the Step 5 response contract and retry eligibility", () => {
  /** On the debit transaction's COMMIT, run `action`. */
  function onCommitOfDebit(action: (q: InterceptedQuery) => Promise<unknown>) {
    let debitClient: pg.Client | null = null;
    let fired = false;
    restores.push(
      interceptClientQueries((q) => {
        if (DEBIT.test(q.sql)) debitClient = q.client;
        if (fired || q.sql !== "COMMIT" || q.client !== debitClient) return null;
        fired = true;
        return action(q);
      }),
    );
  }
  const realRejection = () =>
    onCommitOfDebit(async (q) => {
      await armRealCommitRejection(q.client);
      return q.proceed();
    });
  /** The socket dies with COMMIT in flight, and the server finishes it after `seconds`. */
  const realLostAnswer = (seconds: number) =>
    onCommitOfDebit(async (q) => {
      await armSlowCommit(q.client, seconds);
      const answer = q.proceed();
      await waitUntilCommitInFlight(db, q.client);
      destroySocket(q.client);
      return answer;
    });

  describe("200, capture confirmed", () => {
    it("first capture: alreadyProcessed false, no Retry-After, and a repeat returns the same ledger id", async () => {
      const { u, referenceId, captureToken, refundToken } = await reservation();

      const res = await capture(referenceId, captureToken);

      const hold = await holdOf(u, referenceId);
      expect(res.status).toBe(200);
      expect(res.headers["retry-after"]).toBeUndefined();
      expect(res.body).toEqual({ success: true, data: { captured: true, amount: 1, balance: 9, ledgerId: hold.ledger_id, alreadyProcessed: false } });

      const repeat = await capture(referenceId, captureToken);
      expect(repeat.status).toBe(200);
      expect(repeat.body).toEqual({ success: true, data: { captured: true, amount: 1, balance: 9, ledgerId: hold.ledger_id, alreadyProcessed: true } });
      expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: false, outcome: "already_captured" });
      expect(await debits(u, referenceId)).toHaveLength(1);
    });

    it("after a really lost COMMIT answer: alreadyProcessed true, the original ledger id, and no second debit", async () => {
      const { u, referenceId, captureToken } = await reservation();
      realLostAnswer(1);

      const res = await capture(referenceId, captureToken);

      const hold = await holdOf(u, referenceId);
      expect(hold.status).toBe("captured");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { captured: true, amount: 1, balance: 9, ledgerId: hold.ledger_id, alreadyProcessed: true } });
      expect(await debits(u, referenceId)).toHaveLength(1);
    }, 30_000);
  });

  describe("409 CAPTURE_INDETERMINATE, commitOutcome rolled_back", () => {
    it("a real COMMIT rejection: the exact body, no Retry-After, and the hold stays held", async () => {
      const { u, referenceId, captureToken } = await reservation();
      realRejection();

      const res = await capture(referenceId, captureToken);

      expect(res.status).toBe(409);
      expect(res.headers["retry-after"]).toBeUndefined();
      expect(res.body).toEqual({ success: false, error: "Capture could not be confirmed; nothing was charged.", code: "CAPTURE_INDETERMINATE", commitOutcome: "rolled_back" });
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "held", ledger_id: null, settled_at: null, settle_reason: null });
      expect(await debits(u, referenceId)).toEqual([]);
    });

    it("the hold stays settleable: the service would accept a later capture, charging once, though the BFF must not retry this", async () => {
      const { u, referenceId, captureToken } = await reservation();
      realRejection();
      expect((await capture(referenceId, captureToken)).status).toBe(409);

      const later = await capture(referenceId, captureToken);

      expect(later.status).toBe(200);
      expect(later.body.data).toMatchObject({ captured: true, alreadyProcessed: false });
      expect(await debits(u, referenceId)).toHaveLength(1);
    });

    it("the hold stays settleable: a refund releases it", async () => {
      const { referenceId, captureToken, refundToken } = await reservation();
      realRejection();
      expect((await capture(referenceId, captureToken)).status).toBe(409);
      expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: true, outcome: "released" });
    });
  });

  describe("503 CAPTURE_INDETERMINATE, commitOutcome unknown", () => {
    it("the COMMIT landed: the exact body with Retry-After; the hold reads captured; a retry returns the original ledger id; a refund says already_captured", async () => {
      const { u, referenceId, captureToken, refundToken } = await reservation();
      ambiguousCommit({ landed: true, failInspection: true });

      const res = await capture(referenceId, captureToken);

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.body).toEqual({ success: false, error: "The capture outcome could not be confirmed.", code: "CAPTURE_INDETERMINATE", commitOutcome: "unknown" });
      const hold = await holdOf(u, referenceId);
      expect(hold.status).toBe("captured");
      expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: false, outcome: "already_captured" });
      expect((await capture(referenceId, captureToken)).body.data).toMatchObject({ alreadyProcessed: true, ledgerId: hold.ledger_id });
      expect(await debits(u, referenceId)).toHaveLength(1);
    });

    it("the COMMIT did not land: the same response; the hold stays held; a retry charges once", async () => {
      const { u, referenceId, captureToken } = await reservation();
      ambiguousCommit({ landed: false, failInspection: true });

      const res = await capture(referenceId, captureToken);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("CAPTURE_INDETERMINATE");
      expect(res.body.commitOutcome).toBe("unknown");
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
      expect((await capture(referenceId, captureToken)).body.data).toMatchObject({ captured: true, alreadyProcessed: false });
      expect(await debits(u, referenceId)).toHaveLength(1);
    });

    it("the COMMIT did not land: a refund as the probe releases the hold and a later capture is refused, so it cannot be both", async () => {
      const { u, referenceId, captureToken, refundToken } = await reservation();
      ambiguousCommit({ landed: false, failInspection: true });
      expect((await capture(referenceId, captureToken)).status).toBe(503);

      expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: true, outcome: "released" });
      expect((await capture(referenceId, captureToken)).status).toBe(409);
      expect(await debits(u, referenceId)).toEqual([]);
    });
  });

  describe("503 TRANSIENT_DATABASE_ERROR", () => {
    it("the exact body with Retry-After; the hold stays held; a refund would release it", async () => {
      const { u, referenceId, captureToken, refundToken } = await reservation();
      faultOnce(DEBIT, (q) => q.proceed(sqlStateFault("40P01")));

      const res = await capture(referenceId, captureToken);

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.body).toEqual({ success: false, error: "The database is temporarily busy.", code: "TRANSIENT_DATABASE_ERROR" });
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "held", ledger_id: null, settled_at: null });
      expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: true, outcome: "released" });
    });

    it("if the hold expires between attempts, the retry is refused with HOLD_EXPIRED and nothing is charged: a retry never extends the expiry", async () => {
      const { u, referenceId, captureToken } = await reservation();
      faultOnce(DEBIT, (q) => q.proceed(sqlStateFault("40001")));
      expect((await capture(referenceId, captureToken)).status).toBe(503);

      await db.query(`UPDATE ai_credit_holds SET created_at = NOW() - interval '1 hour', expires_at = NOW() - interval '1 second' WHERE user_id = $1 AND reference_id = $2`, [u.id, referenceId]);
      const res = await capture(referenceId, await mintForRow(db, "capture", u.id, referenceId));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("HOLD_EXPIRED");
      expect(await debits(u, referenceId)).toEqual([]);
    });
  });

  describe("503 DATABASE_UNAVAILABLE", () => {
    it("connection lost: the exact body with Retry-After; the hold stays held; a refund would release it", async () => {
      const { u, referenceId, captureToken, refundToken } = await reservation();
      ambiguousCommit({ landed: false });

      const res = await capture(referenceId, captureToken);

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.body).toEqual({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" });
      expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
      expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: true, outcome: "released" });
    });

    it("the same code from requireDatabase, when the service already knows the database is down: the same body, but NO Retry-After, and no raw error logged", async () => {
      const { referenceId, captureToken } = await reservation();
      const realUrl = process.env.DATABASE_URL!;
      const dead = new URL(realUrl);
      dead.port = "1"; // nothing listens there
      try {
        await closePool();
        process.env.DATABASE_URL = dead.toString();

        const res = await capture(referenceId, captureToken);

        expect(res.status).toBe(503);
        expect(res.headers["retry-after"]).toBeUndefined();
        expect(res.body).toEqual({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" });
      } finally {
        process.env.DATABASE_URL = realUrl;
        await verifyDatabaseConnection();
      }
      expect(inspect(logs.error.mock.calls, { depth: 8 }) + inspect(logs.warn.mock.calls, { depth: 8 })).not.toMatch(/connect ECONNREFUSED|127\.0\.0\.1:1\b/);
      expect((await capture(referenceId, captureToken)).status).toBe(200);
    }, 30_000);
  });
});

describe("the same error handling on the other routes", () => {
  it.each(["40P01", "40001"])("/consume with %s: 503, and nothing reserved", async (sqlState) => {
    const u: U = await createUser(db, { balance: 0, verified: true });
    await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    const referenceId = randomUUID();
    faultOnce(HOLD_LOCK, (q) => q.proceed(sqlStateFault(sqlState)));
    const res = await internal("/consume", { operationType: "AI_CHAT_QUERY", referenceId }).set("Authorization", bearer(u));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("TRANSIENT_DATABASE_ERROR");
    expect(await holdOf(u, referenceId)).toBeUndefined();
  });

  it.each(["40P01", "40001"])("/refund with %s: 503, the hold stays held, and the same token then releases", async (sqlState) => {
    const { u, referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, (q) => q.proceed(sqlStateFault(sqlState)));
    const res = await refund(referenceId, refundToken);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("TRANSIENT_DATABASE_ERROR");
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
    expect((await refund(referenceId, refundToken)).body.data).toMatchObject({ refunded: true, outcome: "released" });
  });

  it("/refund on a connection really lost (not queryable, no SQLSTATE): 503 by client state, where it used to be a 500", async () => {
    const { u, referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, async (q) => {
      await killConnection(db, q.client);
      return q.proceed();
    });
    const res = await refund(referenceId, refundToken);
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.body.code).toBe("DATABASE_UNAVAILABLE");
    expect(await holdOf(u, referenceId)).toMatchObject({ status: "held" });
  });

  it("no message matching: an error that only SAYS 'not queryable', on a healthy connection, stays a generic 500", async () => {
    const { referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, async () => {
      throw new Error("Client has encountered a connection error and is not queryable");
    });
    const res = await refund(referenceId, refundToken);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Internal server error.", code: "INTERNAL_ERROR" });
  });
});

describe("nothing sensitive in responses or classification logs", () => {
  it.each(["40P01", "XX000"])("%s: no database message, SQL text, parameter, token or secret", async (sqlState) => {
    const { referenceId, captureToken } = await reservation();
    faultOnce(DEBIT, (q) => q.proceed(`DO $$ BEGIN RAISE EXCEPTION '${MARKER}' USING ERRCODE = '${sqlState}', DETAIL = '${MARKER}'; END $$`));

    const res = await capture(referenceId, captureToken);

    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    const logged = logs.lines().join("\n");
    expect(logged).toContain("CAPTURE_ERROR_CLASSIFIED");
    for (const forbidden of [MARKER, captureToken, TEST_ENV.SETTLEMENT_CAPABILITY_SECRET, TEST_ENV.INTERNAL_SERVICE_SECRET, TEST_ENV.JWT_SECRET, "post_credit_transaction", "RAISE EXCEPTION"]) {
      expect(logged).not.toContain(forbidden);
    }
  });

  it("the transient-error handler logs a fixed set of fields, including on routes without their own classification", async () => {
    const { referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, (q) => q.proceed(`DO $$ BEGIN RAISE EXCEPTION '${MARKER}' USING ERRCODE = '40P01', DETAIL = '${MARKER}'; END $$`));

    await refund(referenceId, refundToken);

    const line = logs.lines().find((l) => l.includes("TRANSIENT_DATABASE_ERROR"));
    expect(line).toBeDefined();
    const payload = JSON.parse(line!.slice(line!.indexOf("{"))) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["constraint", "event", "method", "path", "routine", "severity", "sqlstate"]);
    expect(payload).toMatchObject({ event: "TRANSIENT_DATABASE_ERROR", sqlstate: "40P01", severity: "ERROR", method: "POST", path: "/api/billing/refund" });
    expect(logs.lines().join("\n")).not.toContain(MARKER);
  });

  it("an ambiguous COMMIT logs its resolution with no token and no error message", async () => {
    const { referenceId, captureToken } = await reservation();
    ambiguousCommit({ landed: true });

    await capture(referenceId, captureToken);

    const logged = logs.lines().join("\n");
    expect(logged).toMatch(/CAPTURE_AMBIGUOUS_COMMIT.*"resolution":"committed"/);
    expect(logged).not.toContain(captureToken);
    expect(logged).not.toContain("Connection terminated unexpectedly");
  });
});
