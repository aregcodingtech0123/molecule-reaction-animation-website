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

const ALLOWED_DEDUCT_TYPES = new Set([
  "AI_GENERATION_DEDUCTION",
  "ADMIN_ADJUSTMENT",
  "REFUND",
]);

export async function deductCreditsForUser(
  userId: string,
  amount: number,
  transactionType: string,
  referenceId: string,
): Promise<{ newBalance: number; ledgerId: string | null; alreadyProcessed: boolean }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError(400, "Deduction amount must be a positive integer.", "INVALID_AMOUNT");
  }
  if (!ALLOWED_DEDUCT_TYPES.has(transactionType)) {
    throw new AppError(400, "Invalid transaction type for deduction.", "INVALID_TRANSACTION_TYPE");
  }
  if (!referenceId?.trim() || referenceId.length > 255) {
    throw new AppError(400, "referenceId is required.", "INVALID_REFERENCE");
  }

  const existing = await pool.query<{ id: string }>(
    `SELECT id::text FROM credit_ledger_transactions
     WHERE user_id = $1 AND reference_id = $2 AND transaction_type = $3::credit_transaction_type
     LIMIT 1`,
    [userId, referenceId.trim(), transactionType],
  );

  if ((existing.rowCount ?? 0) > 0) {
    const newBalance = await getBalanceForUser(userId);
    return {
      newBalance,
      ledgerId: existing.rows[0]?.id ?? null,
      alreadyProcessed: true,
    };
  }

  try {
    const posted = await pool.query<{ ledger_id: string }>(
      `SELECT post_credit_transaction($1, $2, $3::credit_transaction_type, $4) AS ledger_id`,
      [userId, -amount, transactionType, referenceId.trim()],
    );

    const newBalance = await getBalanceForUser(userId);
    return {
      newBalance,
      ledgerId: posted.rows[0]?.ledger_id ?? null,
      alreadyProcessed: false,
    };
  } catch (err) {
    const pgCode = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : null;
    if (pgCode === "P0001") {
      throw new AppError(402, "Insufficient credits.", "INSUFFICIENT_CREDITS");
    }
    throw err;
  }
}
