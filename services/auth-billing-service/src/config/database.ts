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

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 5432;

export const POOL_OPTIONS = {
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
} as const satisfies Pick<
  PoolConfig,
  "max" | "idleTimeoutMillis" | "connectionTimeoutMillis"
>;

function requireEnv(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return trimmed;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid DB_PORT: ${value}`);
  }

  return port;
}

function buildConnectionString(parts: Omit<DatabaseEnvConfig, "connectionString">): string {
  const user = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  return `postgresql://${user}:${password}@${parts.host}:${parts.port}/${parts.database}`;
}

function parseDatabaseUrl(url: string): DatabaseEnvConfig {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection string.");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the postgresql:// scheme.");
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  return {
    host: parsed.hostname || DEFAULT_HOST,
    port: parsed.port ? Number(parsed.port) : DEFAULT_PORT,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    connectionString: url,
  };
}

let cachedConfig: DatabaseEnvConfig | null = null;

/**
 * Prefer `DATABASE_URL` when set; otherwise compose from `DB_HOST`, `DB_PORT`,
 * `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
 */
export function resolveDatabaseEnv(): DatabaseEnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const explicitUrl = process.env.DATABASE_URL?.trim();

  if (explicitUrl) {
    cachedConfig = parseDatabaseUrl(explicitUrl);
    return cachedConfig;
  }

  const host = process.env.DB_HOST?.trim() || DEFAULT_HOST;
  const port = parsePort(process.env.DB_PORT, DEFAULT_PORT);
  const user = requireEnv("DB_USER", process.env.DB_USER);
  const password = requireEnv("DB_PASSWORD", process.env.DB_PASSWORD);
  const database = requireEnv("DB_NAME", process.env.DB_NAME);

  const connectionString = buildConnectionString({ host, port, user, password, database });

  // Keep Prisma-compatible tooling in sync when only discrete vars are provided.
  process.env.DATABASE_URL = connectionString;

  cachedConfig = { host, port, user, password, database, connectionString };
  return cachedConfig;
}

export function createPoolConfig(resolved: DatabaseEnvConfig = resolveDatabaseEnv()): PoolConfig {
  return {
    connectionString: resolved.connectionString,
    max: POOL_OPTIONS.max,
    idleTimeoutMillis: POOL_OPTIONS.idleTimeoutMillis,
    connectionTimeoutMillis: POOL_OPTIONS.connectionTimeoutMillis,
  };
}

export function assertDatabaseEnv(): DatabaseEnvConfig {
  return resolveDatabaseEnv();
}

/** Clears cached config — used when retrying after .env hot-reload in dev. */
export function resetDatabaseEnvCache(): void {
  cachedConfig = null;
}
