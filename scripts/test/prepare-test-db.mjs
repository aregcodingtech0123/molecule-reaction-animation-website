/**
 * Drop + recreate the (guarded) test database and apply every migration in
 * database/init in lexical order. Used by Vitest global setups, the E2E
 * launcher, and CI. Usage as a CLI: `node scripts/test/prepare-test-db.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { assertTestDatabaseUrl, resolveTestDatabaseUrl } from "./db-guard.mjs";
import { migrate } from "../../services/auth-billing-service/scripts/lib/migrator.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MIGRATIONS_DIR = path.join(repoRoot, "database", "init");

// `pg` lives in the service's node_modules (always installed) and in the root
// devDependencies; resolve from the service so this works in either job.
const requireFromService = createRequire(
  path.join(repoRoot, "services", "auth-billing-service", "package.json"),
);
const pg = requireFromService("pg");

export function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

function adminUrlFor(url) {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function waitForPostgres(url, attempts = 30) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await withClient(adminUrlFor(url), (c) => c.query("SELECT 1"));
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`[prepare-test-db] Postgres not reachable at ${new URL(url).host}: ${lastErr?.message}`);
}

/** Create an empty database (guarded name) — drops it first if it exists. */
export async function recreateDatabase(url) {
  const { database } = assertTestDatabaseUrl(url);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(database)) {
    throw new Error(`[prepare-test-db] Unsafe database name: ${database}`);
  }
  await withClient(adminUrlFor(url), async (c) => {
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [database],
    );
    await c.query(`DROP DATABASE IF EXISTS ${database}`);
    await c.query(`CREATE DATABASE ${database}`);
  });
}

export async function dropDatabase(url) {
  const { database } = assertTestDatabaseUrl(url);
  await withClient(adminUrlFor(url), async (c) => {
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [database],
    );
    await c.query(`DROP DATABASE IF EXISTS ${database}`);
  });
}

/**
 * Apply migration files RAW (no tracking) — each file sent as one multi-statement query.
 * Only for tests that must reproduce pre-runner databases or re-run individual files.
 */
export async function applyMigrations(url, files = listMigrationFiles()) {
  assertTestDatabaseUrl(url);
  await withClient(url, async (c) => {
    for (const file of files) {
      await c.query(fs.readFileSync(file, "utf8"));
    }
  });
}

/**
 * Fresh guarded DB built by the SAME tracked runner `npm run db:setup` uses,
 * so every suite runs against the production migration path.
 */
export async function prepareTestDatabase(url = resolveTestDatabaseUrl()) {
  assertTestDatabaseUrl(url);
  await waitForPostgres(url);
  await recreateDatabase(url);
  await migrate({ connectionString: url });
  return url;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const url = await prepareTestDatabase();
  console.log(`[prepare-test-db] Ready: ${new URL(url).host}${new URL(url).pathname}`);
}
