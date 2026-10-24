/**
 * Creates the database (if missing) and applies every database/init/NNN_*.sql
 * migration through the tracked runner (scripts/lib/migrator.mjs).
 * Retries until Postgres accepts connections so it works right after
 * `docker compose up -d`.
 *
 * Usage: node scripts/setup-db.mjs [--baseline] [--dry-run]
 *   An existing database created before the runner existed must be adopted
 *   once with --baseline (see docs/ops/PRODUCTION_RUNBOOK.md).
 */
import pg from "pg";
import { adminUrlFor, databaseName, flag, loadServiceEnv, resolveMigrationUrl } from "./lib/cli-env.mjs";
import { migrate } from "./lib/migrator.mjs";

loadServiceEnv();

const MAX_ATTEMPTS = 30;
const RETRY_MS = 1000;

const appUrl = resolveMigrationUrl();
const dbName = decodeURIComponent(new URL(appUrl).pathname.slice(1)) || databaseName();
const adminUrl = adminUrlFor(appUrl);

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
  throw new Error(`Unsafe database name: ${dbName}`);
}

async function waitForPostgres(connectionString) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      if (attempt > 1) console.log(`PostgreSQL ready after ${attempt} attempt(s).`);
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
} catch (err) {
  // Hosted databases usually forbid CREATE DATABASE; the app DB already exists there.
  console.warn(`Skipping database creation: ${err.message}`);
} finally {
  await adminClient.end().catch(() => undefined);
}

try {
  const result = await migrate({
    connectionString: appUrl,
    baseline: flag("--baseline"),
    dryRun: flag("--dry-run"),
    log: (m) => console.log(`[migrate] ${m}`),
  });
  console.log(
    `Migrations: mode=${result.mode} baselined=${result.baselined.length} applied=${result.applied.length}` +
      (result.pending.length ? ` pending=${result.pending.join(",")}` : ""),
  );
} catch (err) {
  console.error(`Migration FAILED (${err.code ?? "error"}): ${err.message}`);
  process.exit(1);
}
