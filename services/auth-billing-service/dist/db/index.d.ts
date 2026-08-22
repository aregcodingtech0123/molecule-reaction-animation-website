import pg from "pg";
import { parseDbError } from "./diagnostics.js";
declare function getPool(): pg.Pool;
/** Lazy pool — defers env resolution until the first query. */
export declare const pool: pg.Pool;
export declare function isDatabaseReady(): boolean;
export declare function getDatabaseError(): string | null;
export declare function getDatabaseErrorCode(): string | null;
/**
 * Probes PostgreSQL on startup (or on demand). Never terminates the process.
 * Logs full PG / network error details to the terminal for `.env` debugging.
 */
export declare function verifyDatabaseConnection(): Promise<boolean>;
export { getPool };
export declare function closePool(): Promise<void>;
/** Run queries inside a single transaction with automatic ROLLBACK on failure. */
export declare function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
export { parseDbError };
export type { PoolClient } from "pg";
