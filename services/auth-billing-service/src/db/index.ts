import pg from "pg";
import {
  createPoolConfig,
  resetDatabaseEnvCache,
  resolveDatabaseEnv,
} from "../config/database.js";
import {
  logDbError,
  logEnvPresence,
  logResolvedConfig,
  parseDbError,
  safeDbErrorFields,
  safeErrorDescription,
} from "./diagnostics.js";

const { Pool } = pg;

// DATE (OID 1082) has no time zone: keep Postgres' 'YYYY-MM-DD' text. The default
// parser builds a local-midnight Date, which toISOString() shifts to the previous
// day on servers east of UTC — and every profile save then stored that (FINDING-06).
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

let poolInstance: pg.Pool | null = null;
let databaseReady = false;
let databaseError: string | null = null;
let lastDbErrorCode: string | null = null;

/** What the development-only responses show: a fixed description and an identifier, never the error's text. */
function rememberDatabaseError(err: unknown): void {
  databaseError = safeErrorDescription(err);
  lastDbErrorCode = safeDbErrorFields(err).sqlstate;
}

function resetPool(): void {
  if (poolInstance) {
    void poolInstance.end().catch(() => undefined);
    poolInstance = null;
  }
}

function getPool(): pg.Pool {
  if (!poolInstance) {
    const databaseEnv = resolveDatabaseEnv();
    logResolvedConfig(databaseEnv);

    poolInstance = new Pool(createPoolConfig(databaseEnv));
    poolInstance.on("error", (err) => {
      logDbError("pool idle client", err);
      databaseReady = false;
      rememberDatabaseError(err);
    });
  }
  return poolInstance;
}

/** Lazy pool — defers env resolution until the first query. */
export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const instance = getPool();
    const value = instance[prop as keyof pg.Pool];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});

export function isDatabaseReady(): boolean {
  return databaseReady;
}

export function getDatabaseError(): string | null {
  return databaseError;
}

export function getDatabaseErrorCode(): string | null {
  return lastDbErrorCode;
}

let probeInFlight: Promise<boolean> | null = null;

/**
 * Probes PostgreSQL on startup (or on demand). Never terminates the process.
 * Logs full PG / network error details to the terminal for `.env` debugging.
 *
 * Single-flight (PERF-22): callers that arrive while a probe is running share it. Each probe replaces the
 * pool, so before this every request that found the database "not ready" (requireDatabase) rebuilt the
 * pool — and ended the one another request had just created — a herd of pools and connection attempts
 * against a database that is just coming back (44 rebuilds in 5 outage events of 20 requests).
 */
export function verifyDatabaseConnection(): Promise<boolean> {
  probeInFlight ??= probeDatabase().finally(() => {
    probeInFlight = null;
  });
  return probeInFlight;
}

async function probeDatabase(): Promise<boolean> {
  logEnvPresence();

  try {
    resetDatabaseEnvCache();
    resetPool();

    const databaseEnv = resolveDatabaseEnv();
    logResolvedConfig(databaseEnv);

    const result = await getPool().query<{ server_time: Date }>("SELECT NOW() AS server_time");
    databaseReady = true;
    databaseError = null;
    lastDbErrorCode = null;

    console.log("Database connection successfully established via environment tokens.");
    console.log("[db:diagnostics] server_time:", result.rows[0]?.server_time ?? "unknown");
    return true;
  } catch (err) {
    databaseReady = false;

    logDbError("verifyDatabaseConnection", err);
    rememberDatabaseError(err);

    console.warn("Database connection failed.");
    if (lastDbErrorCode) {
      console.warn(`[db:diagnostics] error code: ${lastDbErrorCode}`);
    }
    console.warn("[db] HTTP server will stay up — auth/billing routes return 503 until PostgreSQL is reachable.");
    return false;
  }
}

export { getPool };

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
  databaseReady = false;
  databaseError = null;
  lastDbErrorCode = null;
}

/** PostgreSQL closes the session after these, so the connection is gone even if the socket has not closed yet. */
function endedTheSession(err: unknown): boolean {
  const severity = err && typeof err === "object" && "severity" in err ? err.severity : null;
  return severity === "FATAL" || severity === "PANIC";
}

/** A PostgreSQL error carries a severity: the server answered. Errors from the driver or the socket have none. */
function serverAnswered(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "severity" in err && err.severity);
}

// What withTransaction learned about an error it rethrew. Kept beside the error, so the error object itself is unchanged.
const connectionLossErrors = new WeakSet<object>();
const ambiguousCommitErrors = new WeakSet<object>();

function mark(set: WeakSet<object>, err: unknown): void {
  if (err && typeof err === "object") set.add(err);
}

/**
 * Did this error from withTransaction come with a lost connection? Decided from the client's state at the time, never from
 * the message: after a backend dies, later statements fail with a text that has no SQLSTATE, while an error that merely
 * says the same words on a healthy client is not a connection loss.
 */
export function isConnectionLossError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && connectionLossErrors.has(err));
}

/**
 * Was this error raised by a COMMIT with no usable answer from the server? Then the transaction may have committed or may
 * not have, and the only way to know is to read the data again. Not ambiguous: a COMMIT the server refused (it rolled back),
 * and a connection already known dead before COMMIT (it could not be sent).
 */
export function isAmbiguousCommitError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && ambiguousCommitErrors.has(err));
}

/**
 * Run queries inside a single transaction with automatic ROLLBACK on failure.
 *
 * pg-pool removes its idle-client 'error' listener at checkout and adds it back at release. A connection that dies in
 * between would emit 'error' with no listener, which ends the Node process, so this function listens for that window.
 * The listener only records the failure: a query on a dead client rejects, so the caller still gets an error and a
 * lost connection cannot pass for a COMMIT. Releasing with an error makes the pool destroy the client.
 *
 * The caller always gets the original error object. isConnectionLossError and isAmbiguousCommitError tell it what happened.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let brokenBy: Error | undefined;
  let committing = false;
  let deadBeforeCommit = false;
  // `on`, not `once`: a connection terminated while idle emits twice (the server's message, then the socket's end).
  const onClientError = (err: Error) => {
    if (brokenBy) return;
    brokenBy = err;
    logDbError("transaction client", err);
  };
  client.on("error", onClientError);
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    deadBeforeCommit = brokenBy !== undefined;
    committing = true;
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (!brokenBy && endedTheSession(err)) brokenBy = err as Error;
    // Read before the ROLLBACK below: its failure says nothing about the error being reported.
    const noAnswerToCommit = committing && !serverAnswered(err);
    if (brokenBy || noAnswerToCommit) mark(connectionLossErrors, err);
    if (committing && !deadBeforeCommit && (brokenBy || noAnswerToCommit)) mark(ambiguousCommitErrors, err);
    if (!brokenBy) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        // The transaction state is unknown: never reuse this connection. The caller still gets the original error.
        logDbError("transaction rollback", rollbackErr);
        brokenBy = rollbackErr as Error;
      }
    }
    throw err;
  } finally {
    // Same tick as release, which restores the pool's listener: the client is never without one.
    client.removeListener("error", onClientError);
    client.release(brokenBy);
  }
}

export { parseDbError };

export type { PoolClient } from "pg";
