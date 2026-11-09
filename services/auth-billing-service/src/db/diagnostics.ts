import type { DatabaseEnvConfig } from "../config/database.js";
import { databaseUnavailableReason, knownDriverMessage } from "./unavailable.js";

/** Known PostgreSQL / Node network error codes for quick terminal diagnosis. */
const PG_ERROR_HINTS: Record<string, string> = {
  ECONNREFUSED: "PostgreSQL is not running or not listening on the configured host:port.",
  ENOTFOUND: "Database host could not be resolved (check DB_HOST / DATABASE_URL hostname).",
  ETIMEDOUT: "Connection timed out (firewall, wrong host, or PostgreSQL not accepting connections).",
  "28P01": "Invalid password — DB_PASSWORD / DATABASE_URL credentials rejected by PostgreSQL.",
  "3D000": "Database does not exist — create it or fix DB_NAME / DATABASE_URL path.",
  "28000": "Invalid authorization specification (role/user may not exist).",
  "42501": "Permission denied for the database or schema.",
};

export interface ParsedDbError {
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  address?: string;
  port?: number;
  severity?: string;
  detail?: string;
  hint?: string;
  hintText?: string;
}

export function parseDbError(err: unknown): ParsedDbError {
  if (!err || typeof err !== "object") {
    return { message: String(err) };
  }

  const e = err as Record<string, unknown>;
  const code = typeof e.code === "string" ? e.code : undefined;

  return {
    message: typeof e.message === "string" ? e.message : "Unknown database error",
    code,
    errno: typeof e.errno === "number" ? e.errno : undefined,
    syscall: typeof e.syscall === "string" ? e.syscall : undefined,
    address: typeof e.address === "string" ? e.address : undefined,
    port: typeof e.port === "number" ? e.port : undefined,
    severity: typeof e.severity === "string" ? e.severity : undefined,
    detail: typeof e.detail === "string" ? e.detail : undefined,
    hint: typeof e.hint === "string" ? e.hint : undefined,
    hintText: code ? PG_ERROR_HINTS[code] : undefined,
  };
}

/** Identifiers only: a value with spaces, punctuation or a line break is free text, whatever field it arrived in. */
const IDENTIFIER = /^[\w$.:-]{1,128}$/;

function identifier(value: unknown): string | null {
  return typeof value === "string" && IDENTIFIER.test(value) ? value : null;
}

/**
 * The fields of a database error that may be logged. An allowlist, because the rest can carry data: PostgreSQL's DETAIL quotes
 * row values, its message can name users and hosts, and `where` holds statement context. Never log the error object itself:
 * logging prints every property it has.
 */
export function safeDbErrorFields(err: unknown): { sqlstate: string | null; severity: string | null; constraint: string | null; routine: string | null } {
  const e = (err && typeof err === "object" ? err : {}) as Record<string, unknown>;
  return { sqlstate: identifier(e.code), severity: identifier(e.severity), constraint: identifier(e.constraint), routine: identifier(e.routine) };
}

/** What kind of thing was thrown, for a log line. Never its content. */
export function safeErrorName(err: unknown): string {
  if (err instanceof Error) return identifier(err.name) ?? "Error";
  return typeof err;
}

/**
 * What to log for any error that may have come from the database or the connection to it: the allowlisted fields and a fixed
 * reason, so a log line can say what happened without repeating the server's text.
 */
export function safeErrorLogFields(err: unknown) {
  return {
    errorName: safeErrorName(err),
    ...safeDbErrorFields(err),
    syscall: identifier((err as { syscall?: unknown } | null | undefined)?.syscall),
    reason: databaseUnavailableReason(err),
  };
}

/**
 * One line that says what went wrong, safe to log, store or send: every word comes from this file or from a value shaped like an
 * identifier, never from the error's own text. For a person reading it; no code should compare it.
 */
export function safeErrorDescription(err: unknown): string {
  const driverMessage = knownDriverMessage(err);
  if (driverMessage) return driverMessage;
  const { sqlstate, constraint } = safeDbErrorFields(err);
  if (sqlstate && Object.hasOwn(PG_ERROR_HINTS, sqlstate)) return PG_ERROR_HINTS[sqlstate]!;
  if (sqlstate) return `Database error (SQLSTATE ${sqlstate}${constraint ? `, constraint ${constraint}` : ""})`;
  return `Unexpected error (${safeErrorName(err)})`;
}

const MAX_STACK_FRAMES = 15;

/**
 * The call frames of a programming error, so a 500 can still be located, without the name and message at the top of the stack.
 * Removed by position, so a message that spans lines or imitates a frame goes with it. If the stack no longer starts with the
 * message, there are no frames rather than a guess. A database error has none: its frames are the driver's, and locate nothing.
 */
export function safeStackFrames(err: unknown): string[] | undefined {
  if (!(err instanceof Error) || typeof err.stack !== "string" || "severity" in err) return undefined;
  let rest = err.stack;
  if (err.message) {
    const at = rest.indexOf(err.message);
    if (at < 0 || !/^[\w$.]*(: )?$/.test(rest.slice(0, at))) return undefined;
    rest = rest.slice(at + err.message.length);
  }
  const frames = rest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, MAX_STACK_FRAMES);
  return frames.length > 0 ? frames : undefined;
}

/**
 * Log a database error with allowlisted fields only, plus a fixed hint for known configuration mistakes.
 * Returns the parsed error; it holds the raw message, so it must not be logged, stored or sent either.
 */
export function logDbError(context: string, err: unknown): ParsedDbError {
  const parsed = parseDbError(err);

  console.error(`DB ERROR [${context}]`, safeErrorLogFields(err));

  if (parsed.hintText) {
    console.error(`[db:diagnostics] likely cause: ${parsed.hintText}`);
  }

  return parsed;
}

/** Query parameters that are known to hold no secret. pg also reads credentials from the query string (`?password=`, `?sslpassword=`), so anything else is masked. */
const SAFE_CONNECTION_PARAMS: ReadonlySet<string> = new Set(["sslmode", "channel_binding", "connect_timeout", "application_name"]);

export function maskConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "****";
    }
    for (const name of new Set(parsed.searchParams.keys())) {
      if (!SAFE_CONNECTION_PARAMS.has(name.toLowerCase())) parsed.searchParams.set(name, "****");
    }
    return parsed.toString();
  } catch {
    return "<invalid DATABASE_URL>";
  }
}

export function maskConfig(config: DatabaseEnvConfig): Record<string, string | number | boolean> {
  return {
    source: process.env.DATABASE_URL?.trim() ? "DATABASE_URL" : "DB_* discrete variables",
    host: config.host,
    port: config.port,
    user: config.user,
    passwordSet: Boolean(config.password),
    database: config.database,
    maskedUrl: maskConnectionString(config.connectionString),
    expectedFormat: "postgresql://<user>:<password>@localhost:5432/molecule_studio_db",
  };
}

/** Logs raw env presence and resolved (masked) connection target before connecting. */
export function logEnvPresence(): void {
  const hasUrl = Boolean(process.env.DATABASE_URL?.trim());

  console.log("[db:config] ── environment inspection ──");
  console.log("[db:config] DATABASE_URL set:", hasUrl);

  if (hasUrl) {
    console.log("[db:config] DATABASE_URL (masked):", maskConnectionString(process.env.DATABASE_URL!.trim()));
  } else {
    console.log("[db:config] DB_HOST:", process.env.DB_HOST?.trim() || "(default: localhost)");
    console.log("[db:config] DB_PORT:", process.env.DB_PORT?.trim() || "(default: 5432)");
    console.log(
      "[db:config] DB_USER:",
      process.env.DB_USER?.trim() ? process.env.DB_USER.trim() : "❌ undefined — required when DATABASE_URL is unset",
    );
    console.log(
      "[db:config] DB_PASSWORD:",
      process.env.DB_PASSWORD?.trim() ? "***set***" : "❌ undefined — required when DATABASE_URL is unset",
    );
    console.log(
      "[db:config] DB_NAME:",
      process.env.DB_NAME?.trim() ? process.env.DB_NAME.trim() : "❌ undefined — required when DATABASE_URL is unset",
    );
  }

  console.log(
    "[db:config] expected format: postgresql://<user>:<password>@localhost:5432/molecule_studio_db",
  );
}

export function logResolvedConfig(config: DatabaseEnvConfig): void {
  console.log("[db:config] resolved target:", JSON.stringify(maskConfig(config), null, 2));
}
