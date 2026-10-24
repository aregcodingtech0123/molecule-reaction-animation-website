import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../../../scripts/test/prepare-test-db.mjs";
import { migrate } from "../../scripts/lib/migrator.mjs";
import { ScratchDb, allMigrations, migrationsByPrefix } from "../support/scratch-db";
import { createUser } from "../support/db";
import { expectPgError } from "../support/pg-error";

/** Stable fingerprint of the schema objects the migrations own. */
async function schemaFingerprint(db: ScratchDb) {
  const q = (sql: string) => db.pool.query(sql).then((r) => r.rows);
  return {
    columns: await q(`
      SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, column_name`),
    indexes: await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`),
    functions: await q(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' ORDER BY 1, 2`),
    enumLabels: await q(`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'credit_transaction_type' ORDER BY e.enumsortorder`),
    triggers: await q(`
      SELECT tgname, tgrelid::regclass::text AS tbl FROM pg_trigger
      WHERE NOT tgisinternal ORDER BY tgname`),
    constraints: await q(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace ORDER BY conname`),
  };
}

describe("migrations 001→007 on an empty database", () => {
  let db: ScratchDb;

  beforeAll(async () => {
    db = await ScratchDb.create({ migrate: false });
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it("finds exactly the expected migration files in lexical order", () => {
    const names = allMigrations().map((f: string) => path.basename(f));
    expect(names).toEqual([
      "001_moleculestudio_core.sql",
      "002_user_profile_fields.sql",
      "003_dual_payment_providers.sql",
      "004_email_verification.sql",
      "005_oauth_and_token_revocation.sql",
      "006_ai_credit_metering.sql",
      "007_ai_credit_metering_idempotency.sql",
      "008_ledger_hardening.sql",
      "009_ai_credit_holds.sql",
    ]);
  });

  it("applies cleanly in order", async () => {
    await expect(applyMigrations(db.url)).resolves.toBeUndefined();
  });

  it("creates every table the service queries", async () => {
    const { rows } = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "ai_credit_holds",
      "credit_ledger_transactions",
      "oauth_accounts",
      "password_reset_tokens",
      "pending_checkout_orders",
      "revoked_tokens",
      "user_balances",
      "users",
      "verification_tokens",
    ]);
  });

  it("leaves exactly one post_credit_transaction overload (the 5-arg provider-aware one)", async () => {
    const fp = await schemaFingerprint(db);
    const overloads = fp.functions.filter((f) => f.proname === "post_credit_transaction");
    expect(overloads).toEqual([
      {
        proname: "post_credit_transaction",
        args: "p_user_id uuid, p_amount integer, p_transaction_type credit_transaction_type, p_reference_id character varying, p_provider character varying",
      },
    ]);
  });

  it("registers all ledger transaction types including the AI metering labels", async () => {
    const fp = await schemaFingerprint(db);
    expect(fp.enumLabels.map((e) => e.enumlabel)).toEqual([
      "SIGNUP_BONUS",
      "STRIPE_PURCHASE",
      "AI_GENERATION_DEDUCTION",
      "ADMIN_ADJUSTMENT",
      "REFUND",
      "CREDIT_PURCHASE",
      "CREDIT_CONSUMPTION",
      "CREDIT_REFUND",
    ]);
  });

  it("creates the idempotency indexes for purchases and AI operations", async () => {
    const fp = await schemaFingerprint(db);
    const names = fp.indexes.map((i) => i.indexname);
    expect(names).toContain("uq_credit_ledger_provider_reference");
    expect(names).toContain("uq_credit_ledger_ai_operation");
    expect(names).toContain("uq_users_email_lower");
  });

  // FINDING-02 (High): re-running 001 after 003 re-creates the legacy 4-arg overload, then
  // `COMMENT ON FUNCTION post_credit_transaction IS …` (no arg list) fails with 42725
  // "function name is not unique". db:setup aborts at 001, so the sequence is NOT re-runnable
  // even though every file header says "safe to re-run".
  it("is idempotent: re-running 001→007 succeeds and leaves the schema unchanged (FINDING-02)", async () => {
    const before = await schemaFingerprint(db);
    await applyMigrations(db.url);
    const after = await schemaFingerprint(db);
    expect(after).toEqual(before);
  });

  it("re-running 001 alone on a fully migrated database is a no-op (FINDING-02 fixed)", async () => {
    const before = await schemaFingerprint(db);
    await expect(applyMigrations(db.url, migrationsByPrefix("001"))).resolves.toBeUndefined();
    expect(await schemaFingerprint(db)).toEqual(before);
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'post_credit_transaction'`);
    expect(rows[0].n).toBe(1);
  });

  it("re-running 002→007 is idempotent and leaves the schema unchanged", async () => {
    const before = await schemaFingerprint(db);
    await applyMigrations(db.url, migrationsByPrefix("002", "003", "004", "005", "006", "007"));
    await applyMigrations(db.url, migrationsByPrefix("002", "003", "004", "005", "006", "007"));
    expect(await schemaFingerprint(db)).toEqual(before);
  });

  it("preserves existing balances and ledger rows when 002→007 are re-run on a populated database", async () => {
    const user = await createUser(db.pool, { balance: 0 });
    await db.pool.query(`SELECT post_credit_transaction($1, 25, 'CREDIT_PURCHASE', 'ls_order_mig', 'lemonsqueezy')`, [user.id]);
    await db.pool.query(`SELECT post_credit_transaction($1, -5, 'CREDIT_CONSUMPTION', 'turn-1')`, [user.id]);

    await applyMigrations(db.url, migrationsByPrefix("002", "003", "004", "005", "006", "007"));

    const bal = await db.pool.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [user.id]);
    const rows = await db.pool.query(`SELECT count(*)::int AS n FROM credit_ledger_transactions WHERE user_id = $1`, [user.id]);
    expect(bal.rows[0].balance).toBe(20);
    expect(rows.rows[0].n).toBe(2);
  });

  it("004 grandfathers only users who already received a signup bonus", async () => {
    const scratch = await ScratchDb.create({ migrate: migrationsByPrefix("001", "002", "003") });
    try {
      const withBonus = await scratch.pool.query(
        `INSERT INTO users (email, password_hash) VALUES ('old1@example.test', 'x') RETURNING id`,
      );
      const withoutBonus = await scratch.pool.query(
        `INSERT INTO users (email, password_hash) VALUES ('old2@example.test', 'x') RETURNING id`,
      );
      await scratch.pool.query(`INSERT INTO user_balances (user_id, balance) VALUES ($1, 0), ($2, 0)`, [
        withBonus.rows[0].id,
        withoutBonus.rows[0].id,
      ]);
      await scratch.pool.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [withBonus.rows[0].id]);

      await applyMigrations(scratch.url, migrationsByPrefix("004", "005", "006", "007"));

      const { rows } = await scratch.pool.query(`SELECT email, is_verified FROM users ORDER BY email`);
      expect(rows).toEqual([
        { email: "old1@example.test", is_verified: true },
        { email: "old2@example.test", is_verified: false },
      ]);
    } finally {
      await scratch.destroy();
    }
  });
});

describe("migration edge cases", () => {
  it("006 and 007 cannot be merged into one transaction (enum label used before commit)", async () => {
    // Guards the reason the files are split: if someone concatenates them, PG refuses.
    const scratch = await ScratchDb.create({ migrate: migrationsByPrefix("001", "002", "003", "004", "005") });
    try {
      const sql006 = fs.readFileSync(migrationsByPrefix("006")[0], "utf8").replace(/COMMIT;\s*$/m, "");
      const sql007 = fs.readFileSync(migrationsByPrefix("007")[0], "utf8").replace(/^BEGIN;/m, "");
      await expectPgError(scratch.pool.query(sql006 + "\n" + sql007), "55P04");
    } finally {
      await scratch.destroy();
    }
  });

  it("root cause of FINDING-02: with both overloads present a 4-arg call is ambiguous — and the fixed 001 never creates the 2nd overload", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      // Inline fixture of the legacy 4-arg signature (the fixed 001 no longer re-creates it).
      await scratch.pool.query(`
        CREATE FUNCTION post_credit_transaction(p_user_id UUID, p_amount INTEGER,
          p_transaction_type credit_transaction_type, p_reference_id VARCHAR DEFAULT NULL)
        RETURNS BIGINT LANGUAGE sql AS $fx$ SELECT 0::bigint $fx$`);
      const user = await createUser(scratch.pool, { balance: 0 });
      await expectPgError(
        scratch.pool.query(`SELECT post_credit_transaction($1::uuid, 10, 'SIGNUP_BONUS'::credit_transaction_type, 'signup'::varchar)`, [user.id]),
        "42725",
      );
    } finally {
      await scratch.destroy();
    }
  });

  it("001 creates the legacy overload only on an empty database and comments it by full signature", () => {
    const sql001 = fs.readFileSync(migrationsByPrefix("001")[0], "utf8");
    expect(sql001).toMatch(/IF NOT EXISTS \([\s\S]*proname = 'post_credit_transaction'[\s\S]*\) THEN[\s\S]*CREATE FUNCTION post_credit_transaction\(/);
    expect(sql001).not.toMatch(/COMMENT ON FUNCTION post_credit_transaction IS/);
    expect(sql001).toMatch(/COMMENT ON FUNCTION post_credit_transaction\(UUID, INTEGER, credit_transaction_type, VARCHAR\) IS/);
  });
});

describe("db:setup applies every migration through the tracked runner (FINDING-01)", () => {
  const setupScript = fs.readFileSync(new URL("../../scripts/setup-db.mjs", import.meta.url), "utf8");
  const names = () => allMigrations().map((f: string) => path.basename(f));

  it("setup-db.mjs no longer hard-codes a migration list; it delegates to the runner", () => {
    expect([...setupScript.matchAll(/database\/init\/\d{3}_/g)]).toHaveLength(0);
    expect(setupScript).toMatch(/import \{ migrate \} from "\.\/lib\/migrator\.mjs"/);
  });

  it("applies every migration file in database/init, in order, and records each (FINDING-01)", async () => {
    const scratch = await ScratchDb.create();
    try {
      const result = await migrate({ connectionString: scratch.url });
      expect(result.mode).toBe("fresh");
      expect(result.applied).toEqual(names());
      const { rows } = await scratch.pool.query(`SELECT filename, baselined FROM schema_migrations ORDER BY filename`);
      expect(rows).toEqual(names().map((filename) => ({ filename, baselined: false })));
    } finally {
      await scratch.destroy();
    }
  });

  it("a database built by the runner records AI usage (impact of FINDING-01 is gone)", async () => {
    const scratch = await ScratchDb.create();
    try {
      await migrate({ connectionString: scratch.url });
      const user = await createUser(scratch.pool, { balance: 0 });
      await scratch.pool.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [user.id]);
      await scratch.pool.query(
        `SELECT post_credit_transaction($1, -1, 'CREDIT_CONSUMPTION'::credit_transaction_type, 'turn-1')`,
        [user.id],
      );
      const { rows } = await scratch.pool.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [user.id]);
      expect(rows[0].balance).toBe(9);
    } finally {
      await scratch.destroy();
    }
  });
});
