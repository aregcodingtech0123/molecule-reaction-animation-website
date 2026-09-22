/**
 * Destructive local reset: DROP + CREATE database, then re-apply all migrations.
 * Intended for Docker local only — refuse if DATABASE_URL looks like Supabase.
 *
 * Usage: node scripts/reset-db.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(serviceRoot, ".env") });

const dbName = process.env.DB_NAME?.trim() || "molecule_studio_db";
const databaseUrl = process.env.DATABASE_URL?.trim() || "";

if (/supabase\.co/i.test(databaseUrl) || process.env.NODE_ENV === "production") {
  console.error(
    "Refusing to reset: DATABASE_URL looks like Supabase/production. " +
      "Point .env at local Docker first (localhost:5432).",
  );
  process.exit(1);
}

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
  throw new Error(`Unsafe DB_NAME: ${dbName}`);
}

function resolveAdminUrl() {
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      parsed.pathname = "/postgres";
      return parsed.toString();
    } catch {
      return databaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
    }
  }
  const user = encodeURIComponent(process.env.DB_USER?.trim() || "postgres");
  const password = encodeURIComponent(process.env.DB_PASSWORD?.trim() || "postgres_dev_password");
  const host = process.env.DB_HOST?.trim() || "localhost";
  const port = process.env.DB_PORT?.trim() || "5432";
  return `postgresql://${user}:${password}@${host}:${port}/postgres`;
}

const adminUrl = resolveAdminUrl();
const client = new pg.Client({ connectionString: adminUrl });

await client.connect();
try {
  // Terminate sessions so DROP succeeds on a busy local DB.
  await client.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
  await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await client.query(`CREATE DATABASE ${dbName}`);
  console.log(`Reset database: ${dbName}`);
} finally {
  await client.end();
}

const setupScript = path.join(serviceRoot, "scripts", "setup-db.mjs");
const child = spawn(process.execPath, [setupScript], {
  cwd: serviceRoot,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
