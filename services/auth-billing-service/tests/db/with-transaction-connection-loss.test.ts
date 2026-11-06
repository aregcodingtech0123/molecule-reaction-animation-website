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
import { closePool, getPool, withTransaction, type PoolClient } from "../../src/db/index.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser, uniqueEmail } from "../support/db";
import { backendPid, interceptClientQueries, sqlStateFault, terminateBackend } from "../support/pg-fault";

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
    // Logged once, for the first event: the second is the same failure.
    expect(logs.lines().filter((l) => l.includes("FULL DB ERROR [transaction client]"))).toHaveLength(1);
    expect(logs.lines().some((l) => l.includes("[db:diagnostics] parsed") && l.includes("synthetic client error"))).toBe(true);
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

  it("COMMIT refused by the server on a live connection: failure propagated, rolled back, nothing committed, client reused", async () => {
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
    expect(logs.lines().some((l) => l.includes("FULL DB ERROR [transaction rollback]"))).toBe(true);
    expect(await withTransaction(async (c) => backendPid(c))).not.toBe(backendPid(client));
    // The discarded connection took its open transaction with it.
    await expect.poll(() => rowExists(email)).toBe(false);
  });
});
