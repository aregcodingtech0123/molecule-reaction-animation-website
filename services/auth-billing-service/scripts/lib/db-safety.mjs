/**
 * Connection-string safety checks shared by the DB scripts (and reused by the
 * test guard). Pure functions — no I/O.
 */

/** Hosts that can only be a developer machine or a local Docker network. */
export const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

function parse(url) {
  try {
    return new URL(url);
  } catch {
    throw new Error("Database URL is not a valid URL.");
  }
}

/**
 * Throws unless the URL points at a local Postgres. Used by destructive
 * scripts (db:reset). There is no override.
 */
export function assertLocalDatabaseUrl(url) {
  const parsed = parse(url);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Database URL must use postgresql://");
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `Refusing: "${host}" is not a local database host (allowed: ${[...LOCAL_DB_HOSTS].join(", ")}).`,
    );
  }
  if (/sslmode=(require|verify-ca|verify-full)/i.test(parsed.search)) {
    throw new Error("Refusing: sslmode=require indicates a hosted database.");
  }
  return { host, port: Number(parsed.port || 5432), database: decodeURIComponent(parsed.pathname.slice(1)) };
}

/**
 * Transaction-pooled endpoints (Neon "-pooler" hosts, Supabase/PgBouncer on
 * 6543, ?pgbouncer=true) break session-level advisory locks and multi-statement
 * migrations. The migration runner refuses them.
 */
export function isPooledConnectionUrl(url) {
  const parsed = parse(url);
  const host = parsed.hostname.toLowerCase();
  return (
    /-pooler(\.|$)/.test(host) ||
    host.includes("pooler.") ||
    parsed.port === "6543" ||
    /(^|[?&])pgbouncer=true/i.test(parsed.search)
  );
}
