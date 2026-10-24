/**
 * expire_stale_checkout_orders() (FINDING-15): pending checkout rows that never
 * received a paid webhook are marked 'expired' by a scheduled call.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestPool, createUser } from "../support/db";

let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
});

async function order(userId: string, status: string, ageHours: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO pending_checkout_orders (user_id, package_id, provider, currency, amount_minor, credits, status, created_at)
     VALUES ($1, 'starter', 'lemonsqueezy', 'USD', 500, 50, $2, NOW() - make_interval(hours => $3))
     RETURNING id::text`,
    [userId, status, ageHours],
  );
  return rows[0]!.id;
}

const statusOf = async (id: string) =>
  (await db.query(`SELECT status FROM pending_checkout_orders WHERE id = $1`, [id])).rows[0].status;

describe("expire_stale_checkout_orders() (FINDING-15)", () => {
  it("expires only 'pending' rows older than the threshold (default 24 h) and returns how many", async () => {
    const u = await createUser(db);
    const stale = await order(u.id, "pending", 25);
    const fresh = await order(u.id, "pending", 23);
    const done = await order(u.id, "completed", 72);
    const failed = await order(u.id, "failed", 72);

    const { rows } = await db.query(`SELECT expire_stale_checkout_orders() AS n`);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await statusOf(stale)).toBe("expired");
    expect(await statusOf(fresh)).toBe("pending");
    expect(await statusOf(done)).toBe("completed");
    expect(await statusOf(failed)).toBe("failed");
  });

  it("honours a custom threshold and is idempotent (second run expires nothing new)", async () => {
    const u = await createUser(db);
    const id = await order(u.id, "pending", 3);
    await db.query(`SELECT expire_stale_checkout_orders(INTERVAL '2 hours')`);
    expect(await statusOf(id)).toBe("expired");
    const again = await db.query(
      `SELECT count(*)::int AS n FROM pending_checkout_orders WHERE user_id = $1 AND status = 'expired'`,
      [u.id],
    );
    await db.query(`SELECT expire_stale_checkout_orders(INTERVAL '2 hours')`);
    const after = await db.query(
      `SELECT count(*)::int AS n FROM pending_checkout_orders WHERE user_id = $1 AND status = 'expired'`,
      [u.id],
    );
    expect(after.rows[0].n).toBe(again.rows[0].n);
  });

  it.each([["NULL"], ["INTERVAL '59 minutes'"], ["INTERVAL '-1 day'"]])(
    "refuses a threshold of %s (would expire checkouts a buyer may still be paying)",
    async (arg) => {
      await expect(db.query(`SELECT expire_stale_checkout_orders(${arg})`)).rejects.toMatchObject({ code: "22023" });
    },
  );

  it("never touches the ledger or balances", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`SELECT post_credit_transaction($1, 5, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    await order(u.id, "pending", 48);
    await db.query(`SELECT expire_stale_checkout_orders()`);
    const { rows } = await db.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [u.id]);
    expect(rows[0].balance).toBe(5);
  });
});
