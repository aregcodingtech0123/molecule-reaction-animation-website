import type { DatabaseEnvConfig } from "../config/database.js";

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

/** Prints the full internal error object plus parsed PG / network fields. */
export function logFullDbError(context: string, err: unknown): ParsedDbError {
  const parsed = parseDbError(err);

  console.error(`❌ FULL DB ERROR [${context}]:`, err);
  console.error("[db:diagnostics] parsed:", JSON.stringify(parsed, null, 2));

  if (parsed.hintText) {
    console.error(`[db:diagnostics] likely cause: ${parsed.hintText}`);
  }

  return parsed;
}

export function maskConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "****";
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
