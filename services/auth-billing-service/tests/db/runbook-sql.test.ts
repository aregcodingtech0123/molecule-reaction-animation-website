/**
 * The SQL in docs/ops/PRODUCTION_RUNBOOK.md, executed verbatim against throwaway
 * databases, so the owner never runs untested SQL against production.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate } from "../../scripts/lib/migrator.mjs";
import { createUser } from "../support/db";
import { ScratchDb } from "../support/scratch-db";

const runbook = fs.readFileSync(new URL("../../../../docs/ops/PRODUCTION_RUNBOOK.md", import.meta.url), "utf8");
const sqlBlocks = [...runbook.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1]!);
const [reconcileInline, abuseReport, , rollback0809] = sqlBlocks;

async function withRunnerDb<T>(fn: (db: ScratchDb) => Promise<T>) {
  const db = await ScratchDb.create();
  try {
    await migrate({ connectionString: db.url });
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

/** Ledger rows with chosen timestamps (INSERT is allowed; only UPDATE/DELETE/TRUNCATE are blocked). */
async function row(db: ScratchDb, userId: string, amount: number, type: string, ref: string, at: string) {
  await db.pool.query(
    `INSERT INTO credit_ledger_transactions (user_id, amount, transaction_type, reference_id, created_at)
     VALUES ($1, $2, $3::credit_transaction_type, $4, $5::timestamptz)`,
    [userId, amount, type, ref, at],
  );
}

describe("PRODUCTION_RUNBOOK.md SQL", () => {
  it("contains the four SQL blocks this test expects", () => {
    expect(sqlBlocks).toHaveLength(4);
    expect(abuseReport).toMatch(/CREDIT_REFUND/);
    expect(rollback0809).toMatch(/DROP TABLE IF EXISTS ai_credit_holds/);
  });

  it("§2 inline reconciliation runs and lists a drifted balance", () =>
    withRunnerDb(async (db) => {
      const u = await createUser(db.pool, { balance: 7 });
      const { rows } = await db.pool.query(reconcileInline!);
      expect(rows).toEqual([expect.objectContaining({ user_id: u.id, balance: 7, diff: "7" })]);
    }));

  it("§3 abuse report flags late self-refunds and high-volume refunders, not occasional server refunds", () =>
    withRunnerDb(async (db) => {
      const abuser = await createUser(db.pool, { email: "abuser@example.test" });
      const legit = await createUser(db.pool, { email: "legit@example.test" });
      const bulk = await createUser(db.pool, { email: "bulk@example.test" });
      const t = (min: number, sec = 0) => `2026-09-01T10:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}Z`;

      // Abuser: two successful turns refunded minutes later from the browser.
      await row(db, abuser.id, -1, "CREDIT_CONSUMPTION", "a1", t(0));
      await row(db, abuser.id, 1, "CREDIT_REFUND", "a1", t(7));
      await row(db, abuser.id, -1, "CREDIT_CONSUMPTION", "a2", t(10));
      await row(db, abuser.id, 1, "CREDIT_REFUND", "a2", t(15));
      // Legit: 1 of 2 turns failed, refunded by the server 4 s later.
      await row(db, legit.id, -1, "CREDIT_CONSUMPTION", "l1", t(0));
      await row(db, legit.id, 1, "CREDIT_REFUND", "l1", t(0, 4));
      await row(db, legit.id, -1, "CREDIT_CONSUMPTION", "l2", t(1));
      // Bulk: 6 turns, 4 refunded within seconds — suspicious by ratio.
      for (let i = 0; i < 6; i++) await row(db, bulk.id, -1, "CREDIT_CONSUMPTION", `b${i}`, t(20 + i));
      for (let i = 0; i < 4; i++) await row(db, bulk.id, 1, "CREDIT_REFUND", `b${i}`, t(20 + i, 5));

      const { rows } = await db.pool.query(abuseReport!);
      expect(rows.map((r) => r.email)).toEqual(["abuser@example.test", "bulk@example.test"]);
      expect(rows[0]).toMatchObject({ refunds: "2", late_refunds: "2", late_credits: "2", refund_pct: "100" });
      expect(rows[1]).toMatchObject({ consumptions: "6", refunds: "4", late_refunds: "0", refund_pct: "67" });
    }));

  it("§10.1 rollback of 008–013 leaves a working pre-008 database, and migrating again rolls forward cleanly", () =>
    withRunnerDb(async (db) => {
      await db.pool.query(rollback0809!);
      const status = await db.pool.query(`SELECT filename FROM schema_migrations ORDER BY 1`);
      expect(status.rows.map((r) => r.filename)).not.toContain("008_ledger_hardening.sql");
      expect((await db.pool.query(`SELECT to_regclass('public.ai_credit_holds') IS NULL AS gone`)).rows[0].gone).toBe(true);
      expect((await db.pool.query(`SELECT to_regprocedure('expire_stale_checkout_orders(interval)') IS NULL AS gone`)).rows[0].gone).toBe(true);
      expect((await db.pool.query(`SELECT to_regclass('public.lemon_order_refunds') IS NULL AS gone`)).rows[0].gone).toBe(true);
      const writer = await db.pool.query(
        `SELECT prosecdef, proconfig, has_function_privilege('public', oid, 'EXECUTE') AS public_exec
         FROM pg_proc WHERE proname = 'post_credit_transaction'`,
      );
      expect(writer.rows).toEqual([{ prosecdef: false, proconfig: null, public_exec: true }]);

      // Old-code money path still works, direct UPDATE is allowed again (pre-008 behaviour).
      const u = await createUser(db.pool, { balance: 0 });
      await db.pool.query(`SELECT post_credit_transaction($1, 5, 'SIGNUP_BONUS', 'signup')`, [u.id]);
      await db.pool.query(`SELECT post_credit_transaction($1, -1, 'CREDIT_CONSUMPTION', 't')`, [u.id]);
      await db.pool.query(`UPDATE user_balances SET balance = balance WHERE user_id = $1`, [u.id]);

      const forward = await migrate({ connectionString: db.url });
      expect(forward.applied).toEqual([
        "008_ledger_hardening.sql",
        "009_ai_credit_holds.sql",
        "010_session_token_version.sql",
        "011_checkout_order_expiry.sql",
        "012_function_search_path.sql",
        "013_lemon_order_refunds.sql",
      ]);
      expect((await db.pool.query(`SELECT to_regprocedure('expire_stale_checkout_orders(interval)') IS NOT NULL AS back`)).rows[0].back).toBe(true);
      expect((await db.pool.query(`SELECT prosecdef FROM pg_proc WHERE proname = 'post_credit_transaction'`)).rows[0].prosecdef).toBe(true);
    }));
});
