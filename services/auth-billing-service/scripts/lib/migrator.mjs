/**
 * Minimal, dependency-free migration runner for database/init/NNN_*.sql.
 *
 *  - Applies every migration file in lexical order and records it in
 *    `schema_migrations` (filename, checksum, applied_at, execution_ms, baselined).
 *  - Uses ONE direct (non-pooled) connection and holds a session-level
 *    advisory lock for the whole run, so concurrent runners serialise.
 *  - Legacy files 001–007 manage their own BEGIN/COMMIT and are idempotent:
 *    they run verbatim, then are recorded. Files 008+ must not contain
 *    BEGIN/COMMIT; the runner wraps file + record in one transaction (atomic).
 *  - Refuses to start on drift: changed checksum, missing applied file, or a
 *    gap (a later file applied while an earlier one is not).
 *  - Baseline mode adopts a pre-runner database: it probes the catalog for what
 *    001–007 created and records those files WITHOUT executing them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isPooledConnectionUrl } from "./db-safety.mjs";

export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../database/init",
);

/** Arbitrary fixed key for pg_advisory_lock — "molecule studio migrations". */
export const MIGRATION_LOCK_KEY = 7_302_215_847_263;
/** Files numbered at or below this manage their own transactions (pre-runner convention). */
export const LAST_LEGACY_MIGRATION = 7;

export class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

const TX_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;\s*$/im;

export function checksumOf(sql) {
  return crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export function listMigrations(dir = DEFAULT_MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((filename) => {
      const sql = fs.readFileSync(path.join(dir, filename), "utf8");
      const number = Number(filename.slice(0, 3));
      return { filename, number, sql, checksum: checksumOf(sql), legacy: number <= LAST_LEGACY_MIGRATION };
    });
}

/**
 * Catalog probes: "is the schema this file creates already present?".
 * Only files 001–007 can be baselined; anything newer always runs.
 */
const has = {
  table: (t) => `to_regclass('public.${t}') IS NOT NULL`,
  column: (t, c) =>
    `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t}' AND column_name = '${c}')`,
  enumLabel: (l) =>
    `EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'credit_transaction_type' AND e.enumlabel = '${l}')`,
  index: (i) => `to_regclass('public.${i}') IS NOT NULL`,
  trigger: (t) => `EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${t}' AND NOT tgisinternal)`,
  fn: (name, nargs) =>
    `EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${name}' AND p.pronargs = ${nargs})`,
};

export const BASELINE_PROBES = {
  "001_moleculestudio_core.sql": [
    has.table("users"),
    has.table("user_balances"),
    has.table("credit_ledger_transactions"),
    has.trigger("trg_credit_ledger_no_update"),
    has.trigger("trg_credit_ledger_no_delete"),
    has.fn("prevent_ledger_mutation", 0),
  ],
  "002_user_profile_fields.sql": ["first_name", "last_name", "date_of_birth", "is_admin"].map((c) => has.column("users", c)),
  "003_dual_payment_providers.sql": [
    has.enumLabel("CREDIT_PURCHASE"),
    has.table("pending_checkout_orders"),
    has.column("credit_ledger_transactions", "provider"),
    has.index("uq_credit_ledger_provider_reference"),
    has.fn("post_credit_transaction", 5),
  ],
  "004_email_verification.sql": [
    has.column("users", "is_verified"),
    has.table("verification_tokens"),
    has.table("password_reset_tokens"),
  ],
  "005_oauth_and_token_revocation.sql": [has.table("oauth_accounts"), has.table("revoked_tokens")],
  "006_ai_credit_metering.sql": [has.enumLabel("CREDIT_CONSUMPTION"), has.enumLabel("CREDIT_REFUND")],
  "007_ai_credit_metering_idempotency.sql": [has.index("uq_credit_ledger_ai_operation")],
};

async function probe(client, filename) {
  const checks = BASELINE_PROBES[filename];
  if (!checks) return false;
  const { rows } = await client.query(`SELECT (${checks.join(" AND ")}) AS present`);
  return rows[0].present === true;
}

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename     TEXT        PRIMARY KEY,
    checksum     CHAR(64)    NOT NULL,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    execution_ms INTEGER,
    baselined    BOOLEAN     NOT NULL DEFAULT false
  )`;

async function trackingTableExists(client) {
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`);
  return rows[0].ok;
}

async function appliedRows(client) {
  const { rows } = await client.query(`SELECT filename, checksum, baselined FROM schema_migrations ORDER BY filename`);
  return rows;
}

/** Compare the tracking table with the files on disk; throws on drift or gaps. */
function verifyHistory(files, applied) {
  const byName = new Map(files.map((f) => [f.filename, f]));
  for (const row of applied) {
    const file = byName.get(row.filename);
    if (!file) {
      throw new MigrationError("MISSING_FILE", `Applied migration ${row.filename} no longer exists on disk.`);
    }
    if (file.checksum !== row.checksum.trim()) {
      throw new MigrationError(
        "CHECKSUM_MISMATCH",
        `Migration ${row.filename} changed after it was applied (recorded ${row.checksum.slice(0, 12)}…, file ${file.checksum.slice(0, 12)}…). Add a new migration instead of editing an applied one.`,
      );
    }
  }
  const appliedSet = new Set(applied.map((r) => r.filename));
  let seenPending = null;
  for (const file of files) {
    if (!appliedSet.has(file.filename)) seenPending ??= file.filename;
    else if (seenPending) {
      throw new MigrationError("GAP", `Gap: ${file.filename} is applied but earlier ${seenPending} is not.`);
    }
  }
}

/**
 * Work out which legacy files a pre-runner database already contains.
 * Throws when the schema is inconsistent (a later file present after a missing one).
 */
export async function planBaseline(client, files) {
  const baselined = [];
  let firstMissing = null;
  for (const file of files) {
    const present = await probe(client, file.filename);
    if (present && firstMissing) {
      throw new MigrationError(
        "INCONSISTENT_SCHEMA",
        `Baseline aborted: ${file.filename} appears applied but ${firstMissing} does not. Inspect the schema manually.`,
      );
    }
    if (present) baselined.push(file);
    else firstMissing ??= file.filename;
  }
  return baselined;
}

async function applyFile(client, file) {
  const started = Date.now();
  if (file.legacy) {
    try {
      await client.query(file.sql);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
    await client.query(
      `INSERT INTO schema_migrations (filename, checksum, execution_ms) VALUES ($1, $2, $3)`,
      [file.filename, file.checksum, Date.now() - started],
    );
    return;
  }
  if (TX_CONTROL.test(file.sql)) {
    throw new MigrationError(
      "OWN_TRANSACTION",
      `${file.filename} contains BEGIN/COMMIT. Migrations after ${String(LAST_LEGACY_MIGRATION).padStart(3, "0")} are wrapped in a transaction by the runner.`,
    );
  }
  await client.query("BEGIN");
  try {
    await client.query(file.sql);
    await client.query(
      `INSERT INTO schema_migrations (filename, checksum, execution_ms) VALUES ($1, $2, $3)`,
      [file.filename, file.checksum, Date.now() - started],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/**
 * @param {{ connectionString: string, dir?: string, baseline?: boolean, dryRun?: boolean, log?: (m: string) => void }} options
 * @returns {Promise<{ mode: "fresh"|"tracked"|"baseline", baselined: string[], applied: string[], pending: string[] }>}
 */
export async function migrate({ connectionString, dir = DEFAULT_MIGRATIONS_DIR, baseline = false, dryRun = false, log = () => {} }) {
  if (!connectionString) throw new MigrationError("NO_URL", "No database URL given.");
  if (isPooledConnectionUrl(connectionString)) {
    throw new MigrationError(
      "POOLED_URL",
      "Refusing to migrate through a transaction pooler (pgbouncer / '-pooler' host / port 6543). Set MIGRATION_DATABASE_URL to the DIRECT connection string.",
    );
  }

  const files = listMigrations(dir);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK_KEY]);
    try {
      const tracked = await trackingTableExists(client);
      const { rows } = await client.query(`SELECT to_regclass('public.users') IS NOT NULL AS has_schema`);
      const hasSchema = rows[0].has_schema;

      let mode = "tracked";
      let baselined = [];

      if (!tracked && hasSchema) {
        if (!baseline) {
          throw new MigrationError(
            "BASELINE_REQUIRED",
            "This database has a schema but no schema_migrations table. Run once with --baseline (try --dry-run first) to adopt it.",
          );
        }
        mode = "baseline";
        baselined = await planBaseline(client, files);
        log(`baseline: ${baselined.length} existing migration(s) detected: ${baselined.map((f) => f.filename).join(", ") || "none"}`);
        if (!dryRun) {
          await client.query("BEGIN");
          try {
            await client.query(CREATE_TRACKING_TABLE);
            for (const file of baselined) {
              await client.query(
                `INSERT INTO schema_migrations (filename, checksum, baselined) VALUES ($1, $2, true)`,
                [file.filename, file.checksum],
              );
            }
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw err;
          }
        }
      } else if (tracked && baseline) {
        throw new MigrationError("ALREADY_TRACKED", "--baseline is only for databases without schema_migrations.");
      } else if (!tracked) {
        mode = "fresh";
        if (!dryRun) await client.query(CREATE_TRACKING_TABLE);
      }

      // A dry run must not create the tracking table, so an untracked database
      // is described by its (planned) baseline instead.
      const applied =
        tracked || !dryRun
          ? await appliedRows(client)
          : baselined.map((f) => ({ filename: f.filename, checksum: f.checksum }));
      verifyHistory(files, applied);

      const done = new Set(applied.map((r) => r.filename));
      const pending = files.filter((f) => !done.has(f.filename));
      if (dryRun) {
        log(`dry run: would apply ${pending.map((f) => f.filename).join(", ") || "nothing"}`);
        return { mode, baselined: baselined.map((f) => f.filename), applied: [], pending: pending.map((f) => f.filename) };
      }

      const appliedNow = [];
      for (const file of pending) {
        log(`applying ${file.filename}`);
        await applyFile(client, file);
        appliedNow.push(file.filename);
      }
      return { mode, baselined: baselined.map((f) => f.filename), applied: appliedNow, pending: [] };
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    await client.end();
  }
}

/** Read-only report of every file's state. */
export async function migrationStatus({ connectionString, dir = DEFAULT_MIGRATIONS_DIR }) {
  const files = listMigrations(dir);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const rows = (await trackingTableExists(client)) ? await appliedRows(client) : [];
    const byName = new Map(rows.map((r) => [r.filename, r]));
    return files.map((f) => {
      const row = byName.get(f.filename);
      if (!row) return { filename: f.filename, state: "pending" };
      if (row.checksum.trim() !== f.checksum) return { filename: f.filename, state: "checksum-mismatch" };
      return { filename: f.filename, state: row.baselined ? "baselined" : "applied" };
    });
  } finally {
    await client.end();
  }
}
