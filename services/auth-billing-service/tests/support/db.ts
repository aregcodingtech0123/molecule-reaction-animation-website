import { randomUUID } from "node:crypto";
import pg from "pg";

/** A dedicated pool for assertions — independent of the service's own pool. */
export function createTestPool(max = 30): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set by tests/setup/env.ts");
  return new pg.Pool({ connectionString: url, max });
}

export interface TestUser {
  id: string;
  email: string;
}

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}.${randomUUID().slice(0, 12)}@example.test`;
}

/** Insert a user + balance row directly (bypasses the API and its rate limits). */
export async function createUser(
  db: pg.Pool | pg.PoolClient,
  opts: { balance?: number; email?: string; verified?: boolean; passwordHash?: string } = {},
): Promise<TestUser> {
  const email = opts.email ?? uniqueEmail();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, is_verified, first_name, last_name, date_of_birth)
     VALUES ($1, $2, $3, 'Test', 'User', '1990-01-01') RETURNING id::text`,
    [email, opts.passwordHash ?? "$2b$04$placeholderplaceholderplaceholderplaceholderpla", opts.verified ?? true],
  );
  const id = rows[0]!.id;
  await db.query(`INSERT INTO user_balances (user_id, balance) VALUES ($1, $2)`, [id, opts.balance ?? 0]);
  return { id, email };
}

export async function balanceOf(db: pg.Pool, userId: string): Promise<number | null> {
  const { rows } = await db.query<{ balance: number }>(
    `SELECT balance FROM user_balances WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.balance ?? null;
}

export async function ledgerOf(db: pg.Pool, userId: string) {
  const { rows } = await db.query<{
    id: string;
    amount: number;
    transaction_type: string;
    reference_id: string | null;
    provider: string | null;
  }>(
    `SELECT id::text, amount, transaction_type::text, reference_id, provider
     FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

/** Ledger sum must always equal the cached balance (for users created with balance 0). */
export async function ledgerSum(db: pg.Pool, userId: string): Promise<number> {
  const { rows } = await db.query<{ s: string | null }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS s FROM credit_ledger_transactions WHERE user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.s ?? 0);
}

/** Poll a condition without wall-clock sleeps in assertions (bounded). */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 5_000, intervalMs = 20 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out${last ? `: ${String(last)}` : ""}`);
}
