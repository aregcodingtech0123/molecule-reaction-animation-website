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

/**
 * Probes PostgreSQL on startup (or on demand). Never terminates the process.
 * Logs full PG / network error details to the terminal for `.env` debugging.
 */
export async function verifyDatabaseConnection(): Promise<boolean> {
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

/** Run queries inside a single transaction with automatic ROLLBACK on failure. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export { parseDbError };

export type { PoolClient } from "pg";
