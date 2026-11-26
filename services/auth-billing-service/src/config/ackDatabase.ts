import { resolveDatabaseEnv } from "./database.js";

/**
 * ACK_DATABASE_URL: the connection used ONLY to record delivery attempts (Phase 2C, compatibility with migration 021).
 *
 * Migration 021's write-once trigger lets only the acknowledgement role (or a member of the table owner) set
 * `ai_credit_holds.answer_delivery_attempted_at`. The trigger is SECURITY INVOKER and tests `current_user`, so the write must be
 * made by a connection that PostgreSQL authenticated AS that role. A separate URL alone does not prove that: the pool in
 * db/ackPool.ts also checks `current_user` and `session_user` at run time.
 *
 * Rules enforced here (configuration only, no connection is made):
 *  - read from ACK_DATABASE_URL and nothing else: there is NO fallback to DATABASE_URL or to the DB_* variables;
 *  - a postgresql:// URL with a user and a database name;
 *  - its user must differ from the main pool's user, so the main application role is never reused as the ack connection.
 *    This static comparison does not replace the run-time identity check.
 *
 * Problems are reported as fixed codes only. Nothing here ever returns, logs or throws the URL or any part of it.
 */

/** The only role the acknowledgement connection may run as (a project constant, as in migration 021 and the role scripts). */
export const ACK_DATABASE_ROLE = "moleculestudio_ack";

export type AckConfigProblem =
  | "missing"
  | "invalid_url"
  | "unsupported_scheme"
  | "missing_user"
  | "missing_database"
  | "unsupported_parameter"
  | "main_config_unavailable"
  | "same_user_as_main"
  | "different_database";

export interface AckDatabaseConfig {
  connectionString: string;
  /** The configured user name (not secret). Used only for the comparison with the main pool's user. */
  user: string;
}

export type AckConfigResult = { ok: true; config: AckDatabaseConfig } | { ok: false; problem: AckConfigProblem };

const PROBLEM_TEXT: Record<AckConfigProblem, string> = {
  missing: "ACK_DATABASE_URL is not set.",
  invalid_url: "ACK_DATABASE_URL is not a valid connection string.",
  unsupported_scheme: "ACK_DATABASE_URL must use the postgresql:// scheme.",
  missing_user: "ACK_DATABASE_URL must name a user.",
  missing_database: "ACK_DATABASE_URL must include a database name.",
  unsupported_parameter: "ACK_DATABASE_URL carries a query parameter that could override the user, host or database; only sslmode, channel_binding, connect_timeout and application_name are allowed.",
  main_config_unavailable: "The main database configuration could not be resolved, so the acknowledgement user cannot be checked against it.",
  same_user_as_main: "ACK_DATABASE_URL uses the same user as the main database connection.",
  different_database: "ACK_DATABASE_URL names a different database than the main database connection.",
};

/**
 * Query parameters allowed in ACK_DATABASE_URL. The driver also reads `user`, `password`, `host`, `dbname`, `options` and more from
 * the query string, which would let a URL authenticate as someone other than its visible user (review finding L6).
 */
const ALLOWED_PARAMETERS: ReadonlySet<string> = new Set(["sslmode", "channel_binding", "connect_timeout", "application_name"]);

/** A fixed, secret-free description of a configuration problem. */
export function describeAckConfigProblem(problem: AckConfigProblem): string {
  return PROBLEM_TEXT[problem];
}

/** The main pool's configured user and database, or null when the main configuration cannot be resolved. Never throws. */
function mainPoolIdentity(): { user: string; database: string } | null {
  try {
    const { user, database } = resolveDatabaseEnv();
    return { user, database };
  } catch {
    return null;
  }
}

export function resolveAckDatabaseConfig(
  source: NodeJS.ProcessEnv = process.env,
  main: () => { user: string; database: string } | null = mainPoolIdentity,
): AckConfigResult {
  const raw = source.ACK_DATABASE_URL?.trim();
  if (!raw) return { ok: false, problem: "missing" };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, problem: "invalid_url" };
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return { ok: false, problem: "unsupported_scheme" };

  let user: string;
  try {
    user = decodeURIComponent(parsed.username);
  } catch {
    return { ok: false, problem: "invalid_url" };
  }
  if (!user) return { ok: false, problem: "missing_user" };
  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return { ok: false, problem: "invalid_url" };
  }
  if (!database) return { ok: false, problem: "missing_database" };
  for (const name of parsed.searchParams.keys()) {
    if (!ALLOWED_PARAMETERS.has(name.toLowerCase())) return { ok: false, problem: "unsupported_parameter" };
  }

  const mainIdentity = main();
  if (mainIdentity === null) return { ok: false, problem: "main_config_unavailable" };
  if (mainIdentity.user === user) return { ok: false, problem: "same_user_as_main" };
  // The acknowledgement must update the rows the main pool reserved (review finding L7).
  if (mainIdentity.database !== database) return { ok: false, problem: "different_database" };

  return { ok: true, config: { connectionString: raw, user } };
}
