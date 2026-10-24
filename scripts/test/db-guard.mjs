/**
 * Refuses to let any test touch a database that is not obviously a local,
 * disposable test database. Imported by every DB-backed test setup and by the
 * E2E launcher. There is deliberately no override flag.
 */

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:55432/moleculestudio_test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);
const FORBIDDEN_HOST_PATTERNS = [/neon\.tech$/i, /supabase\.(co|com)$/i, /\.aws\./i, /render\.com$/i];

export function resolveTestDatabaseUrl(env = process.env) {
  return (env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL).trim();
}

/**
 * @param {string} url
 * @returns {{ url: string, host: string, port: number, database: string }}
 */
export function assertTestDatabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[db-guard] TEST_DATABASE_URL is not a valid URL.`);
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`[db-guard] TEST_DATABASE_URL must use postgresql://`);
  }

  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  if (FORBIDDEN_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error(`[db-guard] Refusing hosted database host "${host}". Tests only run against local Postgres.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `[db-guard] Refusing non-local database host "${host}". Allowed: ${[...LOCAL_HOSTS].join(", ")}.`,
    );
  }
  if (/sslmode=require/i.test(parsed.search)) {
    throw new Error(`[db-guard] sslmode=require suggests a hosted database. Refusing.`);
  }
  if (!/test/i.test(database)) {
    throw new Error(
      `[db-guard] Database name "${database}" does not contain "test". Refusing to run destructive test setup.`,
    );
  }

  return { url, host, port: Number(parsed.port || 5432), database };
}
