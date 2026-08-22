import "../config/loadEnv.js";
import "dotenv/config";
import type { PoolConfig } from "pg";
/** Resolved PostgreSQL connection settings (from DATABASE_URL or discrete DB_* vars). */
export interface DatabaseEnvConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionString: string;
}
export declare const POOL_OPTIONS: {
    readonly max: 20;
    readonly idleTimeoutMillis: 30000;
    readonly connectionTimeoutMillis: 2000;
};
/**
 * Prefer `DATABASE_URL` when set; otherwise compose from `DB_HOST`, `DB_PORT`,
 * `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
 */
export declare function resolveDatabaseEnv(): DatabaseEnvConfig;
export declare function createPoolConfig(resolved?: DatabaseEnvConfig): PoolConfig;
export declare function assertDatabaseEnv(): DatabaseEnvConfig;
/** Clears cached config — used when retrying after .env hot-reload in dev. */
export declare function resetDatabaseEnvCache(): void;
