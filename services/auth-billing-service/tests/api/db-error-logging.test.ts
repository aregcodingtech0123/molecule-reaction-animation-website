/**
 * Database errors in logs: allowlisted fields only. A unique marker goes into every free-text field of a database error, and it
 * must not appear anywhere in the console output, while the fields an operator needs must.
 *
 * Output is checked with util.inspect over the raw console arguments, not spyConsole().lines(). That helper uses JSON.stringify,
 * which drops an Error's message and stack, so a raw console.error(err) could pass a line-based check.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool, getPool, isConnectionLossError, verifyDatabaseConnection, withTransaction } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser } from "../support/db";
import { armRealCommitRejection, interceptClientQueries, terminateBackend, type InterceptedQuery } from "../support/pg-fault";
import { CAPABILITY_FIELD } from "../support/settlement";

const MARKER = "SENSITIVE-DB-MARKER-7f3a";
const HOLD_LOCK = /SELECT status, amount, operation_type/;

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

/** Everything that reached the console, with Error objects shown in full (message, stack and every property). */
const everythingLogged = () => inspect([logs.log.mock.calls, logs.warn.mock.calls, logs.error.mock.calls], { depth: 10, breakLength: Infinity, maxStringLength: null, maxArrayLength: null });

/** The structured payload of the first console call whose text includes `label`. */
function payloadOf(label: string): Record<string, unknown> {
  const call = [...logs.warn.mock.calls, ...logs.error.mock.calls].find((args) => typeof args[0] === "string" && args[0].includes(label));
  expect(call, `no log line with "${label}"`).toBeDefined();
  return call![1] as Record<string, unknown>;
}

/** A real server error with the marker in its message, detail and hint. */
const markedRaise = (sqlState: string) => `DO $$ BEGIN RAISE EXCEPTION '${MARKER} in message' USING ERRCODE = '${sqlState}', DETAIL = '${MARKER} in detail', HINT = '${MARKER} in hint'; END $$`;

/** An error object with the marker in every text field a database error can carry. */
function markedError(extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`${MARKER} in message\nsecond ${MARKER} line`), {
    detail: `${MARKER} in detail`,
    hint: `${MARKER} in hint`,
    where: `${MARKER} in where`,
    internalQuery: `SELECT '${MARKER}'`,
    query: `SELECT '${MARKER}'`,
    parameters: [MARKER],
    ...extra,
  });
}

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

async function reservation() {
  const u = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
  const referenceId = randomUUID();
  const res = await request(app)
    .post("/api/billing/consume")
    .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
    .set("Authorization", bearer(u))
    .send({ operationType: "AI_CHAT_QUERY", referenceId });
  expect(res.status).toBe(200);
  return { referenceId, captureToken: res.body.data.captureCapabilityToken as string, refundToken: res.body.data.refundCapabilityToken as string };
}
const settle = (route: "/capture" | "/refund", referenceId: string, token: string) =>
  request(app)
    .post(`/api/billing${route}`)
    .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
    .send({ referenceId, [CAPABILITY_FIELD]: token });

describe("the check itself", () => {
  it("would catch a raw console.error(err): the inspected output shows an Error's message", () => {
    console.error("raw", markedError());
    expect(everythingLogged()).toContain(MARKER);
    expect(logs.lines().join("\n")).toContain(MARKER); // through its enumerable detail, here
    console.error("raw", new Error(MARKER));
    expect(inspect(logs.error.mock.calls.at(-1))).toContain(MARKER);
  });
});

describe("path 1: withTransaction's connection and rollback logging", () => {
  it("a client 'error' event: logged with safe fields only; the transaction's own behaviour is unchanged", async () => {
    const event = markedError({ code: "57P01", severity: "FATAL", routine: "ProcessInterrupts" });

    const value = await withTransaction(async (c) => {
      c.emit("error", event);
      return "committed";
    });

    expect(value).toBe("committed");
    expect(everythingLogged()).not.toContain(MARKER);
    expect(payloadOf("DB ERROR [transaction client]")).toMatchObject({ sqlstate: "57P01", severity: "FATAL", routine: "ProcessInterrupts", errorName: "Error" });
  });

  it("a really terminated backend: the original error reaches the caller intact, marked as a connection loss, and the log stays safe", async () => {
    const [result] = await Promise.allSettled([
      withTransaction(async (c) => {
        const [query] = await Promise.allSettled([c.query(`SELECT pg_sleep(30), '${MARKER}'`), terminateBackend(db, c)]);
        if (query.status === "rejected") throw query.reason;
      }),
    ]);

    const reason = (result as PromiseRejectedResult).reason as Error & { code: string; severity: string };
    expect(reason.code).toBe("57P01");
    expect(reason.severity).toBe("FATAL");
    expect(reason.message).toMatch(/terminating connection/); // the caller still has the full error; only the log does not
    expect(isConnectionLossError(reason)).toBe(true);
    expect(everythingLogged()).not.toContain(MARKER);
    expect(everythingLogged()).not.toContain("terminating connection");
  });

  it("ROLLBACK fails: the caller gets the original error object, the rollback's error is logged safely, and the client is discarded", async () => {
    const original = new Error(`${MARKER} business rule`);
    faultOnce(/^ROLLBACK$/, (q) => q.proceed(markedRaise("XX000")));

    const [result] = await Promise.allSettled([
      withTransaction(async () => {
        throw original;
      }),
    ]);

    expect((result as PromiseRejectedResult).reason).toBe(original);
    expect(payloadOf("DB ERROR [transaction rollback]")).toMatchObject({ sqlstate: "XX000", severity: "ERROR" });
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("the pool's idle-client listener", async () => {
    getPool().emit("error", markedError({ code: "57P01", severity: "FATAL" }), undefined as never);
    expect(payloadOf("DB ERROR [pool idle client]")).toMatchObject({ sqlstate: "57P01" });
    expect(everythingLogged()).not.toContain(MARKER);
    await verifyDatabaseConnection(); // that event marks the database as not ready
  });

  it("a failed connection probe, whose message can name the host and the user: the code and the operator's hint survive, the message does not", async () => {
    const realUrl = process.env.DATABASE_URL!;
    const dead = new URL(realUrl);
    dead.hostname = "127.0.0.1";
    dead.port = "1";
    try {
      await closePool();
      process.env.DATABASE_URL = dead.toString();
      expect(await verifyDatabaseConnection()).toBe(false);
    } finally {
      process.env.DATABASE_URL = realUrl;
    }
    const payload = payloadOf("DB ERROR [verifyDatabaseConnection]");
    expect(payload).toMatchObject({ syscall: "connect", reason: "connect_socket_error" });
    const logged = everythingLogged();
    expect(logged).toContain("Database connection failed");
    expect(logged).toContain("likely cause: PostgreSQL is not running");
    expect(logged).not.toContain("connect ECONNREFUSED");
    await verifyDatabaseConnection();
  }, 30_000);
});

describe("path 2: the 'database unavailable' branch of the error handler", () => {
  it("a real server error with an unavailable SQLSTATE and the marker in its text: 503, safe fields, a reason, no marker", async () => {
    const { referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, (q) => q.proceed(markedRaise("57P03")));

    const res = await settle("/refund", referenceId, refundToken);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("DATABASE_UNAVAILABLE");
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    expect(payloadOf("[db] Request failed: database unavailable")).toEqual({
      event: "DATABASE_UNAVAILABLE",
      reason: "server_unavailable",
      sqlstate: "57P03",
      severity: "ERROR",
      constraint: null,
      routine: "exec_stmt_raise",
      method: "POST",
      path: "/api/billing/refund",
    });
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it.each<[string, string, Record<string, unknown>]>([
    ["timeout exceeded when trying to connect", "pool_connect_timeout", {}],
    ["Connection terminated due to connection timeout", "connection_timeout", {}],
    ["Connection terminated unexpectedly", "connection_terminated", {}],
    [`connect failed ${MARKER}`, "connect_socket_error", { code: "ECONNREFUSED", syscall: "connect" }],
  ])("the pool and socket errors (%s) keep a distinct reason, from a fixed list", async (message, reason, extra) => {
    const { referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, async () => {
      throw Object.assign(new Error(message), extra);
    });

    const res = await settle("/refund", referenceId, refundToken);

    expect(res.status).toBe(503);
    expect(payloadOf("[db] Request failed: database unavailable")).toMatchObject({ reason });
    expect(everythingLogged()).not.toContain(MARKER);
  });
});

describe("the connection-lost branch of the error handler", () => {
  it("a really dead connection and an error with the marker in its text: 503, safe fields, no marker", async () => {
    const { referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, async (q) => {
      const ended = new Promise((resolve) => q.client.once("end", resolve));
      await terminateBackend(db, q.client);
      await ended;
      throw markedError();
    });

    const res = await settle("/refund", referenceId, refundToken);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("DATABASE_UNAVAILABLE");
    expect(payloadOf("[db] Request failed: connection lost during a transaction")).toEqual({
      event: "DATABASE_CONNECTION_LOST",
      sqlstate: null,
      severity: null,
      constraint: null,
      routine: null,
      method: "POST",
      path: "/api/billing/refund",
    });
    expect(everythingLogged()).not.toContain(MARKER);
  });
});

describe("path 3: the generic 500", () => {
  it("a real server error with the marker in its text: 500, SQLSTATE and routine logged, no marker and no stack", async () => {
    const { referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, (q) => q.proceed(markedRaise("XX000")));

    const res = await settle("/refund", referenceId, refundToken);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Internal server error.", code: "INTERNAL_ERROR" });
    const payload = payloadOf("[auth-billing-service] Unhandled error");
    expect(payload).toMatchObject({ event: "UNHANDLED_ERROR", sqlstate: "XX000", severity: "ERROR", routine: "exec_stmt_raise", method: "POST", path: "/api/billing/refund" });
    expect(payload).not.toHaveProperty("stack");
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("a real COMMIT rejection, whose DETAIL quotes the row's data: not in the log", async () => {
    const { referenceId, refundToken } = await reservation();
    let fired = false;
    restores.push(
      interceptClientQueries((q) => {
        if (fired || q.sql !== "COMMIT") return null;
        fired = true;
        return (async () => {
          await armRealCommitRejection(q.client, MARKER);
          return q.proceed().catch((err: { detail?: string }) => {
            expect(err.detail).toContain(MARKER); // the real error really does carry it
            throw err;
          });
        })();
      }),
    );

    const res = await settle("/refund", referenceId, refundToken);

    expect(res.status).toBe(500);
    expect(payloadOf("[auth-billing-service] Unhandled error")).toMatchObject({ sqlstate: "23503", constraint: "commit_fault_parent_fkey" });
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("the same real COMMIT rejection on capture: classified, with the constraint name and no data", async () => {
    const { referenceId, captureToken } = await reservation();
    let debitClient: pg.Client | null = null;
    let fired = false;
    restores.push(
      interceptClientQueries((q) => {
        if (/post_credit_transaction/.test(q.sql)) debitClient = q.client;
        if (fired || q.sql !== "COMMIT" || q.client !== debitClient) return null;
        fired = true;
        return armRealCommitRejection(q.client, MARKER).then(() => q.proceed());
      }),
    );

    const res = await settle("/capture", referenceId, captureToken);

    expect(res.status).toBe(409);
    expect(payloadOf("[credits] CAPTURE_ERROR_CLASSIFIED")).toMatchObject({ sqlstate: "23503", constraint: "commit_fault_parent_fkey", bucket: "indeterminate" });
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("a bug, not a database error: the frames that locate it are kept, the message is not, even when it spans lines or imitates a frame", async () => {
    const { referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, async () => {
      throw new TypeError(`${MARKER} first line\n    at ${MARKER} (fake.ts:1:1)`);
    });

    const res = await settle("/refund", referenceId, refundToken);

    expect(res.status).toBe(500);
    const payload = payloadOf("[auth-billing-service] Unhandled error");
    expect(payload).toMatchObject({ event: "UNHANDLED_ERROR", errorName: "TypeError", sqlstate: null });
    expect((payload.stack as string[]).length).toBeGreaterThan(0);
    expect((payload.stack as string[]).every((frame) => frame.trimStart().startsWith("at "))).toBe(true);
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("something thrown that is not an Error: nothing of its content is logged", async () => {
    const { referenceId, refundToken } = await reservation();
    faultOnce(HOLD_LOCK, async () => {
      throw `${MARKER} a thrown string`;
    });

    const res = await settle("/refund", referenceId, refundToken);

    expect(res.status).toBe(500);
    expect(payloadOf("[auth-billing-service] Unhandled error")).toMatchObject({ errorName: "string" });
    expect(everythingLogged()).not.toContain(MARKER);
  });
});

describe("nothing else leaks with them", () => {
  it("across all three paths: no capability token, JWT, internal key or secret", async () => {
    const { referenceId, refundToken } = await reservation();
    for (const sqlState of ["57P03", "XX000", "40P01"]) {
      faultOnce(HOLD_LOCK, (q) => q.proceed(markedRaise(sqlState)));
      await settle("/refund", referenceId, refundToken);
      for (const restore of restores.reverse()) restore();
      restores = [];
    }
    const logged = everythingLogged();
    for (const secret of [refundToken, ...refundToken.split(".").slice(1), TEST_ENV.SETTLEMENT_CAPABILITY_SECRET, TEST_ENV.INTERNAL_SERVICE_SECRET, TEST_ENV.JWT_SECRET, MARKER]) {
      expect(logged).not.toContain(secret);
    }
  });
});
