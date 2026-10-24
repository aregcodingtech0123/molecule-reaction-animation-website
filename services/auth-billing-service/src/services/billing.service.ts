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

export interface LedgerHistoryPage {
  transactions: LedgerHistoryRow[];
  /** Opaque; pass back as `?cursor=` for the next (older) page. Null on the last page. */
  nextCursor: string | null;
}

/** Position of a row in (created_at DESC, id DESC) order, at full microsecond precision. */
interface HistoryCursor {
  /** created_at in UTC, `YYYY-MM-DDTHH:MM:SS.ffffff` */
  t: string;
  /** ledger id (bigint as text) */
  i: string;
}

const CURSOR_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;
const CURSOR_ID_RE = /^\d{1,19}$/;

function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** @throws 400 INVALID_CURSOR for anything this service did not issue */
export function decodeHistoryCursor(raw: unknown): HistoryCursor {
  const invalid = () => new AppError(400, "Invalid history cursor.", "INVALID_CURSOR");
  if (typeof raw !== "string" || raw.length > 200) throw invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const { t, i } = (parsed ?? {}) as Partial<HistoryCursor>;
  if (typeof t !== "string" || typeof i !== "string" || !CURSOR_TIME_RE.test(t) || !CURSOR_ID_RE.test(i)) {
    throw invalid();
  }
  return { t, i };
}

/**
 * Newest-first ledger page. Keyset pagination on (created_at, id) so rows that
 * share a timestamp are neither skipped nor repeated (FINDING-17).
 */
export async function getLedgerHistoryForUser(
  userId: string,
  limit = 100,
  cursor: HistoryCursor | null = null,
): Promise<LedgerHistoryPage> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const result = await pool.query<{
    id: string;
    amount: number;
    transaction_type: string;
    reference_id: string | null;
    provider: string | null;
    created_at: Date;
    cursor_time: string;
  }>(
    `SELECT id::text, amount, transaction_type::text, reference_id, provider, created_at,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_time
     FROM credit_ledger_transactions
     WHERE user_id = $1
       AND ($3::timestamp IS NULL OR (created_at, id) < ($3::timestamp AT TIME ZONE 'UTC', $4::bigint))
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [userId, safeLimit + 1, cursor?.t ?? null, cursor?.i ?? null],
  );

  const rows = result.rows.slice(0, safeLimit);
  const last = rows.at(-1);
  return {
    transactions: rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      transaction_type: row.transaction_type,
      reference_id: row.reference_id,
      provider: row.provider,
      created_at: row.created_at.toISOString(),
    })),
    nextCursor:
      result.rows.length > safeLimit && last ? encodeHistoryCursor({ t: last.cursor_time, i: last.id }) : null,
  };
}
