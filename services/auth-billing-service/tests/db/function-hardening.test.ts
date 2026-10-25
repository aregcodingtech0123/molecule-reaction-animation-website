/**
 * SEC-12: database functions resolve names through a pinned search_path, and the ledger writer
 * runs with its owner's rights (so a least-privilege app role can call it without being able to
 * write the ledger or balances itself — see database/roles/app-role.sql).
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestPool, createUser } from "../support/db";
import { applyMigrations } from "../../../../scripts/test/prepare-test-db.mjs";
import { ScratchDb, migrationsByPrefix } from "../support/scratch-db";

let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
});

/** Project functions in `public` (pgcrypto's functions belong to the extension and are excluded). */
async function projectFunctions(pool: pg.Pool) {
  const { rows } = await pool.query(`
    SELECT p.oid::regprocedure::text AS fn, p.prosecdef AS definer, coalesce(p.proconfig, '{}') AS config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 1`);
  return rows as Array<{ fn: string; definer: boolean; config: string[] }>;
}

describe("function hardening (SEC-12)", () => {
  it("every project function that touches a relation pins search_path to public, pg_temp", async () => {
    const fns = await projectFunctions(db);
    expect(fns.map((f) => f.fn)).toEqual([
      "expire_stale_checkout_orders(interval)",
      "guard_user_balance_write()",
      "ledger_reconciliation()",
      "post_credit_transaction(uuid,integer,credit_transaction_type,character varying,character varying)",
      "prevent_ledger_mutation()",
      "release_expired_ai_holds()",
      "set_updated_at()",
    ]);
    // The two 001 triggers reference no relation and run with the caller's rights; 001 is frozen.
    expect(fns.filter((f) => !f.config.includes("search_path=public, pg_temp")).map((f) => f.fn)).toEqual([
      "prevent_ledger_mutation()",
      "set_updated_at()",
    ]);
  });

  it("post_credit_transaction() is SECURITY DEFINER (the only one)", async () => {
    const fns = await projectFunctions(db);
    expect(fns.filter((f) => f.definer).map((f) => f.fn)).toEqual([
      "post_credit_transaction(uuid,integer,credit_transaction_type,character varying,character varying)",
    ]);
  });

  it("post_credit_transaction() is not executable by PUBLIC (only its owner and roles granted it)", async () => {
    const { rows } = await db.query(`
      SELECT has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
             has_function_privilege(p.proowner, p.oid, 'EXECUTE') AS owner_exec
      FROM pg_proc p WHERE p.proname = 'post_credit_transaction'`);
    expect(rows).toEqual([{ public_exec: false, owner_exec: true }]);
  });

  it("re-running 003 by hand drops the attributes; re-running 012 restores them", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const attrs = async () =>
        (await scratch.pool.query(
          `SELECT prosecdef, proconfig, has_function_privilege('public', oid, 'EXECUTE') AS public_exec
           FROM pg_proc WHERE proname = 'post_credit_transaction'`,
        )).rows;
      const hardened = await attrs();
      expect(hardened).toEqual([{ prosecdef: true, proconfig: ["search_path=public, pg_temp"], public_exec: false }]);

      await applyMigrations(scratch.url, migrationsByPrefix("003"));
      // CREATE OR REPLACE resets SECURITY/SET (the ACL is kept): 003 is frozen, so 012 must follow it.
      expect(await attrs()).toEqual([{ prosecdef: false, proconfig: null, public_exec: false }]);

      await applyMigrations(scratch.url, migrationsByPrefix("012"));
      expect(await attrs()).toEqual(hardened);
    } finally {
      await scratch.destroy();
    }
  });

  it("a caller's search_path cannot redirect ledger writes into look-alike tables", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    const client = await scratch.pool.connect();
    try {
      const user = await createUser(scratch.pool, { balance: 0 });
      await client.query(`CREATE SCHEMA hijack`);
      await client.query(`CREATE TABLE hijack.user_balances (LIKE public.user_balances INCLUDING ALL)`);
      await client.query(`CREATE TABLE hijack.credit_ledger_transactions (LIKE public.credit_ledger_transactions INCLUDING DEFAULTS)`);
      await client.query(`SET search_path TO hijack, public`);
      await client.query(`SELECT post_credit_transaction($1, 7, 'SIGNUP_BONUS', 'hijack-test', NULL)`, [user.id]).catch(() => undefined);
      await client.query(`RESET search_path`);
      const real = await client.query(`SELECT balance FROM public.user_balances WHERE user_id = $1`, [user.id]);
      const fake = await client.query(`SELECT count(*)::int AS n FROM hijack.user_balances`);
      expect(fake.rows[0].n).toBe(0);
      expect(real.rows[0].balance).toBe(7);
    } finally {
      client.release();
      await scratch.destroy();
    }
  });
});
