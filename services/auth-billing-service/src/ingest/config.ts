/**
 * Configuration of the SEPARATE webhook ingestion process (Step 7.5, owner decision O-1 Option B).
 *
 * The ingestion process owns the Lemon webhook HMAC secret and the webhook-role database credential, and nothing else. It must not
 * hold what the main service holds (database owner or app credentials, the settlement and session secrets, the Lemon API key), so
 * that compromising it yields neither credit authority nor settlement authority. Pure checks over an env-like object: nothing here
 * loads a file, reads the main service's environment module or opens a connection. A problem names the variable and the rule,
 * never a value.
 */
import { isProductionNodeEnv, lemonVariantConfigProblem } from "../config/productionConfig.js";
import { weakSecretReason } from "../config/secretStrength.js";

/** The only role the ingestion connection may run as (migration 022 and the S3/S6 role scripts name it). */
export const WEBHOOK_DATABASE_ROLE = "moleculestudio_webhook";

/** Held by the main service only. Present in the ingestion process = a mis-copied or shared environment: refused. */
export const MAIN_SERVICE_ONLY_VARIABLES = [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "ACK_DATABASE_URL",
  "DB_PASSWORD",
  "JWT_SECRET",
  "INTERNAL_SERVICE_SECRET",
  "SETTLEMENT_CAPABILITY_SECRET",
  "SETTLEMENT_CAPABILITY_SECRET_PREVIOUS",
  "EMAIL_TOMBSTONE_SECRET",
  "LEMONSQUEEZY_API_KEY",
  "RESEND_API_KEY",
] as const;

const ALLOWED_URL_PARAMETERS: ReadonlySet<string> = new Set(["sslmode", "channel_binding", "connect_timeout", "application_name"]);
const TRUTHY = new Set(["true", "1", "yes", "y", "on"]);

export interface IngestConfig {
  production: boolean;
  webhookSecret: string;
  databaseUrl: string;
  storeId: string;
  /** Lemon variant id -> package id, from the server's configuration only. */
  variantToPackage: ReadonlyMap<string, string>;
  allowTestMode: boolean;
  host: string;
  port: number;
  storeTimeoutMs: number;
}

export type IngestConfigResult = { ok: true; config: IngestConfig } | { ok: false; problems: string[] };

function databaseUrlProblem(raw: string | undefined): string | null {
  const name = "WEBHOOK_DATABASE_URL";
  const value = raw?.trim();
  if (!value) return `${name} is not set.`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not a valid connection string.`;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return `${name} must use the postgresql:// scheme.`;
  let user: string;
  let database: string;
  try {
    user = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return `${name} is not a valid connection string.`;
  }
  if (user !== WEBHOOK_DATABASE_ROLE) return `${name} must connect as ${WEBHOOK_DATABASE_ROLE}.`;
  if (!database) return `${name} must include a database name.`;
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_URL_PARAMETERS.has(key.toLowerCase())) {
      return `${name} carries a query parameter that could override the user, host or database; only sslmode, channel_binding, connect_timeout and application_name are allowed.`;
    }
  }
  return null;
}

export function resolveIngestConfig(source: NodeJS.ProcessEnv = process.env): IngestConfigResult {
  const production = isProductionNodeEnv(source.NODE_ENV);
  const problems: string[] = [];

  for (const name of MAIN_SERVICE_ONLY_VARIABLES) {
    if ((source[name]?.trim() ?? "") !== "") {
      problems.push(`${name} must not be set for the ingestion process: it belongs to the main service only.`);
    }
  }

  const secret = source.LEMONSQUEEZY_WEBHOOK_SECRET?.trim() ?? "";
  const secretProblem = production ? weakSecretReason("LEMONSQUEEZY_WEBHOOK_SECRET", secret) : secret ? null : "LEMONSQUEEZY_WEBHOOK_SECRET is not set.";
  if (secretProblem) problems.push(secretProblem);

  const dbProblem = databaseUrlProblem(source.WEBHOOK_DATABASE_URL);
  if (dbProblem) problems.push(dbProblem);

  const storeId = source.LEMONSQUEEZY_STORE_ID?.trim() ?? "";
  if (!/^\d+$/.test(storeId)) problems.push("LEMONSQUEEZY_STORE_ID must be a numeric Lemon Squeezy store id.");

  const variantProblem = lemonVariantConfigProblem(source);
  if (variantProblem) problems.push(variantProblem);

  // O-3: production test mode is OFF. Any truthy value is refused there, not only the one the service reads as "on".
  const testModeRaw = source.LEMONSQUEEZY_ALLOW_TEST_MODE?.trim().toLowerCase() ?? "";
  if (production && TRUTHY.has(testModeRaw)) {
    problems.push("LEMONSQUEEZY_ALLOW_TEST_MODE must not be enabled in production.");
  }

  const portRaw = source.INGEST_PORT?.trim();
  const port = portRaw ? Number(portRaw) : 4001;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) problems.push("INGEST_PORT must be an integer between 1 and 65535.");

  const timeoutRaw = Number(source.WEBHOOK_STORE_TIMEOUT_MS?.trim());
  const storeTimeoutMs = Number.isInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 3_000;

  if (problems.length > 0) return { ok: false, problems };

  const variantToPackage = new Map<string, string>([
    [source.LEMONSQUEEZY_VARIANT_STARTER!.trim(), "starter"],
    [source.LEMONSQUEEZY_VARIANT_PRO!.trim(), "pro"],
    [source.LEMONSQUEEZY_VARIANT_ENTERPRISE!.trim(), "enterprise"],
  ]);
  return {
    ok: true,
    config: {
      production,
      webhookSecret: secret,
      databaseUrl: source.WEBHOOK_DATABASE_URL!.trim(),
      storeId,
      variantToPackage,
      allowTestMode: !production && testModeRaw === "true",
      host: source.INGEST_HOST?.trim() || (production ? "127.0.0.1" : "0.0.0.0"),
      port,
      storeTimeoutMs,
    },
  };
}
