import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestPool, createUser } from "../support/db";
import { ScratchDb } from "../support/scratch-db";

let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
});

const issuesFor = async (userId: string) =>
  (await db.query(`SELECT issue, cached_balance, ledger_sum::int, difference::int FROM ledger_reconciliation() WHERE user_id = $1`, [userId])).rows;

describe("ledger_reconciliation() (FINDING-05)", () => {
  it("reports nothing for a user whose balance came only through post_credit_transaction", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    await db.query(`SELECT post_credit_transaction($1, -4, 'CREDIT_CONSUMPTION', 't')`, [u.id]);
    expect(await issuesFor(u.id)).toEqual([]);
  });

  it("flags a balance that does not match SUM(ledger) (e.g. a legacy row or a bypassed write)", async () => {
    const u = await createUser(db, { balance: 25 }); // inserted without any ledger row
    expect(await issuesFor(u.id)).toEqual([{ issue: "balance_mismatch", cached_balance: 25, ledger_sum: 0, difference: 25 }]);
  });

  it("flags ledger rows without a balance row", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`SELECT post_credit_transaction($1, 5, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    await db.query(`DELETE FROM user_balances WHERE user_id = $1`, [u.id]);
    expect(await issuesFor(u.id)).toEqual([{ issue: "missing_balance_row", cached_balance: null, ledger_sum: 5, difference: -5 }]);
  });

  it("is empty on a freshly migrated database", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM ledger_reconciliation()`);
      expect(rows[0].n).toBe(0);
    } finally {
      await scratch.destroy();
    }
  });
});
