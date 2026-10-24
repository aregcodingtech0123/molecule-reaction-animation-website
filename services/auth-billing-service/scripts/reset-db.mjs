/**
 * Destructive LOCAL reset: DROP + CREATE the database, then re-apply all
 * migrations. Refuses anything that is not a local Postgres host
 * (localhost / 127.0.0.1 / ::1 / docker service names) — no override.
 *
 * Usage: node scripts/reset-db.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { adminUrlFor, loadServiceEnv, resolveMigrationUrl, serviceRoot } from "./lib/cli-env.mjs";
import { assertLocalDatabaseUrl } from "./lib/db-safety.mjs";

loadServiceEnv();

const appUrl = resolveMigrationUrl();

let target;
try {
  target = assertLocalDatabaseUrl(appUrl);
} catch (err) {
  console.error(`Refusing to reset: ${err.message}`);
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to reset: NODE_ENV=production.");
  process.exit(1);
}

const dbName = target.database;
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
  throw new Error(`Unsafe database name: ${dbName}`);
}

const client = new pg.Client({ connectionString: adminUrlFor(appUrl) });
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

const child = spawn(process.execPath, [path.join(serviceRoot, "scripts", "setup-db.mjs")], {
  cwd: serviceRoot,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
