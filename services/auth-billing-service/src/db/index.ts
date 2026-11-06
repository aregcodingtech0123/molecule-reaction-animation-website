import pg from "pg";
import {
  createPoolConfig,
  resetDatabaseEnvCache,
  resolveDatabaseEnv,
} from "../config/database.js";
import {
  logEnvPresence,
  logFullDbError,
  logResolvedConfig,
  parseDbError,
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
      const parsed = logFullDbError("pool idle client", err);
      databaseReady = false;
      databaseError = parsed.message;
      lastDbErrorCode = parsed.code ?? null;
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

    const parsed = logFullDbError("verifyDatabaseConnection", err);
    databaseError = parsed.message;
    lastDbErrorCode = parsed.code ?? null;

    console.warn(`Database connection failed: ${parsed.message}`);
    if (parsed.code) {
      console.warn(`[db:diagnostics] error code: ${parsed.code}`);
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

/**
 * Run queries inside a single transaction with automatic ROLLBACK on failure.
 *
 * pg-pool removes its idle-client 'error' listener at checkout and adds it back at release. A connection that dies in
 * between would emit 'error' with no listener, which ends the Node process, so this function listens for that window.
 * The listener only records the failure: a query on a dead client rejects, so the caller still gets an error and a
 * lost connection cannot pass for a COMMIT. Releasing with an error makes the pool destroy the client.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let brokenBy: Error | undefined;
  // `on`, not `once`: a connection terminated while idle emits twice (the server's message, then the socket's end).
  const onClientError = (err: Error) => {
    if (brokenBy) return;
    brokenBy = err;
    logFullDbError("transaction client", err);
  };
  client.on("error", onClientError);
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (!brokenBy && endedTheSession(err)) brokenBy = err as Error;
    if (!brokenBy) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        // The transaction state is unknown: never reuse this connection. The caller still gets the original error.
        logFullDbError("transaction rollback", rollbackErr);
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
