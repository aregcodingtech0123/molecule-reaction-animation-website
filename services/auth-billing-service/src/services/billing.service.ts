import { pool } from "../db/index.js";
import { AppError } from "../types/index.js";

export interface LedgerHistoryRow {
  id: string;
  amount: number;
  transaction_type: string;
  reference_id: string | null;
  provider: string | null;
  created_at: string;
}

export async function getBalanceForUser(userId: string): Promise<number> {
  const result = await pool.query<{ balance: number }>(
    `SELECT balance FROM user_balances WHERE user_id = $1 LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, "Balance record not found.", "BALANCE_NOT_FOUND");
  }

  return row.balance;
}

export async function getLedgerHistoryForUser(
  userId: string,
  limit = 100,
): Promise<LedgerHistoryRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const result = await pool.query<{
    id: string;
    amount: number;
    transaction_type: string;
    reference_id: string | null;
    provider: string | null;
    created_at: Date;
  }>(
    `SELECT id::text, amount, transaction_type::text, reference_id, provider, created_at
     FROM credit_ledger_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, safeLimit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    transaction_type: row.transaction_type,
    reference_id: row.reference_id,
    provider: row.provider,
    created_at: row.created_at.toISOString(),
  }));
}
