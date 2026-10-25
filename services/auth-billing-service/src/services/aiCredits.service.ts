import type { PoolClient } from "../db/index.js";
import { pool, withTransaction } from "../db/index.js";
import { env } from "../config/env.js";
import {
  AI_OPERATION_LABELS,
  costForOperation,
  isAiOperationType,
  type AiOperationType,
} from "../config/aiOperations.js";
import { AppError } from "../types/index.js";

/**
 * AI credit metering as a reservation (FINDING-03 / FINDING-22):
 *
 *   reserve → 'held'      no ledger write; the amount is excluded from the
 *                          available balance so concurrent operations cannot overspend
 *   capture → 'captured'  one CREDIT_CONSUMPTION ledger row, exactly once
 *   release → 'released'  only from 'held'; never touches the ledger
 *   expiry  → 'expired'   held past expires_at = never charged
 *
 * A captured operation can never be released, so a successful generation stays
 * paid for even if someone obtains its reference. Every transition runs in one
 * transaction under the same per-user advisory lock post_credit_transaction uses.
 */

const PG_INSUFFICIENT_CREDITS = "P0001";
const MAX_REFERENCE_LENGTH = 255;

export type HoldStatus = "held" | "captured" | "released" | "expired" | "capture_failed";

interface HoldRow {
  status: HoldStatus;
  amount: number;
  operation_type: string;
  expired: boolean;
  ledger_id: string | null;
}

export interface ReserveResult {
  operationType: AiOperationType;
  cost: number;
  /** Credits still available after this reservation. */
  balance: number;
  status: "held";
  expiresAt: string;
  /** Always null: a reservation writes no ledger row. Kept for response-shape compatibility. */
  ledgerId: null;
  alreadyProcessed: false;
}

export interface CaptureResult {
  captured: true;
  amount: number;
  /** Cached balance after the debit. */
  balance: number;
  ledgerId: string;
  alreadyProcessed: boolean;
}

export interface RefundResult {
  refunded: boolean;
  amount: number;
  /** Credits available after the call. */
  balance: number;
  ledgerId: null;
  reason?: "nothing_charged" | "already_refunded" | "not_refundable";
}

function pgErrorCode(err: unknown): string | null {
  return err && typeof err === "object" && "code" in err ? ((err as { code?: string }).code ?? null) : null;
}

function assertValidReference(referenceId: unknown): string {
  const trimmed = typeof referenceId === "string" ? referenceId.trim() : "";
  if (!trimmed) {
    throw new AppError(400, "referenceId is required.", "INVALID_REFERENCE");
  }
  if (trimmed.length > MAX_REFERENCE_LENGTH) {
    throw new AppError(400, "referenceId is too long.", "INVALID_REFERENCE");
  }
  return trimmed;
}

async function lockUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [userId]);
}

async function findHold(client: PoolClient, userId: string, referenceId: string): Promise<HoldRow | null> {
  const { rows } = await client.query<HoldRow>(
    `SELECT status, amount, operation_type, expires_at <= NOW() AS expired, ledger_id::text
     FROM ai_credit_holds
     WHERE user_id = $1 AND reference_id = $2
     FOR UPDATE`,
    [userId, referenceId],
  );
  return rows[0] ?? null;
}

/** Cached balance minus every unexpired reservation. */
async function availableBalance(client: PoolClient | typeof pool, userId: string): Promise<number> {
  const { rows } = await client.query<{ available: number }>(
    `SELECT COALESCE((SELECT balance FROM user_balances WHERE user_id = $1), 0)
          - COALESCE((SELECT SUM(amount) FROM ai_credit_holds
                      WHERE user_id = $1 AND status = 'held' AND expires_at > NOW()), 0) AS available`,
    [userId],
  );
  return Number(rows[0]?.available ?? 0);
}

/**
 * SEC-16: rolling-24 h turn caps, checked while the user's advisory lock is held (so one user's
 * concurrent turns cannot overshoot their cap). The global count is not serialised: under a burst
 * it may overshoot by the number of in-flight reservations — a soft circuit breaker for spend.
 */
async function assertWithinDailyTurnLimits(client: PoolClient, userId: string): Promise<void> {
  const limits = env.aiDailyTurnLimits;
  const { rows } = await client.query<{ mine: number; oldest_mine: Date | null; total: number }>(
    `SELECT
       (SELECT count(*)::int FROM ai_credit_holds WHERE user_id = $1 AND created_at > NOW() - interval '24 hours') AS mine,
       (SELECT min(created_at) FROM ai_credit_holds WHERE user_id = $1 AND created_at > NOW() - interval '24 hours') AS oldest_mine,
       (SELECT count(*)::int FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours') AS total`,
    [userId],
  );
  const { mine, oldest_mine: oldest, total } = rows[0]!;
  if (mine >= limits.perUser) {
    const retryAfter = oldest ? Math.max(1, Math.ceil((oldest.getTime() + 24 * 3600 * 1000 - Date.now()) / 1000)) : 3600;
    throw new AppError(429, "Daily AI limit reached. Try again later.", "AI_DAILY_LIMIT", { limit: limits.perUser, retryAfter });
  }
  if (total >= limits.global) {
    console.error("[credits] AI_CAPACITY_REACHED — global daily turn cap hit", { limit: limits.global });
    throw new AppError(503, "The AI Lab has reached its daily capacity. Please try again later.", "AI_CAPACITY_REACHED");
  }
}

async function cachedBalance(client: PoolClient, userId: string): Promise<number> {
  const { rows } = await client.query<{ balance: number }>(
    `SELECT balance FROM user_balances WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.balance ?? 0;
}

/**
 * Reserve the price of one AI operation.
 *
 * @throws 400 unknown operation / malformed reference
 * @throws 409 OPERATION_ALREADY_EXISTS — the reference was already used (any status);
 *         references are single-use, so the caller must not run the operation
 * @throws 402 INSUFFICIENT_CREDITS with requiredCredits + balance (available)
 */
export async function reserveCreditsForOperation(
  userId: string,
  operationType: unknown,
  referenceIdInput: unknown,
): Promise<ReserveResult> {
  if (!isAiOperationType(operationType)) {
    throw new AppError(400, "Unknown AI operation.", "INVALID_OPERATION");
  }
  const referenceId = assertValidReference(referenceIdInput);
  const cost = costForOperation(operationType);

  const result = await withTransaction(async (client) => {
    await lockUser(client, userId);

    const existing = await findHold(client, userId, referenceId);
    if (existing) {
      throw new AppError(409, "This operation reference has already been used.", "OPERATION_ALREADY_EXISTS", {
        status: existing.status,
      });
    }

    await assertWithinDailyTurnLimits(client, userId);

    const available = await availableBalance(client, userId);
    if (available < cost) {
      throw new AppError(402, "Insufficient credits.", "INSUFFICIENT_CREDITS", {
        requiredCredits: cost,
        balance: available,
        operationType,
      });
    }

    const { rows } = await client.query<{ expires_at: Date }>(
      `INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + make_interval(secs => $5))
       RETURNING expires_at`,
      [userId, referenceId, operationType, cost, env.aiHoldTtlSeconds],
    );

    return { balance: available - cost, expiresAt: rows[0]!.expires_at.toISOString() };
  });

  return {
    operationType,
    cost,
    balance: result.balance,
    status: "held",
    expiresAt: result.expiresAt,
    ledgerId: null,
    alreadyProcessed: false,
  };
}

/**
 * Turn a held reservation into exactly one CREDIT_CONSUMPTION ledger debit.
 * Debits the amount recorded at reservation time (a later price change does not apply).
 *
 * @throws 404 HOLD_NOT_FOUND — no reservation for this user + reference
 * @throws 409 HOLD_EXPIRED — expired before capture; settled as 'expired', never charged
 * @throws 409 NOT_CAPTURABLE — already released / expired / failed
 * @throws 409 CAPTURE_FAILED — the debit could not be posted; recorded durably as 'capture_failed'
 */
export async function captureOperation(userId: string, referenceIdInput: unknown): Promise<CaptureResult> {
  const referenceId = assertValidReference(referenceIdInput);

  const outcome = await withTransaction(async (client) => {
      await lockUser(client, userId);
      const hold = await findHold(client, userId, referenceId);
      if (!hold) {
        throw new AppError(404, "No reservation for this operation.", "HOLD_NOT_FOUND");
      }
      if (hold.status === "captured") {
        return {
          captured: true as const,
          amount: hold.amount,
          balance: await cachedBalance(client, userId),
          ledgerId: hold.ledger_id!,
          alreadyProcessed: true,
        };
      }
      if (hold.status !== "held") {
        throw new AppError(409, "This operation can no longer be captured.", "NOT_CAPTURABLE", { status: hold.status });
      }
      if (hold.expired) {
        await client.query(
          `UPDATE ai_credit_holds SET status = 'expired', settled_at = NOW(), settle_reason = 'capture_after_expiry'
           WHERE user_id = $1 AND reference_id = $2`,
          [userId, referenceId],
        );
        return { expiredAtCapture: true as const };
      }

      let ledgerId: string;
      try {
        await client.query("SAVEPOINT capture_debit");
        const posted = await client.query<{ ledger_id: string }>(
          `SELECT post_credit_transaction($1, $2, 'CREDIT_CONSUMPTION'::credit_transaction_type, $3)::text AS ledger_id`,
          [userId, -hold.amount, referenceId],
        );
        ledgerId = posted.rows[0]!.ledger_id;
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT capture_debit");
        const code = pgErrorCode(err);
        const reason = code === PG_INSUFFICIENT_CREDITS ? "insufficient_credits_at_capture" : `db_error_${code ?? "unknown"}`;
        await client.query(
          `UPDATE ai_credit_holds SET status = 'capture_failed', settled_at = NOW(), settle_reason = $3
           WHERE user_id = $1 AND reference_id = $2`,
          [userId, referenceId, reason],
        );
        return { captureFailed: true as const, reason, amount: hold.amount };
      }

      await client.query(
        `UPDATE ai_credit_holds SET status = 'captured', settled_at = NOW(), ledger_id = $3
         WHERE user_id = $1 AND reference_id = $2`,
        [userId, referenceId, ledgerId],
      );
      const balance = await cachedBalance(client, userId);
      console.log("[credits] Captured", {
        userId,
        operation: AI_OPERATION_LABELS[hold.operation_type as AiOperationType] ?? hold.operation_type,
        amount: hold.amount,
        referenceId,
        balance,
        ledgerId,
      });
      return { captured: true as const, amount: hold.amount, balance, ledgerId, alreadyProcessed: false };
  });

  // Settlements above are committed before the rejection is reported.
  if ("expiredAtCapture" in outcome) {
    throw new AppError(409, "The reservation expired before capture; nothing was charged.", "HOLD_EXPIRED");
  }
  if ("captureFailed" in outcome) {
    console.error("[credits] CAPTURE_FAILED (recorded as capture_failed)", {
      userId,
      referenceId,
      amount: outcome.amount,
      reason: outcome.reason,
    });
    throw new AppError(409, "The charge could not be captured; nothing was charged.", "CAPTURE_FAILED");
  }
  return outcome;
}

/**
 * Release a held reservation after a failed operation. Never writes to the ledger.
 * Safe to call blindly: unknown, already-released and expired references are no-ops;
 * a captured operation is never refundable.
 */
export async function releaseOperation(userId: string, referenceIdInput: unknown, reason: string): Promise<RefundResult> {
  const referenceId = assertValidReference(referenceIdInput);
  const settleReason = reason.slice(0, 200) || "released";

  return withTransaction(async (client) => {
    await lockUser(client, userId);
    const hold = await findHold(client, userId, referenceId);

    if (!hold) {
      return { refunded: false, amount: 0, balance: await availableBalance(client, userId), ledgerId: null, reason: "nothing_charged" };
    }
    if (hold.status === "captured") {
      return { refunded: false, amount: hold.amount, balance: await availableBalance(client, userId), ledgerId: null, reason: "not_refundable" };
    }
    if (hold.status !== "held") {
      return {
        refunded: false,
        amount: hold.amount,
        balance: await availableBalance(client, userId),
        ledgerId: null,
        reason: hold.status === "capture_failed" ? "nothing_charged" : "already_refunded",
      };
    }

    await client.query(
      `UPDATE ai_credit_holds SET status = 'released', settled_at = NOW(), settle_reason = $3
       WHERE user_id = $1 AND reference_id = $2`,
      [userId, referenceId, settleReason],
    );
    const balance = await availableBalance(client, userId);
    console.log("[credits] Released", { userId, amount: hold.amount, referenceId, reason: settleReason, balance });
    return { refunded: true, amount: hold.amount, balance, ledgerId: null };
  });
}

/** Settle every expired reservation (never charged). Returns how many were settled. */
export async function releaseExpiredHolds(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT release_expired_ai_holds() AS n`);
  return rows[0]?.n ?? 0;
}
