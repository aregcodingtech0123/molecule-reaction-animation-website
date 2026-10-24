import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceOf, createTestPool, createUser, ledgerOf, ledgerSum } from "../support/db";
import { expectPgError } from "../support/pg-error";

let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
});

const post = (userId: string, amount: number, type: string, ref: string | null = null, provider: string | null = null) =>
  db.query<{ id: string }>(
    `SELECT post_credit_transaction($1, $2, $3::credit_transaction_type, $4, $5)::text AS id`,
    [userId, amount, type, ref, provider],
  );

describe("post_credit_transaction — credits", () => {
  it("adds to the balance and appends exactly one ledger row, returning its id", async () => {
    const u = await createUser(db, { balance: 0 });
    const { rows } = await post(u.id, 50, "CREDIT_PURCHASE", "ls_order_1", "lemonsqueezy");

    expect(await balanceOf(db, u.id)).toBe(50);
    const ledger = await ledgerOf(db, u.id);
    expect(ledger).toEqual([
      { id: rows[0]!.id, amount: 50, transaction_type: "CREDIT_PURCHASE", reference_id: "ls_order_1", provider: "lemonsqueezy" },
    ]);
  });

  it("creates the balance row when it is missing (credit path only)", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`DELETE FROM user_balances WHERE user_id = $1`, [u.id]);

    await post(u.id, 10, "SIGNUP_BONUS", "signup");
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("accepts every credit-side transaction type", async () => {
    const u = await createUser(db, { balance: 0 });
    for (const [i, type] of ["SIGNUP_BONUS", "CREDIT_PURCHASE", "STRIPE_PURCHASE", "ADMIN_ADJUSTMENT", "REFUND", "CREDIT_REFUND"].entries()) {
      await post(u.id, 1, type, `ref-${i}`);
    }
    expect(await balanceOf(db, u.id)).toBe(6);
  });

  it("rejects a credit for a user that does not exist (FK) without leaving a balance row", async () => {
    const ghost = randomUUID();
    await expectPgError(post(ghost, 10, "SIGNUP_BONUS", "signup"), "23503");
    expect(await balanceOf(db, ghost)).toBeNull();
  });
});

describe("post_credit_transaction — debits", () => {
  it("subtracts within balance and records a negative ledger amount", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 10, "SIGNUP_BONUS", "signup");
    await post(u.id, -3, "CREDIT_CONSUMPTION", "turn-a");

    expect(await balanceOf(db, u.id)).toBe(7);
    const ledger = await ledgerOf(db, u.id);
    expect(ledger.at(-1)).toMatchObject({ amount: -3, transaction_type: "CREDIT_CONSUMPTION", reference_id: "turn-a" });
  });

  it("allows spending the balance down to exactly zero", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 5, "SIGNUP_BONUS", "signup");
    await post(u.id, -5, "CREDIT_CONSUMPTION", "all-in");
    expect(await balanceOf(db, u.id)).toBe(0);
  });

  it("refuses an overdraft with P0001 and changes nothing", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 2, "SIGNUP_BONUS", "signup");

    const err = await expectPgError(post(u.id, -3, "CREDIT_CONSUMPTION", "too-much"), "P0001");
    expect(err.message).toMatch(/insufficient credits/);
    expect(await balanceOf(db, u.id)).toBe(2);
    expect(await ledgerOf(db, u.id)).toHaveLength(1);
  });

  it("refuses a debit when the balance row is missing (P0001, not a silent negative)", async () => {
    const u = await createUser(db, { balance: 0 });
    await db.query(`DELETE FROM user_balances WHERE user_id = $1`, [u.id]);
    await expectPgError(post(u.id, -1, "CREDIT_CONSUMPTION", "x"), "P0001");
    expect(await ledgerOf(db, u.id)).toHaveLength(0);
  });

  it("supports the legacy AI_GENERATION_DEDUCTION debit type", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 4, "SIGNUP_BONUS", "signup");
    await post(u.id, -1, "AI_GENERATION_DEDUCTION", "legacy-1");
    expect(await balanceOf(db, u.id)).toBe(3);
  });
});

describe("post_credit_transaction — input validation", () => {
  it("rejects amount 0 with 22023", async () => {
    const u = await createUser(db, { balance: 0 });
    await expectPgError(post(u.id, 0, "SIGNUP_BONUS", "signup"), "22023");
  });

  it("rejects an unknown transaction type", async () => {
    const u = await createUser(db, { balance: 0 });
    await expectPgError(post(u.id, 1, "FREE_MONEY", "x"), "22P02");
  });

  it("rejects a malformed user id", async () => {
    await expectPgError(post("not-a-uuid", 1, "SIGNUP_BONUS", "x"), "22P02");
  });

  it("rejects an amount outside INTEGER range", async () => {
    const u = await createUser(db, { balance: 0 });
    await expectPgError(post(u.id, 2 ** 31, "SIGNUP_BONUS", "x"), "22003");
  });

  it("refuses a credit that would overflow the balance column and rolls back the ledger row", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 2 ** 31 - 1, "ADMIN_ADJUSTMENT", "max");
    await expectPgError(post(u.id, 1, "ADMIN_ADJUSTMENT", "overflow"), "22003");
    expect(await ledgerOf(db, u.id)).toHaveLength(1);
  });
});

describe("idempotency keys", () => {
  it("purchase: a duplicate (provider, reference_id) is rejected with 23505 and the balance is unchanged", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 50, "CREDIT_PURCHASE", "ls_order_dup", "lemonsqueezy");
    await expectPgError(post(u.id, 50, "CREDIT_PURCHASE", "ls_order_dup", "lemonsqueezy"), "23505");
    expect(await balanceOf(db, u.id)).toBe(50);
    expect(await ledgerOf(db, u.id)).toHaveLength(1);
  });

  it("purchase uniqueness is global across users (an order can only ever credit one account)", async () => {
    const a = await createUser(db, { balance: 0 });
    const b = await createUser(db, { balance: 0 });
    const ref = `ls_order_${randomUUID()}`;
    await post(a.id, 50, "CREDIT_PURCHASE", ref, "lemonsqueezy");
    await expectPgError(post(b.id, 50, "CREDIT_PURCHASE", ref, "lemonsqueezy"), "23505");
    expect(await balanceOf(db, b.id)).toBe(0);
  });

  it("the same reference under a different provider is a different purchase", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 5, "CREDIT_PURCHASE", "order-x", "lemonsqueezy");
    await post(u.id, 5, "STRIPE_PURCHASE", "order-x", "stripe");
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("rows without a provider are not constrained (several SIGNUP_BONUS 'signup' rows may exist historically)", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 1, "SIGNUP_BONUS", "signup");
    await post(u.id, 1, "SIGNUP_BONUS", "signup");
    expect(await ledgerOf(db, u.id)).toHaveLength(2);
  });

  it("AI consumption: one CREDIT_CONSUMPTION per (user, reference)", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 10, "SIGNUP_BONUS", "signup");
    await post(u.id, -1, "CREDIT_CONSUMPTION", "turn-1");
    await expectPgError(post(u.id, -1, "CREDIT_CONSUMPTION", "turn-1"), "23505");
    expect(await balanceOf(db, u.id)).toBe(9);
  });

  it("AI refund: one CREDIT_REFUND per (user, reference), and it may share the consumption's reference", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 10, "SIGNUP_BONUS", "signup");
    await post(u.id, -2, "CREDIT_CONSUMPTION", "turn-2");
    await post(u.id, 2, "CREDIT_REFUND", "turn-2");
    await expectPgError(post(u.id, 2, "CREDIT_REFUND", "turn-2"), "23505");
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("AI references are scoped per user (two users may reuse the same turn id)", async () => {
    const a = await createUser(db, { balance: 0 });
    const b = await createUser(db, { balance: 0 });
    await post(a.id, 1, "SIGNUP_BONUS", "signup");
    await post(b.id, 1, "SIGNUP_BONUS", "signup");
    await post(a.id, -1, "CREDIT_CONSUMPTION", "shared");
    await post(b.id, -1, "CREDIT_CONSUMPTION", "shared");
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id)]).toEqual([0, 0]);
  });

  it("legacy AI_GENERATION_DEDUCTION has NO database-level idempotency (relies on an app-level pre-check)", async () => {
    // Characterises the gap behind FINDING-07; see tests/api/billing.deduct.test.ts for the race.
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 5, "SIGNUP_BONUS", "signup");
    await post(u.id, -1, "AI_GENERATION_DEDUCTION", "same-ref");
    await post(u.id, -1, "AI_GENERATION_DEDUCTION", "same-ref");
    expect(await balanceOf(db, u.id)).toBe(3);
  });
});

describe("balance cache ↔ ledger invariant", () => {
  it("cached balance equals SUM(ledger) after a mixed sequence including rejected operations", async () => {
    const u = await createUser(db, { balance: 0 });
    await post(u.id, 10, "SIGNUP_BONUS", "signup");
    await post(u.id, 250, "CREDIT_PURCHASE", "ls_order_inv", "lemonsqueezy");
    await post(u.id, -10, "CREDIT_CONSUMPTION", "t1");
    await post(u.id, 10, "CREDIT_REFUND", "t1");
    await expectPgError(post(u.id, -1000, "CREDIT_CONSUMPTION", "t2"), "P0001");
    await expectPgError(post(u.id, 250, "CREDIT_PURCHASE", "ls_order_inv", "lemonsqueezy"), "23505");
    await post(u.id, -5, "CREDIT_CONSUMPTION", "t3");

    expect(await balanceOf(db, u.id)).toBe(255);
    expect(await ledgerSum(db, u.id)).toBe(255);
  });
});
