/**
 * Creates molecule_studio_db (if missing) and applies all database/init/*.sql
 * migrations in order (001 → 005). Retries until Postgres accepts connections
 * so it works right after `docker compose up -d`.
 *
 * Usage: node scripts/setup-db.mjs
 */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(serviceRoot, ".env") });

const dbName = process.env.DB_NAME?.trim() || "molecule_studio_db";
const MAX_ATTEMPTS = 30;
const RETRY_MS = 1000;

function resolveAdminUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    // Swap path to /postgres for CREATE DATABASE (works for local Docker).
    // On Supabase the app DB is usually already `postgres` — create is a no-op.
    try {
      const parsed = new URL(url);
      parsed.pathname = "/postgres";
      return parsed.toString();
    } catch {
      return url.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
    }
  }

  const user = encodeURIComponent(process.env.DB_USER?.trim() || "postgres");
  const password = encodeURIComponent(process.env.DB_PASSWORD?.trim() || "postgres_dev_password");
  const host = process.env.DB_HOST?.trim() || "localhost";
  const port = process.env.DB_PORT?.trim() || "5432";
  return `postgresql://${user}:${password}@${host}:${port}/postgres`;
}

function resolveAppUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  const user = encodeURIComponent(process.env.DB_USER?.trim() || "postgres");
  const password = encodeURIComponent(process.env.DB_PASSWORD?.trim() || "postgres_dev_password");
  const host = process.env.DB_HOST?.trim() || "localhost";
  const port = process.env.DB_PORT?.trim() || "5432";
  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

function assertSafeDbName(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe DB_NAME: ${name}`);
  }
}

async function waitForPostgres(connectionString) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      if (attempt > 1) {
        console.log(`PostgreSQL ready after ${attempt} attempt(s).`);
      }
      return;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => undefined);
      console.log(`Waiting for PostgreSQL… (${attempt}/${MAX_ATTEMPTS})`);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
  throw lastError ?? new Error("PostgreSQL did not become ready in time.");
}

const initSqlFiles = [
  path.resolve(serviceRoot, "../../database/init/001_moleculestudio_core.sql"),
  path.resolve(serviceRoot, "../../database/init/002_user_profile_fields.sql"),
  path.resolve(serviceRoot, "../../database/init/003_dual_payment_providers.sql"),
  path.resolve(serviceRoot, "../../database/init/004_email_verification.sql"),
  path.resolve(serviceRoot, "../../database/init/005_oauth_and_token_revocation.sql"),
];

assertSafeDbName(dbName);

const adminUrl = resolveAdminUrl();
const appUrl = resolveAppUrl();

console.log(`Target database: ${dbName}`);
await waitForPostgres(adminUrl);

const adminClient = new pg.Client({ connectionString: adminUrl });
try {
  await adminClient.connect();
  const exists = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);

  if (exists.rowCount === 0) {
    await adminClient.query(`CREATE DATABASE ${dbName}`);
    console.log(`Created database: ${dbName}`);
  } else {
    console.log(`Database already exists: ${dbName}`);
  }
} finally {
  await adminClient.end();
}

const pool = new pg.Pool({ connectionString: appUrl });

for (const initSqlPath of initSqlFiles) {
  if (!fs.existsSync(initSqlPath)) {
    console.warn("Schema file not found:", initSqlPath);
    continue;
  }
  const sql = fs.readFileSync(initSqlPath, "utf8");
  await pool.query(sql);
  console.log("Applied schema:", path.basename(initSqlPath));
}

const probe = await pool.query("SELECT NOW() AS server_time, current_database() AS db");
console.log("Connection OK:", probe.rows[0]);
await pool.end();
