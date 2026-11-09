/**
 * withTransaction when the connection dies (Phase 2B.2). Real pool, real transactions, real terminated backends.
 *
 * pg-pool drops its idle 'error' listener while a client is checked out. Without one of its own, a dead connection
 * would be an uncaught exception, so these tests must never add a listener to a client themselves.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool, isAmbiguousCommitError, isConnectionLossError, withTransaction, type PoolClient } from "../../src/db/index.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser, uniqueEmail } from "../support/db";
import {
  armRealCommitRejection,
  armSlowCommit,
  backendPid,
  destroySocket,
  interceptClientQueries,
  sqlStateFault,
  terminateBackend,
  waitUntilCommitInFlight,
} from "../support/pg-fault";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let db: pg.Pool;
let logs: ConsoleSpies;
let cleanups: Array<() => void> = [];
let uncaught: unknown[];
let releases: Array<{ err: unknown; client: unknown }>;
/** Every promise-style statement the service sent, per client. */
let statements: Array<{ sql: string; client: unknown }>;

beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await closePool();
});
beforeEach(() => {
  logs = spyConsole();
  uncaught = [];
  releases = [];
  statements = [];

  const onUncaught = (err: unknown) => uncaught.push(err);
  process.on("uncaughtException", onUncaught);
  const onRelease = (err: unknown, client: unknown) => releases.push({ err, client });
  getPool().on("release", onRelease);
  cleanups = [
    () => process.removeListener("uncaughtException", onUncaught),
    () => getPool().removeListener("release", onRelease),
    interceptClientQueries((q) => {
      statements.push({ sql: q.sql, client: q.client });
      return null;
    }),
  ];
});
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
});

const rowExists = async (email: string) => (await db.query(`SELECT 1 FROM users WHERE email = $1`, [email])).rows.length === 1;
const endOf = (client: PoolClient) => new Promise((resolve) => client.once("end", resolve));
const sentBy = (client: unknown) => statements.filter((s) => s.client === client).map((s) => s.sql);

/** After a healthy transaction: the same connection goes back to the pool and serves the next one. */
async function expectClientReused(client: PoolClient) {
  expect(releases).toEqual([{ err: undefined, client }]);
  const next = await withTransaction(async (c) => backendPid(c));
  expect(next).toBe(backendPid(client));
}

describe("the checked-out client has an effective error handler", () => {
  it("a listener exists during the transaction and is gone after it: reusing a client leaks nothing", async () => {
    const seen = new Set<PoolClient>();
    const during: number[] = [];
    for (let i = 0; i < 5; i++) {
      await withTransaction(async (c) => {
        seen.add(c);
        during.push(c.listenerCount("error"));
      });
    }

    expect(seen.size).toBe(1);
    expect(during).toEqual([1, 1, 1, 1, 1]);
    // Back in the pool: only pg-pool's own idle listener.
    expect([...seen][0]!.listenerCount("error")).toBe(1);
  });

  it("an 'error' event does not become an uncaught exception, is logged, and the client is discarded", async () => {
    const event = new Error("synthetic client error");
    let client!: PoolClient;

    const value = await withTransaction(async (c) => {
      client = c;
      expect(c.emit("error", event)).toBe(true);
      c.emit("error", new Error("a dead connection can emit twice"));
      return "committed";
    });

    // The socket is really fine here, so COMMIT really succeeded: reporting success is correct.
    expect(value).toBe("committed");
    expect(uncaught).toEqual([]);
    expect(releases).toEqual([{ err: event, client }]);
    // Logged once, for the first event: the second is the same failure. The message itself is never logged.
    expect(logs.lines().filter((l) => l.includes("DB ERROR [transaction client]"))).toHaveLength(1);
    expect(logs.lines().join("\n")).not.toContain("synthetic client error");
    expect(await withTransaction(async (c) => backendPid(c))).not.toBe(backendPid(client));
  });
});

describe("the backend is terminated during a transaction", () => {
  const SCENARIOS: Array<[string, (c: PoolClient) => Promise<unknown>, RegExp | { code: string }]> = [
    [
      "during an active query",
      async (c) => {
        const sleeping = c.query(`SELECT pg_sleep(30)`);
        const [query] = await Promise.allSettled([sleeping, terminateBackend(db, c)]);
        if (query.status === "rejected") throw query.reason;
        return "committed";
      },
      { code: "57P01" },
    ],
    [
      "between queries",
      async (c) => {
        const ended = endOf(c);
        await terminateBackend(db, c);
        await ended;
        await c.query(`SELECT 1`);
        return "committed";
      },
      /not queryable/,
    ],
    [
      "after the work is done, before COMMIT",
      async (c) => {
        const ended = endOf(c);
        await terminateBackend(db, c);
        await ended;
        return "committed";
      },
      /not queryable/,
    ],
  ];

  it.each(SCENARIOS)("%s: fails, commits nothing, stays alive, and never reuses the client", async (_name, afterInsert, expected) => {
    const email = uniqueEmail();
    let client!: PoolClient;
    let ended!: Promise<unknown>;

    const [result] = await Promise.allSettled([
      withTransaction(async (c) => {
        client = c;
        ended = endOf(c);
        await createUser(c, { email });
        return afterInsert(c);
      }),
    ]);
    await ended;

    // The caller is told, with the error that actually happened.
    expect(result.status).toBe("rejected");
    const reason = (result as PromiseRejectedResult).reason as Error & { code?: string };
    if (expected instanceof RegExp) expect(reason.message).toMatch(expected);
    else expect(reason.code).toBe(expected.code);

    // Nothing committed, and the process is still here.
    expect(await rowExists(email)).toBe(false);
    expect(uncaught).toEqual([]);

    // Cleanup: no statement on a connection known to be gone, one release, and that release discards the client.
    expect(sentBy(client)).not.toContain("ROLLBACK");
    expect(releases).toHaveLength(1);
    expect(releases[0]!.client).toBe(client);
    expect(releases[0]!.err).toBeInstanceOf(Error);

    // The next independent transaction works, on another connection.
    const nextEmail = uniqueEmail();
    const nextPid = await withTransaction(async (c) => {
      await createUser(c, { email: nextEmail });
      return backendPid(c);
    });
    expect(nextPid).not.toBe(backendPid(client));
    expect(await rowExists(nextEmail)).toBe(true);
  });

  it("a transaction running alongside on another connection is unaffected", async () => {
    const survivorEmail = uniqueEmail();
    const victimEmail = uniqueEmail();
    let finishSurvivor!: () => void;
    const gate = new Promise<void>((resolve) => (finishSurvivor = resolve));

    const survivor = withTransaction(async (c) => {
      await createUser(c, { email: survivorEmail });
      await gate;
      return "survivor committed";
    });
    const [victim] = await Promise.allSettled([
      withTransaction(async (c) => {
        await createUser(c, { email: victimEmail });
        const ended = endOf(c);
        await terminateBackend(db, c);
        await ended;
      }),
    ]);
    finishSurvivor();

    expect(victim.status).toBe("rejected");
    await expect(survivor).resolves.toBe("survivor committed");
    expect(await rowExists(survivorEmail)).toBe(true);
    expect(await rowExists(victimEmail)).toBe(false);
    expect(uncaught).toEqual([]);
  });

  /** No test runner around it: an unhandled 'error' event really does end this process. */
  function runChild(scenario: string) {
    const noDotenv = pathToFileURL(path.join(serviceRoot, "../../scripts/test/no-dotenv.mjs")).href;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--import", noDotenv, path.join(serviceRoot, "tests/support/with-transaction-child.ts"), scenario],
      {
        cwd: serviceRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "",
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          NODE_ENV: "test",
          DATABASE_URL: process.env.DATABASE_URL ?? "",
        },
      },
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    return new Promise<{ code: number | null; output: string }>((resolve) => child.on("exit", (code) => resolve({ code, output })));
  }

  it.each(["active-query", "between-queries"])("a real Node process survives (%s): exit code 0, caller told, next transaction works", async (scenario) => {
    const { code, output } = await runChild(scenario);

    expect(output).not.toContain("Unhandled 'error' event");
    expect(code, output).toBe(0);
    const line = output.split(/\r?\n/).find((l) => l.startsWith("RESULT:"));
    expect(JSON.parse(line!.slice("RESULT:".length))).toMatchObject({
      outcome: { settled: "rejected" },
      nextOk: 1,
      reusedDeadClient: false,
    });
  }, 60_000);
});

describe("behaviour that must not change", () => {
  it("success: commits, returns the result, and the client goes back to the pool", async () => {
    const email = uniqueEmail();
    let client!: PoolClient;

    const value = await withTransaction(async (c) => {
      client = c;
      await createUser(c, { email });
      return "result";
    });

    expect(value).toBe("result");
    expect(await rowExists(email)).toBe(true);
    expect(sentBy(client).filter((s) => s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK")).toEqual(["BEGIN", "COMMIT"]);
    await expectClientReused(client);
  });

  it("the callback throws: rolled back, the same error object reaches the caller, and the client goes back to the pool", async () => {
    const email = uniqueEmail();
    const failure = new Error("business rule");
    let client!: PoolClient;

    const [result] = await Promise.allSettled([
      withTransaction(async (c) => {
        client = c;
        await createUser(c, { email });
        throw failure;
      }),
    ]);

    expect((result as PromiseRejectedResult).reason).toBe(failure);
    expect(await rowExists(email)).toBe(false);
    expect(sentBy(client)).toContain("ROLLBACK");
    await expectClientReused(client);
  });

  it("a SQL error in the callback: rolled back, its SQLSTATE reaches the caller, and the client goes back to the pool", async () => {
    let client!: PoolClient;

    const [result] = await Promise.allSettled([
      withTransaction(async (c) => {
        client = c;
        await c.query(`SELECT * FROM table_that_does_not_exist`);
      }),
    ]);

    expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "42P01" });
    expect(sentBy(client)).toContain("ROLLBACK");
    await expectClientReused(client);
  });

  // A failing statement is sent in COMMIT's place, so this is not a real COMMIT rejection. The real one is tested further down.
  it("a server error in the COMMIT phase on a live connection (simulated): failure propagated, rolled back, nothing committed, client reused", async () => {
    const email = uniqueEmail();
    let client!: PoolClient;
    let armed = true;
    cleanups.push(
      interceptClientQueries((q) => {
        if (!armed || q.sql !== "COMMIT") return null;
        armed = false;
        return q.proceed(sqlStateFault("40001"));
      }),
    );

    const [result] = await Promise.allSettled([
      withTransaction(async (c) => {
        client = c;
        await createUser(c, { email });
      }),
    ]);

    expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "40001" });
    expect(await rowExists(email)).toBe(false);
    expect(sentBy(client)).toContain("ROLLBACK");
    await expectClientReused(client);
  });
});

describe("what the caller can learn about a failed transaction, from client state and never from message text", () => {
  /** Run a transaction that does `body` and return the rejection, which must be the very object the failing statement rejected with. */
  async function rejectionOf(body: (c: PoolClient) => Promise<unknown>) {
    const [result] = await Promise.allSettled([withTransaction(body)]);
    expect(result.status).toBe("rejected");
    return (result as PromiseRejectedResult).reason as Error & { code?: string };
  }

  it("the backend terminated during a query (57P01): connection lost, and not ambiguous, because no COMMIT was sent", async () => {
    const reason = await rejectionOf(async (c) => {
      const [query] = await Promise.allSettled([c.query(`SELECT pg_sleep(30)`), terminateBackend(db, c)]);
      if (query.status === "rejected") throw query.reason;
    });
    expect(reason.code).toBe("57P01");
    expect(isConnectionLossError(reason)).toBe(true);
    expect(isAmbiguousCommitError(reason)).toBe(false);
  });

  it("a follow-up 'not queryable' error on a connection known to be dead: connection lost, though it has no SQLSTATE", async () => {
    const reason = await rejectionOf(async (c) => {
      const ended = endOf(c);
      await terminateBackend(db, c);
      await ended;
      await c.query(`SELECT 1`);
    });
    expect(reason.message).toMatch(/not queryable/);
    expect(reason.code).toBeUndefined();
    expect(isConnectionLossError(reason)).toBe(true);
    expect(isAmbiguousCommitError(reason)).toBe(false);
  });

  it("the connection was already known dead before COMMIT: connection lost, and not ambiguous, because the COMMIT could not be sent", async () => {
    const reason = await rejectionOf(async (c) => {
      const ended = endOf(c);
      await terminateBackend(db, c);
      await ended;
    });
    expect(isConnectionLossError(reason)).toBe(true);
    expect(isAmbiguousCommitError(reason)).toBe(false);
  });

  it("the socket is destroyed right after COMMIT is written (a real transport loss): connection lost AND ambiguous; the same error object arrives", async () => {
    let fromStatement: unknown;
    cleanups.push(
      interceptClientQueries((q) => {
        if (q.sql !== "COMMIT" || fromStatement !== undefined) return null;
        const answer = q.proceed();
        (q.client as unknown as { connection: { stream: { destroy(): void } } }).connection.stream.destroy();
        return answer.catch((err: unknown) => {
          fromStatement = err;
          throw err;
        });
      }),
    );
    const reason = await rejectionOf(async (c) => {
      await c.query(`SELECT 1`);
    });
    expect(reason).toBe(fromStatement);
    expect(reason.code).toBeUndefined();
    expect(isConnectionLossError(reason)).toBe(true);
    expect(isAmbiguousCommitError(reason)).toBe(true);
    expect(sentBy(releases[0]!.client)).not.toContain("ROLLBACK");
    expect(releases[0]!.err).toBeInstanceOf(Error);
    expect(uncaught).toEqual([]);
  });

  it("the backend terminated as COMMIT is sent: ambiguous, since the caller cannot tell how far it got", async () => {
    let armed = true;
    cleanups.push(
      interceptClientQueries((q) => {
        if (!armed || q.sql !== "COMMIT") return null;
        armed = false;
        return (async () => {
          q.client.on("error", () => undefined);
          await terminateBackend(db, q.client);
          return q.proceed();
        })();
      }),
    );
    const reason = await rejectionOf(async (c) => {
      await c.query(`SELECT 1`);
    });
    expect(isConnectionLossError(reason)).toBe(true);
    expect(isAmbiguousCommitError(reason)).toBe(true);
  });

  it("COMMIT really rejected by the server (a deferred constraint, 23503): neither mark, the same error object, a real rollback, and the client is reused", async () => {
    const email = uniqueEmail();
    let client!: PoolClient;
    const reason = await rejectionOf(async (c) => {
      client = c;
      await createUser(c, { email });
      await armRealCommitRejection(c);
    });

    expect(reason).toMatchObject({ code: "23503", severity: "ERROR" });
    expect(isConnectionLossError(reason)).toBe(false);
    expect(isAmbiguousCommitError(reason)).toBe(false);
    expect(await rowExists(email)).toBe(false);
    expect(sentBy(client)).toContain("ROLLBACK");
    await expectClientReused(client);
  });

  it("COMMIT really rejected with a serialization failure (a real 40001 from a write skew): neither mark, and a real rollback", async () => {
    const email = uniqueEmail();
    const otherEmail = uniqueEmail();
    const other = await db.connect();
    let failedAtCommit = false;
    cleanups.push(
      interceptClientQueries((q) => {
        if (q.sql !== "COMMIT" || q.client === (other as unknown)) return null;
        return q.proceed().catch((err: unknown) => {
          failedAtCommit = true;
          throw err;
        });
      }),
    );
    try {
      const reason = await rejectionOf(async (c) => {
        await c.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        await c.query(`SELECT count(*) FROM users`);
        await createUser(c, { email });
        await other.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await other.query(`SELECT count(*) FROM users`);
        await createUser(other, { email: otherEmail });
        await other.query("COMMIT");
      });
      expect(failedAtCommit).toBe(true);
      expect(reason).toMatchObject({ code: "40001", severity: "ERROR" });
      expect(isConnectionLossError(reason)).toBe(false);
      expect(isAmbiguousCommitError(reason)).toBe(false);
      expect(await rowExists(email)).toBe(false);
      expect(await rowExists(otherEmail)).toBe(true);
    } finally {
      other.release();
    }
  });

  it("the backend is terminated inside COMMIT (a real FATAL 57P01): both marks, though the server did answer, because FATAL proves nothing about the commit", async () => {
    const email = uniqueEmail();
    let armed = true;
    cleanups.push(
      interceptClientQueries((q) => {
        if (!armed || q.sql !== "COMMIT") return null;
        armed = false;
        return (async () => {
          const [result] = await Promise.allSettled([q.proceed(), waitUntilCommitInFlight(db, q.client).then(() => terminateBackend(db, q.client))]);
          if (result.status === "rejected") throw result.reason;
          return result.value;
        })();
      }),
    );
    const reason = await rejectionOf(async (c) => {
      await createUser(c, { email });
      await armSlowCommit(c, 30);
    });

    expect(reason).toMatchObject({ code: "57P01", severity: "FATAL" });
    expect(isConnectionLossError(reason)).toBe(true);
    expect(isAmbiguousCommitError(reason)).toBe(true);
    expect(await rowExists(email)).toBe(false);
    expect(uncaught).toEqual([]);
  }, 40_000);

  it("the socket dies with COMMIT in flight: the same marks and the same generic error whether the server then commits or not, so the error alone proves nothing", async () => {
    const run = async (email: string, thenTerminate: boolean) => {
      let armed = true;
      let client!: PoolClient;
      const restore = interceptClientQueries((q) => {
        if (!armed || q.sql !== "COMMIT") return null;
        armed = false;
        return (async () => {
          const answer = q.proceed();
          await waitUntilCommitInFlight(db, q.client);
          destroySocket(q.client);
          return answer;
        })();
      });
      try {
        return {
          reason: await rejectionOf(async (c) => {
            client = c;
            await createUser(c, { email });
            await armSlowCommit(c, thenTerminate ? 30 : 1);
          }),
          client,
        };
      } finally {
        restore();
      }
    };

    const landedEmail = uniqueEmail();
    const landed = await run(landedEmail, false);
    await expect.poll(() => rowExists(landedEmail), { timeout: 5000 }).toBe(true);

    const rolledBackEmail = uniqueEmail();
    const rolledBack = await run(rolledBackEmail, true);
    await terminateBackend(db, rolledBack.client);
    expect(await rowExists(rolledBackEmail)).toBe(false);

    for (const { reason } of [landed, rolledBack]) {
      expect((reason as { severity?: string }).severity).toBeUndefined();
      expect(reason.message).toBe("Connection terminated unexpectedly");
      expect(isConnectionLossError(reason)).toBe(true);
      expect(isAmbiguousCommitError(reason)).toBe(true);
    }
    expect(uncaught).toEqual([]);
  }, 40_000);

  // A failing statement is sent in COMMIT's place: a simulation, for SQLSTATEs the real rejections above do not produce.
  it.each(["40001", "XX000"])("a server error with %s in the COMMIT phase on a live connection (simulated): the server answered, so neither", async (sqlState) => {
    let armed = true;
    cleanups.push(
      interceptClientQueries((q) => {
        if (!armed || q.sql !== "COMMIT") return null;
        armed = false;
        return q.proceed(sqlStateFault(sqlState));
      }),
    );
    const reason = await rejectionOf(async (c) => {
      await c.query(`SELECT 1`);
    });
    expect(reason.code).toBe(sqlState);
    expect(isConnectionLossError(reason)).toBe(false);
    expect(isAmbiguousCommitError(reason)).toBe(false);
  });

  it("errors on a healthy connection: a SQL error, a thrown error, and one that merely SAYS 'not queryable' are none of these", async () => {
    const sqlError = await rejectionOf(async (c) => c.query(`SELECT * FROM table_that_does_not_exist`));
    const thrown = await rejectionOf(async () => {
      throw new Error("business rule");
    });
    const wording = await rejectionOf(async () => {
      throw new Error("Client has encountered a connection error and is not queryable");
    });
    for (const reason of [sqlError, thrown, wording]) {
      expect(isConnectionLossError(reason)).toBe(false);
      expect(isAmbiguousCommitError(reason)).toBe(false);
    }
  });

  it("an error from before the transaction, or one that is not an object, is never marked and does not crash anything", async () => {
    expect(isConnectionLossError(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(isAmbiguousCommitError(new Error("Connection terminated unexpectedly"))).toBe(false);
    for (const value of [null, undefined, "text", 7]) {
      expect(isConnectionLossError(value)).toBe(false);
      expect(isAmbiguousCommitError(value)).toBe(false);
    }
    const [result] = await Promise.allSettled([
      withTransaction(async () => {
        throw "a thrown string";
      }),
    ]);
    expect((result as PromiseRejectedResult).reason).toBe("a thrown string");
  });
});

describe("ROLLBACK itself fails on a connection that still looks alive", () => {
  it("the caller gets the original error, the failure is logged, and the client is discarded rather than reused with an open transaction", async () => {
    const email = uniqueEmail();
    const failure = new Error("business rule");
    let client!: PoolClient;
    cleanups.push(
      interceptClientQueries((q) => {
        if (q.sql !== "ROLLBACK") return null;
        return q.proceed(sqlStateFault("XX000"));
      }),
    );

    const [result] = await Promise.allSettled([
      withTransaction(async (c) => {
        client = c;
        await createUser(c, { email });
        throw failure;
      }),
    ]);

    expect((result as PromiseRejectedResult).reason).toBe(failure);
    expect(releases).toHaveLength(1);
    expect(releases[0]!.err).toMatchObject({ code: "XX000" });
    expect(logs.lines().some((l) => l.includes("DB ERROR [transaction rollback]"))).toBe(true);
    expect(await withTransaction(async (c) => backendPid(c))).not.toBe(backendPid(client));
    // The discarded connection took its open transaction with it.
    await expect.poll(() => rowExists(email)).toBe(false);
  });
});
