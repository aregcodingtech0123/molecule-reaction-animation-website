/**
 * Errors that mean "PostgreSQL could not serve this request right now" (PERF-29): no connection could be
 * opened or none was free in the pool, the connection was lost, or the server refused new work. They are
 * answered 503 DATABASE_UNAVAILABLE with Retry-After instead of 500: the request is fine, the database is
 * not, and a retry is the right reaction (the money routes are idempotent per reference).
 *
 * Only errors that come from pg are matched: network errors of other clients (the Lemon Squeezy API,
 * Resend) never reach the error handler as a connect error with a database message or a SQLSTATE.
 */

/** pg-pool and pg client messages for "no connection": a saturated pool and a slow connect share the first. */
const UNAVAILABLE_MESSAGES = [
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
];

/** Socket errors while connecting (pg attaches the errno code and the syscall). */
const CONNECT_ERRNO = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

/**
 * SQLSTATE: class 08 (connection exception), 57P01 admin_shutdown, 57P02 crash_shutdown,
 * 57P03 cannot_connect_now (e.g. a resuming Neon compute), 53300 too_many_connections.
 */
const UNAVAILABLE_SQLSTATE = /^(08[0-9A-Z]{3}|57P0[123]|53300)$/;

/** Seconds a client should wait before retrying (pool connect timeout is 2 s; a short outage clears in seconds). */
export const DATABASE_RETRY_AFTER_SECONDS = 5;

export function isDatabaseUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: unknown; code?: unknown; syscall?: unknown; severity?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (UNAVAILABLE_MESSAGES.some((m) => message.includes(m))) return true;
  const code = typeof e.code === "string" ? e.code : "";
  // A PostgreSQL error (it has a severity) with a "server unavailable" SQLSTATE.
  if (typeof e.severity === "string" && UNAVAILABLE_SQLSTATE.test(code)) return true;
  // A socket error while connecting or resolving the database host.
  return CONNECT_ERRNO.has(code) && (e.syscall === "connect" || e.syscall === "getaddrinfo");
}
