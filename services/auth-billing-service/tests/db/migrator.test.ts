/**
 * The tracked migration runner (scripts/lib/migrator.mjs) — FINDING-01/02.
 * Every database here is a throwaway `mst_scratch_*_test` database.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../../../../scripts/test/prepare-test-db.mjs";
import { DEFAULT_MIGRATIONS_DIR, listMigrations, migrate, migrationStatus } from "../../scripts/lib/migrator.mjs";
import { createUser } from "../support/db";
import { expectPgError } from "../support/pg-error";
import { schemaFingerprint } from "../support/schema";
import { ScratchDb, allMigrations, migrationsByPrefix } from "../support/scratch-db";

const ALL = listMigrations().map((m: { filename: string }) => m.filename);

async function withScratch<T>(fn: (db: ScratchDb) => Promise<T>, opts?: Parameters<typeof ScratchDb.create>[0]) {
  const db = await ScratchDb.create(opts);
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

/** Copy of database/init in a temp dir, so tests can add/edit/remove migration files. */
function tempMigrationsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mst-migrations-"));
  for (const f of fs.readdirSync(DEFAULT_MIGRATIONS_DIR)) {
    fs.copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(dir, f));
  }
  return dir;
}

async function trackedRows(db: ScratchDb) {
  const { rows } = await db.pool.query(`SELECT filename, baselined FROM schema_migrations ORDER BY filename`);
  return rows;
}

const hasTrackingTable = async (db: ScratchDb) =>
  (await db.pool.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`)).rows[0].ok;

describe("fresh databases", () => {
  it("applies everything once; a second run applies nothing and status reports all applied", () =>
    withScratch(async (db) => {
      const first = await migrate({ connectionString: db.url });
      expect(first).toEqual({ mode: "fresh", baselined: [], applied: ALL, pending: [] });

      const second = await migrate({ connectionString: db.url });
      expect(second).toEqual({ mode: "tracked", baselined: [], applied: [], pending: [] });

      const status = await migrationStatus({ connectionString: db.url });
      expect(status.every((s: { state: string }) => s.state === "applied")).toBe(true);
    }));

  it("records filename, a 64-char checksum, applied_at and execution time", () =>
    withScratch(async (db) => {
      await migrate({ connectionString: db.url });
      const { rows } = await db.pool.query(`SELECT checksum, applied_at, execution_ms FROM schema_migrations`);
      expect(rows).toHaveLength(ALL.length);
      for (const r of rows) {
        expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
        expect(r.applied_at).toBeInstanceOf(Date);
        expect(r.execution_ms).toBeGreaterThanOrEqual(0);
      }
    }));

  it("two runners started at the same time apply each migration exactly once (advisory lock)", () =>
    withScratch(async (db) => {
      const [a, b] = await Promise.all([migrate({ connectionString: db.url }), migrate({ connectionString: db.url })]);
      expect([...a.applied, ...b.applied].sort()).toEqual(ALL);
      expect(await trackedRows(db)).toHaveLength(ALL.length);
    }));

  it("refuses a pooled / pgbouncer URL before connecting", async () => {
    for (const url of [
      "postgresql://u:p@ep-cool-name-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require",
      "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
      "postgresql://u:p@db.example.com:5432/app?pgbouncer=true",
    ]) {
      await expect(migrate({ connectionString: url })).rejects.toMatchObject({ code: "POOLED_URL" });
    }
  });
});

describe("baselining a pre-runner database", () => {
  it("refuses an existing schema without --baseline and writes nothing", () =>
    withScratch(
      async (db) => {
        await expect(migrate({ connectionString: db.url })).rejects.toMatchObject({ code: "BASELINE_REQUIRED" });
        expect(await hasTrackingTable(db)).toBe(false);
      },
      { migrate: migrationsByPrefix("001", "002", "003", "004", "005") },
    ));

  it("a database built by the old db:setup (001→005): records 001–005 as baselined without re-running them, then applies the rest", () =>
    withScratch(
      async (db) => {
        // "Recorded without executing" is visible as execution_ms = NULL on baselined rows.
        const result = await migrate({ connectionString: db.url, baseline: true });
        expect(result.mode).toBe("baseline");
        expect(result.baselined).toEqual(ALL.slice(0, 5));
        expect(result.applied).toEqual(ALL.slice(5));

        const { rows } = await db.pool.query(`SELECT filename, baselined, execution_ms FROM schema_migrations ORDER BY filename`);
        expect(rows.slice(0, 5).every((r: { baselined: boolean; execution_ms: number | null }) => r.baselined && r.execution_ms === null)).toBe(true);
        expect(rows.slice(5).every((r: { baselined: boolean }) => !r.baselined)).toBe(true);

        // End state equals a database built fresh by the runner.
        await withScratch(async (fresh) => {
          await migrate({ connectionString: fresh.url });
          expect(await schemaFingerprint(db.pool)).toEqual(await schemaFingerprint(fresh.pool));
        });
      },
      { migrate: migrationsByPrefix("001", "002", "003", "004", "005") },
    ));

  it("a fully migrated legacy database (001→007): baselines 001–007 and applies only the new files", () =>
    withScratch(
      async (db) => {
        const result = await migrate({ connectionString: db.url, baseline: true });
        expect(result.baselined).toEqual(ALL.filter((f: string) => Number(f.slice(0, 3)) <= 7));
        expect(result.applied).toEqual(ALL.filter((f: string) => Number(f.slice(0, 3)) > 7));
      },
      { migrate: migrationsByPrefix("001", "002", "003", "004", "005", "006", "007") },
    ));

  it("preserves existing users, balances and ledger rows", () =>
    withScratch(
      async (db) => {
        const u = await createUser(db.pool, { balance: 0 });
        await db.pool.query(`SELECT post_credit_transaction($1, 50, 'CREDIT_PURCHASE', 'ls_order_1', 'lemonsqueezy')`, [u.id]);
        await migrate({ connectionString: db.url, baseline: true });
        const { rows } = await db.pool.query(
          `SELECT b.balance, (SELECT count(*)::int FROM credit_ledger_transactions WHERE user_id = $1) AS n
           FROM user_balances b WHERE user_id = $1`,
          [u.id],
        );
        expect(rows[0]).toEqual({ balance: 50, n: 1 });
      },
      { migrate: migrationsByPrefix("001", "002", "003", "004", "005") },
    ));

  it("--dry-run reports the plan and changes nothing", () =>
    withScratch(
      async (db) => {
        const before = await schemaFingerprint(db.pool);
        const plan = await migrate({ connectionString: db.url, baseline: true, dryRun: true });
        expect(plan.baselined).toEqual(ALL.slice(0, 5));
        expect(plan.pending).toEqual(ALL.slice(5));
        expect(plan.applied).toEqual([]);
        expect(await hasTrackingTable(db)).toBe(false);
        expect(await schemaFingerprint(db.pool)).toEqual(before);
      },
      { migrate: migrationsByPrefix("001", "002", "003", "004", "005") },
    ));

  it("an inconsistent schema (a later migration present after a missing one) aborts and writes nothing", () =>
    withScratch(
      async (db) => {
        await expect(migrate({ connectionString: db.url, baseline: true })).rejects.toMatchObject({ code: "INCONSISTENT_SCHEMA" });
        expect(await hasTrackingTable(db)).toBe(false);
      },
      // 005 skipped, 006/007 present
      { migrate: migrationsByPrefix("001", "002", "003", "004", "006", "007") },
    ));

  it("--baseline on an already tracked database is refused", () =>
    withScratch(async (db) => {
      await migrate({ connectionString: db.url });
      await expect(migrate({ connectionString: db.url, baseline: true })).rejects.toMatchObject({ code: "ALREADY_TRACKED" });
    }));
});

describe("drift and ordering guards", () => {
  it("an edited, already-applied migration (checksum change) blocks the run", () =>
    withScratch(async (db) => {
      const dir = tempMigrationsDir();
      await migrate({ connectionString: db.url, dir });
      fs.appendFileSync(path.join(dir, "004_email_verification.sql"), "\n-- edited later\n");
      await expect(migrate({ connectionString: db.url, dir })).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    }));

  it("line-ending changes alone are not drift (CRLF/LF normalised)", () =>
    withScratch(async (db) => {
      const dir = tempMigrationsDir();
      await migrate({ connectionString: db.url, dir });
      const f = path.join(dir, "002_user_profile_fields.sql");
      const text = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
      fs.writeFileSync(f, text.includes("\r\n") ? text : text.replace(/\n/g, "\r\n"));
      await expect(migrate({ connectionString: db.url, dir })).resolves.toMatchObject({ applied: [] });
    }));

  it("an applied migration missing from disk blocks the run", () =>
    withScratch(async (db) => {
      const dir = tempMigrationsDir();
      await migrate({ connectionString: db.url, dir });
      fs.rmSync(path.join(dir, "005_oauth_and_token_revocation.sql"));
      await expect(migrate({ connectionString: db.url, dir })).rejects.toMatchObject({ code: "MISSING_FILE" });
    }));

  it("a new file sorting BEFORE an applied one (a gap) blocks the run", () =>
    withScratch(async (db) => {
      const dir = tempMigrationsDir();
      await migrate({ connectionString: db.url, dir });
      fs.writeFileSync(path.join(dir, "005_zz_late_insert.sql"), "SELECT 1;");
      await expect(migrate({ connectionString: db.url, dir })).rejects.toMatchObject({ code: "GAP" });
    }));
});

describe("new-style migrations (008+) are atomic", () => {
  it("a failing migration rolls back completely and is not recorded", () =>
    withScratch(async (db) => {
      const dir = tempMigrationsDir();
      await migrate({ connectionString: db.url, dir });
      fs.writeFileSync(
        path.join(dir, "998_partial.sql"),
        "CREATE TABLE half_done (id int);\nSELECT this_function_does_not_exist();",
      );
      await expect(migrate({ connectionString: db.url, dir })).rejects.toBeDefined();
      const { rows } = await db.pool.query(`SELECT to_regclass('public.half_done') IS NULL AS gone`);
      expect(rows[0].gone).toBe(true);
      expect((await trackedRows(db)).map((r: { filename: string }) => r.filename)).not.toContain("998_partial.sql");
    }));

  it("a new migration that manages its own transaction is rejected", () =>
    withScratch(async (db) => {
      const dir = tempMigrationsDir();
      await migrate({ connectionString: db.url, dir });
      fs.writeFileSync(path.join(dir, "999_own_tx.sql"), "BEGIN;\nCREATE TABLE x (id int);\nCOMMIT;");
      await expect(migrate({ connectionString: db.url, dir })).rejects.toMatchObject({ code: "OWN_TRANSACTION" });
    }));

  it("a dry run on a tracked database lists only the pending files", () =>
    withScratch(async (db) => {
      const dir = tempMigrationsDir();
      await migrate({ connectionString: db.url, dir });
      fs.writeFileSync(path.join(dir, "997_new.sql"), "CREATE TABLE later_table (id int);");
      const plan = await migrate({ connectionString: db.url, dir, dryRun: true });
      expect(plan.pending).toEqual(["997_new.sql"]);
      const { rows } = await db.pool.query(`SELECT to_regclass('public.later_table') IS NULL AS absent`);
      expect(rows[0].absent).toBe(true);
    }));
});

describe("each legacy migration 001–007 is individually re-runnable after the FINDING-02 fix", () => {
  const legacy = allMigrations().filter((f: string) => Number(path.basename(f).slice(0, 3)) <= 7);

  it.each(legacy.map((f: string) => [path.basename(f), f]))(
    "%s re-runs on a fully migrated database without error, without schema change, and the money path still works",
    (_name, file) =>
      withScratch(async (db) => {
        await migrate({ connectionString: db.url });
        const before = await schemaFingerprint(db.pool);

        // 003 re-creates post_credit_transaction() from its frozen text, which resets the SEC-12
        // attributes; the documented recovery is to re-run 012 right after it.
        const rerun = path.basename(file).startsWith("003_") ? [file, ...migrationsByPrefix("012")] : [file];
        await applyMigrations(db.url, rerun);
        await applyMigrations(db.url, rerun);

        expect(await schemaFingerprint(db.pool)).toEqual(before);
        const u = await createUser(db.pool, { balance: 0 });
        await db.pool.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
        await db.pool.query(`SELECT post_credit_transaction($1, -3, 'CREDIT_CONSUMPTION', 't1')`, [u.id]);
        const { rows } = await db.pool.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [u.id]);
        expect(rows[0].balance).toBe(7);
        // The 008 guard is still in force after the re-run.
        await expectPgError(db.pool.query(`UPDATE user_balances SET balance = 999 WHERE user_id = $1`, [u.id]), "55000");
      }),
  );
});
