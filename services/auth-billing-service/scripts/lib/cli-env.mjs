/**
 * Shared connection resolution for the DB CLI scripts.
 * MIGRATION_DATABASE_URL (direct connection) wins over DATABASE_URL, so the app
 * can use a pooled URL while migrations use a direct one.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadServiceEnv() {
  // Testability switch: the CLI tests run these scripts against throwaway
  // databases and must never load the developer's real .env.
  if (process.env.MOLECULESTUDIO_SKIP_DOTENV === "1") {
    // Never allowed to silently change behaviour in production.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "MOLECULESTUDIO_SKIP_DOTENV=1 is a test-only switch and is refused when NODE_ENV=production. Unset it.",
      );
    }
    return;
  }
  dotenv.config({ path: path.join(serviceRoot, ".env") });
}

export function databaseName() {
  return process.env.DB_NAME?.trim() || "molecule_studio_db";
}

function composeFromParts(dbName) {
  const user = encodeURIComponent(process.env.DB_USER?.trim() || "postgres");
  const password = encodeURIComponent(process.env.DB_PASSWORD?.trim() || "postgres_dev_password");
  const host = process.env.DB_HOST?.trim() || "localhost";
  const port = process.env.DB_PORT?.trim() || "5432";
  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

/** URL of the application database used for migrations. */
export function resolveMigrationUrl() {
  return (
    process.env.MIGRATION_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    composeFromParts(databaseName())
  );
}

/** Same server, `postgres` maintenance database (for CREATE/DROP DATABASE). */
export function adminUrlFor(appUrl) {
  const parsed = new URL(appUrl);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

export function flag(name) {
  return process.argv.includes(name);
}
