import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceOf, createTestPool, createUser, ledgerOf, ledgerSum } from "../support/db";

/**
 * Every parallel operation runs on its OWN connection (a fresh pg.Client), so
 * the database — not the Node event loop — decides the interleaving.
 */
let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
});

async function onOwnConnection<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

type Outcome = { ok: true } | { ok: false; code: string };

function postOn(userId: string, amount: number, type: string, ref: string | null, provider: string | null = null) {
  return onOwnConnection<Outcome>(async (c) => {
    try {
      // A tiny delay inside the same transaction widens the race window deterministically:
      // all clients are connected and waiting before any of them commits.
      await c.query("BEGIN");
      await c.query(`SELECT post_credit_transaction($1, $2, $3::credit_transaction_type, $4, $5)`, [
        userId,
        amount,
        type,
        ref,
        provider,
      ]);
      await c.query("SELECT pg_sleep(0.01)");
      await c.query("COMMIT");
      return { ok: true };
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      return { ok: false, code: (err as { code: string }).code };
    }
  });
}

const tally = (outcomes: Outcome[]) => ({
  ok: outcomes.filter((o) => o.ok).length,
  codes: outcomes.filter((o): o is { ok: false; code: string } => !o.ok).map((o) => o.code),
});

describe("concurrency", () => {
  it("20 parallel debits of 1 against a balance of 10: exactly 10 succeed, balance ends at 0, never negative", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, i) => postOn(u.id, -1, "CREDIT_CONSUMPTION", `turn-${i}`)),
    );
    const t = tally(outcomes);

    expect(t.ok).toBe(10);
    expect(t.codes).toEqual(Array(10).fill("P0001"));
    expect(await balanceOf(db, u.id)).toBe(0);
    expect(await ledgerSum(db, u.id)).toBe(0);
  });

  it("parallel debits of 3 against 10: exactly 3 succeed (balance 1)", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);

    const t = tally(
      await Promise.all(Array.from({ length: 12 }, (_, i) => postOn(u.id, -3, "CREDIT_CONSUMPTION", `t3-${i}`))),
    );
    expect(t.ok).toBe(3);
    expect(await balanceOf(db, u.id)).toBe(1);
  });

  it("10 parallel duplicate purchase credits for the same order credit exactly once", async () => {
    const u = await createUser(db, { balance: 0 });
    const t = tally(
      await Promise.all(
        Array.from({ length: 10 }, () => postOn(u.id, 250, "CREDIT_PURCHASE", "ls_order_race", "lemonsqueezy")),
      ),
    );

    expect(t.ok).toBe(1);
    expect(t.codes).toEqual(Array(9).fill("23505"));
    expect(await balanceOf(db, u.id)).toBe(250);
    expect(await ledgerOf(db, u.id)).toHaveLength(1);
  });

  it("parallel replays of the same AI turn charge exactly once", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    const t = tally(await Promise.all(Array.from({ length: 8 }, () => postOn(u.id, -2, "CREDIT_CONSUMPTION", "same-turn"))));

    expect(t.ok).toBe(1);
    expect(t.codes.every((c) => c === "23505")).toBe(true);
    expect(await balanceOf(db, u.id)).toBe(8);
  });

  it("mixed parallel credits and debits: final balance = Σ successful amounts and equals the ledger", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`SELECT post_credit_transaction($1, 5, 'SIGNUP_BONUS', 'signup')`, [u.id]);

    const ops = [
      ...Array.from({ length: 15 }, (_, i) => ({ amount: -2, type: "CREDIT_CONSUMPTION", ref: `d-${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ amount: 3, type: "CREDIT_REFUND", ref: `r-${i}` })),
    ];
    const outcomes = await Promise.all(ops.map((o) => postOn(u.id, o.amount, o.type, o.ref)));
    const expected = 5 + ops.reduce((sum, o, i) => sum + (outcomes[i]!.ok ? o.amount : 0), 0);

    const balance = await balanceOf(db, u.id);
    expect(balance).toBe(expected);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(await ledgerSum(db, u.id)).toBe(expected);
    expect(outcomes.filter((o) => !o.ok).every((o) => (o as { code: string }).code === "P0001")).toBe(true);
  });

  it("operations for different users do not block each other (per-user advisory lock)", async () => {
    const a = await createUser(db, { balance: 0 });
    const b = await createUser(db, { balance: 0 });

    // Hold A's lock open in a transaction; B must still be able to post.
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT post_credit_transaction($1, 1, 'SIGNUP_BONUS', 'signup')`, [a.id]);

      const other = await onOwnConnection((c) =>
        c.query(`SET statement_timeout = '2s'; SELECT post_credit_transaction('${b.id}', 1, 'SIGNUP_BONUS', 'signup')`),
      );
      expect(other).toBeDefined();
      expect(await balanceOf(db, b.id)).toBe(1);
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
    expect(await balanceOf(db, a.id)).toBe(0);
  });
});
