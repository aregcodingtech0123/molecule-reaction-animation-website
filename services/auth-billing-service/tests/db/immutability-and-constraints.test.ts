import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestPool, createUser, ledgerOf, uniqueEmail } from "../support/db";
import { expectPgError } from "../support/pg-error";
import { ScratchDb } from "../support/scratch-db";

let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
});

async function userWithLedger() {
  const u = await createUser(db, { balance: 0 });
  const { rows } = await db.query<{ id: string }>(
    `SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')::text AS id`,
    [u.id],
  );
  return { user: u, ledgerId: rows[0]!.id };
}

describe("ledger immutability", () => {
  it("UPDATE of a ledger row is rejected with 55000 and the row is unchanged", async () => {
    const { user, ledgerId } = await userWithLedger();
    const err = await expectPgError(
      db.query(`UPDATE credit_ledger_transactions SET amount = 9999 WHERE id = $1`, [ledgerId]),
      "55000",
    );
    expect(err.message).toMatch(/immutable.*UPDATE/);
    expect((await ledgerOf(db, user.id))[0]!.amount).toBe(10);
  });

  it("UPDATE of any column (not just amount) is rejected", async () => {
    const { ledgerId } = await userWithLedger();
    await expectPgError(
      db.query(`UPDATE credit_ledger_transactions SET reference_id = 'tampered' WHERE id = $1`, [ledgerId]),
      "55000",
    );
  });

  it("DELETE of a ledger row is rejected with 55000", async () => {
    const { user, ledgerId } = await userWithLedger();
    const err = await expectPgError(db.query(`DELETE FROM credit_ledger_transactions WHERE id = $1`, [ledgerId]), "55000");
    expect(err.message).toMatch(/immutable.*DELETE/);
    expect(await ledgerOf(db, user.id)).toHaveLength(1);
  });

  it("a user with ledger history cannot be deleted (ON DELETE RESTRICT protects the audit trail)", async () => {
    const { user, ledgerId } = await userWithLedger();
    const err = await expectPgError(db.query(`DELETE FROM users WHERE id = $1`, [user.id]));
    // Same RESTRICT constraint, version-dependent SQLSTATE: PostgreSQL 18 reports 23001
    // restrict_violation, PostgreSQL 16 (CI) the generic 23503 foreign_key_violation (TC-40).
    expect(["23001", "23503"], err.message).toContain(err.code);
    expect(err.constraint).toBe("credit_ledger_transactions_user_id_fkey");
    // Nothing of the audit trail is gone.
    const left = await db.query(
      `SELECT (SELECT count(*) FROM users WHERE id = $1)::int AS users,
              (SELECT count(*) FROM user_balances WHERE user_id = $1)::int AS balances`,
      [user.id],
    );
    expect(left.rows[0]).toEqual({ users: 1, balances: 1 });
    expect((await ledgerOf(db, user.id)).map((r) => String(r.id))).toEqual([ledgerId]);
  });

  it("the ledger and AI-hold foreign keys to users are declared ON DELETE RESTRICT", async () => {
    const { rows } = await db.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE contype = 'f' AND confrelid = 'users'::regclass
         AND conrelid IN ('credit_ledger_transactions'::regclass, 'ai_credit_holds'::regclass)
       ORDER BY conname`,
    );
    expect(rows).toEqual([
      { conname: "ai_credit_holds_user_id_fkey", def: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT" },
      { conname: "credit_ledger_transactions_user_id_fkey", def: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT" },
    ]);
  });

  it("ledger ids are generated ALWAYS (cannot be forged on insert)", async () => {
    const u = await createUser(db, { balance: 0 });
    await expectPgError(
      db.query(
        `INSERT INTO credit_ledger_transactions (id, user_id, amount, transaction_type) VALUES (1, $1, 5, 'SIGNUP_BONUS')`,
        [u.id],
      ),
      "428C9",
    );
  });

  // FINDING-05 (Medium): row-level triggers do not fire on TRUNCATE, so the "immutable" ledger
  // can be wiped in one statement by the table owner (the app's own DB role).
  it("TRUNCATE of the ledger is blocked (FINDING-05)", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const u = await createUser(scratch.pool, { balance: 0 });
      await scratch.pool.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
      await expectPgError(scratch.pool.query(`TRUNCATE credit_ledger_transactions`));
    } finally {
      await scratch.destroy();
    }
  });

  it("user_balances is protected: a direct UPDATE is rejected and cannot desynchronise the cache from the ledger (FINDING-05)", async () => {
    const { user } = await userWithLedger();
    const err = await expectPgError(db.query(`UPDATE user_balances SET balance = 1000 WHERE user_id = $1`, [user.id]), "55000");
    expect(err.message).toMatch(/only change through post_credit_transaction/);
    const { rows } = await db.query(
      `SELECT b.balance, (SELECT SUM(amount) FROM credit_ledger_transactions WHERE user_id = $1)::int AS ledger
       FROM user_balances b WHERE b.user_id = $1`,
      [user.id],
    );
    expect(rows[0]).toEqual({ balance: 10, ledger: 10 });
  });

  it("TRUNCATE of user_balances is blocked (FINDING-05)", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      await expectPgError(scratch.pool.query(`TRUNCATE user_balances`), "55000");
    } finally {
      await scratch.destroy();
    }
  });

  it("an UPDATE that leaves the balance unchanged is not blocked (no false positives on no-op writes)", async () => {
    const { user } = await userWithLedger();
    await db.query(`UPDATE user_balances SET balance = balance WHERE user_id = $1`, [user.id]);
  });

  it("post_credit_transaction leaves the write flag off afterwards, so a later direct UPDATE in the same transaction is still blocked", async () => {
    const { user } = await userWithLedger();
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT post_credit_transaction($1, 5, 'ADMIN_ADJUSTMENT', 'adj')`, [user.id]);
      await expectPgError(c.query(`UPDATE user_balances SET balance = 999 WHERE user_id = $1`, [user.id]), "55000");
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});

describe("constraints", () => {
  it("email is unique case-insensitively and ignoring surrounding whitespace", async () => {
    const local = `Mixed.${randomUUID().slice(0, 8)}`;
    await db.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x')`, [`${local}@Example.test`]);
    await expectPgError(
      db.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x')`, [`  ${local.toLowerCase()}@example.TEST `]),
      "23505",
    );
  });

  it("empty / whitespace-only email and empty password hash are rejected", async () => {
    await expectPgError(db.query(`INSERT INTO users (email, password_hash) VALUES ('   ', 'x')`), "23514");
    await expectPgError(db.query(`INSERT INTO users (email, password_hash) VALUES ($1, '')`, [uniqueEmail()]), "23514");
  });

  it("user ids are UUIDs: malformed ids are rejected, valid ones generated by default", async () => {
    await expectPgError(db.query(`SELECT 1 FROM users WHERE id = 'nope'`), "22P02");
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id::text`,
      [uniqueEmail()],
    );
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("balance can never be negative, even via direct UPDATE", async () => {
    const u = await createUser(db, { balance: 0 });
    await expectPgError(db.query(`UPDATE user_balances SET balance = -1 WHERE user_id = $1`, [u.id]), "23514");
  });

  it("ledger rows with amount 0 are rejected even on direct INSERT", async () => {
    const u = await createUser(db, { balance: 0 });
    await expectPgError(
      db.query(`INSERT INTO credit_ledger_transactions (user_id, amount, transaction_type) VALUES ($1, 0, 'SIGNUP_BONUS')`, [u.id]),
      "23514",
    );
  });

  it("provider VARCHAR(32) accepts legacy provider strings and exactly 32 chars, rejects 33", async () => {
    const u = await createUser(db, { balance: 0 });
    for (const provider of ["stripe", "iyzico", "lemonsqueezy", "x".repeat(32)]) {
      await db.query(
        `SELECT post_credit_transaction($1, 1, 'CREDIT_PURCHASE', $2, $3)`,
        [u.id, `legacy-${provider.slice(0, 8)}-${randomUUID()}`, provider],
      );
    }
    await expectPgError(
      db.query(`SELECT post_credit_transaction($1, 1, 'CREDIT_PURCHASE', 'too-long', $2)`, [u.id, "x".repeat(33)]),
      "22001",
    );
  });

  it("pending_checkout_orders enforces status values and positive amounts/credits", async () => {
    const u = await createUser(db, { balance: 0 });
    const insert = (status: string, amount: number, credits: number) =>
      db.query(
        `INSERT INTO pending_checkout_orders (user_id, package_id, provider, currency, amount_minor, credits, status)
         VALUES ($1, 'starter', 'lemonsqueezy', 'USD', $2, $3, $4)`,
        [u.id, amount, credits, status],
      );
    await insert("pending", 500, 50);
    await expectPgError(insert("paid", 500, 50), "23514");
    await expectPgError(insert("pending", 0, 50), "23514");
    await expectPgError(insert("pending", 500, 0), "23514");
  });

  it("token tables require 64-char SHA-256 hex hashes and unique hashes", async () => {
    const u = await createUser(db, { balance: 0 });
    const hash = "a".repeat(63) + Math.floor(Math.random() * 10);
    await expectPgError(
      db.query(`INSERT INTO verification_tokens (user_id, token_hash, expires_at) VALUES ($1, 'short', NOW())`, [u.id]),
      "23514",
    );
    await db.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW())`, [u.id, hash]);
    await expectPgError(
      db.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW())`, [u.id, hash]),
      "23505",
    );
  });

  it("an OAuth subject can be linked to only one user", async () => {
    const a = await createUser(db, { balance: 0 });
    const b = await createUser(db, { balance: 0 });
    const sub = randomUUID();
    await db.query(`INSERT INTO oauth_accounts (user_id, provider, provider_account_id) VALUES ($1, 'google', $2)`, [a.id, sub]);
    await expectPgError(
      db.query(`INSERT INTO oauth_accounts (user_id, provider, provider_account_id) VALUES ($1, 'google', $2)`, [b.id, sub]),
      "23505",
    );
  });

  it("deleting a user without ledger history cascades to balance, tokens and oauth links", async () => {
    const u = await createUser(db, { balance: 5 });
    await db.query(`INSERT INTO oauth_accounts (user_id, provider, provider_account_id) VALUES ($1, 'google', $2)`, [u.id, randomUUID()]);
    await db.query(`DELETE FROM users WHERE id = $1`, [u.id]);
    const { rows } = await db.query(
      `SELECT (SELECT count(*) FROM user_balances WHERE user_id = $1)::int AS b,
              (SELECT count(*) FROM oauth_accounts WHERE user_id = $1)::int AS o`,
      [u.id],
    );
    expect(rows[0]).toEqual({ b: 0, o: 0 });
  });
});
