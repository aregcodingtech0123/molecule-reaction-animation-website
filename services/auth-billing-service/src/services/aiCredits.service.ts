import type { PoolClient } from "../db/index.js";
import { safeDbErrorFields } from "../db/diagnostics.js";
import { isAmbiguousCommitError, isConnectionLossError, pool, withTransaction } from "../db/index.js";
import { isDatabaseUnavailableError, isTransientDatabaseError } from "../db/unavailable.js";
import { env } from "../config/env.js";
import {
  AI_OPERATION_LABELS,
  costForOperation,
  isAiOperationType,
  type AiOperationType,
} from "../config/aiOperations.js";
import { resolveSettlementKeys } from "../config/settlementSecret.js";
import { AppError } from "../types/index.js";
import { matchesHoldRow, mintSettlementCapability, type SettlementBinding, type SettlementClaims } from "../utils/settlementCapability.js";

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
 *
 * Settlement capabilities (Phase 2C): reserve mints one capture and one refund token from the row it just inserted.
 * Capture and release, when given a token's claims, compare them to the row under the lock before anything else. The
 * state machine below is the same for both authentication paths, so the row stays authoritative for status, expiry and
 * amount, and a repeated token cannot settle twice.
 */

const PG_INSUFFICIENT_CREDITS = "P0001";
const MAX_REFERENCE_LENGTH = 255;

/**
 * Debit errors that are proven deterministic, so the hold may be settled as 'capture_failed' for good: insufficient credits,
 * and the reference already being in the ledger. Everything else leaves the debit's savepoint and fails the whole
 * transaction, and is then classified by classifyCaptureError.
 */
const TERMINAL_DEBIT_SQLSTATES: ReadonlySet<string> = new Set([PG_INSUFFICIENT_CREDITS, "23505"]);

/**
 * How long the read after an ambiguous COMMIT waits for the locks. A backend the server has not yet noticed is gone can hold
 * them for a while, so there must be a bound. Short, because the caller's own retries are the longer-lived way to find out.
 */
export const CAPTURE_INSPECTION_LOCK_TIMEOUT_MS = 3000;

export type HoldStatus = "held" | "captured" | "released" | "expired" | "capture_failed";

interface HoldRow {
  status: HoldStatus;
  amount: number;
  operation_type: string;
  expired: boolean;
  ledger_id: string | null;
  user_id: string;
  reference_id: string;
  created_at_s: number;
  expires_at_s: number;
}

/**
 * The bound timestamps in whole epoch seconds, as numbers: EXTRACT gives `numeric`, which pg returns as a string, and the
 * capability's strict comparison would then always fail. Used by both the mint and the check, so they cannot disagree.
 */
export const HOLD_SECONDS_COLUMNS = `FLOOR(EXTRACT(EPOCH FROM created_at))::float8 AS created_at_s, FLOOR(EXTRACT(EPOCH FROM expires_at))::float8 AS expires_at_s`;

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
  /** Authorises capturing this reservation. Server-to-server only: never for a browser or a log. */
  captureCapabilityToken: string;
  /** Authorises releasing this reservation. Server-to-server only: never for a browser or a log. */
  refundCapabilityToken: string;
  /**
   * Authorises recording that the BFF returned the settled answer (delivery_ack). Present ONLY when the reservation was
   * created with delivery tracking on; a reservation without it can never be acknowledged. Server-to-server only.
   */
  deliveryAckCapabilityToken?: string;
}

export interface ReserveOptions {
  /** The caller promises to acknowledge delivery. Only the boolean `true` counts; the reservation is then marked as tracked. */
  trackDelivery?: boolean;
}

export interface CaptureResult {
  captured: true;
  amount: number;
  /** Cached balance after the debit. */
  balance: number;
  ledgerId: string;
  alreadyProcessed: boolean;
}

/**
 * What a refund call found, read under the lock. This is the authoritative field: `reason` keeps its older, coarser
 * strings for compatibility and cannot tell these states apart (`nothing_charged` covers both `capture_failed` and
 * `not_found`, and `already_refunded` covers both `already_released` and `already_expired`).
 */
export type RefundOutcome = "released" | "already_released" | "already_expired" | "already_captured" | "capture_failed" | "not_found";

export interface RefundResult {
  refunded: boolean;
  amount: number;
  /** Credits available after the call. */
  balance: number;
  ledgerId: null;
  outcome: RefundOutcome;
  reason?: "nothing_charged" | "already_refunded" | "not_refundable";
  /** True only when an earlier refund or expiry already released the hold. Absent otherwise. */
  alreadyProcessed?: true;
}

/** The one answer to every refused capability, so the caller learns nothing about why. */
export function settlementNotAuthorized(): AppError {
  return new AppError(403, "Settlement not authorized.", "SETTLEMENT_NOT_AUTHORIZED");
}

/**
 * What a failed capture transaction means for the caller:
 *  - retryable: it rolled back, or the database is out of reach; running it again in a new transaction is safe.
 *  - ambiguous_commit: COMMIT got no usable answer, so it may have committed. The data must be read again.
 *  - indeterminate: anything else. It rolled back, but nothing says a retry would behave differently. Never retried.
 *
 * Decided by SQLSTATE and client state only. The message-based match inside isDatabaseUnavailableError is that function's
 * existing behaviour for three pg-pool strings, which carry no code; nothing is added to it here.
 */
export type CaptureErrorClass = "retryable" | "ambiguous_commit" | "indeterminate";

export function classifyCaptureError(err: unknown): CaptureErrorClass {
  if (isAmbiguousCommitError(err)) return "ambiguous_commit";
  if (isTransientDatabaseError(err) || isConnectionLossError(err) || isDatabaseUnavailableError(err)) return "retryable";
  return "indeterminate";
}

/** Diagnostic fields of a capture failure. Never the message, detail, where, SQL text, parameters, token or secret. */
function captureErrorFields(err: unknown) {
  return { ...safeDbErrorFields(err), connectionLost: isConnectionLossError(err) };
}

/** The capture rolled back and no retry is expected. Nothing was charged, because no COMMIT succeeded or was even in doubt. */
function captureIndeterminateRolledBack(): AppError {
  return new AppError(409, "Capture could not be confirmed; nothing was charged.", "CAPTURE_INDETERMINATE", { commitOutcome: "rolled_back" });
}

/** It may or may not have committed, and reading the data failed too. A 5xx on purpose: a retry reads the truth and cannot debit twice. */
function captureIndeterminateUnknown(): AppError {
  return new AppError(503, "The capture outcome could not be confirmed.", "CAPTURE_INDETERMINATE", { commitOutcome: "unknown" });
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
    `SELECT status, amount, operation_type, expires_at <= NOW() AS expired, ledger_id::text,
            user_id::text, reference_id, ${HOLD_SECONDS_COLUMNS}
     FROM ai_credit_holds
     WHERE user_id = $1 AND reference_id = $2
     FOR UPDATE`,
    [userId, referenceId],
  );
  return rows[0] ?? null;
}

/**
 * With a capability: is the locked row the reservation this token was minted for? Refuses before any state logic and writes
 * nothing, so an idempotent retry of a genuine token still passes while a mismatched one changes nothing. Without claims
 * (the legacy session path, and direct callers) there is nothing to compare.
 *
 * The claims here have a valid signature, so a mismatch means a key is being misused or a row was replaced: error level.
 */
function assertHoldMatchesCapability(hold: HoldRow, claims: SettlementClaims | undefined): void {
  if (!claims) return;
  const match = matchesHoldRow(claims, {
    userId: hold.user_id,
    referenceId: hold.reference_id,
    amount: hold.amount,
    operationType: hold.operation_type,
    createdAtSeconds: hold.created_at_s,
    expiresAtSeconds: hold.expires_at_s,
  });
  if (match.ok) return;
  console.error("[settlement] SETTLEMENT_AUTH_REJECTED", { purpose: claims.pur, reason: "row_mismatch", field: match.field, referenceId: claims.ref });
  throw settlementNotAuthorized();
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
 * @throws SettlementCapabilityConfigError when the signing key is not configured. The reservation rolls back: a hold
 *         must never exist without its tokens, because nothing could then settle it before it expires.
 *
 * With `options.trackDelivery` the hold is created with delivery_tracking_enabled = true and a third token (delivery_ack)
 * is minted in the same transaction. Without it the INSERT is the one this function always had, so an untracked reservation
 * works whether or not migration 019 has been applied.
 */
export async function reserveCreditsForOperation(
  userId: string,
  operationType: unknown,
  referenceIdInput: unknown,
  options: ReserveOptions = {},
): Promise<ReserveResult> {
  if (!isAiOperationType(operationType)) {
    throw new AppError(400, "Unknown AI operation.", "INVALID_OPERATION");
  }
  const referenceId = assertValidReference(referenceIdInput);
  const cost = costForOperation(operationType);
  const trackDelivery = options.trackDelivery === true;

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

    // Constant fragments only: nothing from the request is ever spliced into this statement.
    const insertColumns = trackDelivery ? "user_id, reference_id, operation_type, amount, expires_at, delivery_tracking_enabled" : "user_id, reference_id, operation_type, amount, expires_at";
    const insertValues = trackDelivery ? "$1, $2, $3, $4, NOW() + make_interval(secs => $5), true" : "$1, $2, $3, $4, NOW() + make_interval(secs => $5)";
    const { rows } = await client.query<Pick<HoldRow, "user_id" | "reference_id" | "amount" | "operation_type" | "created_at_s" | "expires_at_s"> & { expires_at: Date }>(
      `INSERT INTO ai_credit_holds (${insertColumns})
       VALUES (${insertValues})
       RETURNING expires_at, user_id::text, reference_id, amount, operation_type, ${HOLD_SECONDS_COLUMNS}`,
      [userId, referenceId, operationType, cost, env.aiHoldTtlSeconds],
    );
    const hold = rows[0]!;

    // The last step of the transaction, from what was actually stored: a failure here rolls the reservation back.
    const binding: SettlementBinding = {
      userId: hold.user_id,
      referenceId: hold.reference_id,
      amount: hold.amount,
      operationType: hold.operation_type,
      createdAtSeconds: hold.created_at_s,
      reservationExpiresAtSeconds: hold.expires_at_s,
    };
    const keys = resolveSettlementKeys();
    return {
      balance: available - cost,
      expiresAt: hold.expires_at.toISOString(),
      captureCapabilityToken: mintSettlementCapability("capture", binding, keys),
      refundCapabilityToken: mintSettlementCapability("refund", binding, keys),
      ...(trackDelivery ? { deliveryAckCapabilityToken: mintSettlementCapability("delivery_ack", binding, keys) } : {}),
    };
  });

  return {
    operationType,
    cost,
    balance: result.balance,
    status: "held",
    expiresAt: result.expiresAt,
    ledgerId: null,
    alreadyProcessed: false,
    captureCapabilityToken: result.captureCapabilityToken,
    refundCapabilityToken: result.refundCapabilityToken,
    ...(result.deliveryAckCapabilityToken ? { deliveryAckCapabilityToken: result.deliveryAckCapabilityToken } : {}),
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
 * @throws 403 SETTLEMENT_NOT_AUTHORIZED — `claims` were given and do not match the row; nothing changes
 * @throws 409 CAPTURE_INDETERMINATE — an unknown error; fully rolled back, the hold stays 'held', not to be retried
 * @throws 503 CAPTURE_INDETERMINATE — COMMIT got no answer and the outcome could not be read either; safe to retry
 * @throws the original database error when it is retryable (503 via errorHandler), in which case the hold is unchanged
 *
 * There is no retry loop here: the caller retries, and every attempt is a new transaction under the same locks, so a capture
 * that already committed is found instead of debited again.
 *
 * @param claims verified capability claims, on the capability path only
 */
export async function captureOperation(userId: string, referenceIdInput: unknown, claims?: SettlementClaims): Promise<CaptureResult> {
  const referenceId = assertValidReference(referenceIdInput);

  let outcome: Awaited<ReturnType<typeof runCaptureTransaction>>;
  try {
    outcome = await runCaptureTransaction(userId, referenceId, claims);
  } catch (err) {
    // Business refusals: HOLD_NOT_FOUND, NOT_CAPTURABLE, a capability mismatch. Their rollback is the intended result.
    if (err instanceof AppError) throw err;
    const errorClass = classifyCaptureError(err);
    console.warn("[credits] CAPTURE_ERROR_CLASSIFIED", {
      event: "CAPTURE_ERROR_CLASSIFIED",
      operation: "capture",
      referenceId,
      bucket: errorClass,
      ...captureErrorFields(err),
    });
    if (errorClass === "ambiguous_commit") return inspectAfterAmbiguousCommit(userId, referenceId, err);
    if (errorClass === "retryable") throw err;
    throw captureIndeterminateRolledBack();
  }

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
 * COMMIT got no usable answer. A new transaction reads the hold under the same locks the capture held, so getting them means
 * that transaction has ended and the row shows how. Read-only: it never debits, and it reports only what it finds.
 *  - captured: it committed. The original result, with the original ledger id.
 *  - held: it did not commit. The original (retryable) error, and the caller's next attempt is a new transaction.
 *  - settled some other way: refused like any later capture of that hold.
 *  - could not be read: the explicit "could not be established", and the hold is left exactly as it is.
 */
async function inspectAfterAmbiguousCommit(userId: string, referenceId: string, commitError: unknown): Promise<CaptureResult> {
  const logResolution = (resolution: string, fields: Record<string, unknown> = {}) =>
    console.warn("[credits] CAPTURE_AMBIGUOUS_COMMIT", { event: "CAPTURE_AMBIGUOUS_COMMIT", operation: "capture", referenceId, resolution, ...fields });

  let found: { hold: HoldRow | null; balance: number };
  try {
    found = await withTransaction(async (client) => {
      await client.query(`SET LOCAL lock_timeout = ${CAPTURE_INSPECTION_LOCK_TIMEOUT_MS}`);
      await lockUser(client, userId);
      const hold = await findHold(client, userId, referenceId);
      return { hold, balance: hold?.status === "captured" ? await cachedBalance(client, userId) : 0 };
    });
  } catch (err) {
    logResolution("unresolved", captureErrorFields(err));
    throw captureIndeterminateUnknown();
  }

  const { hold, balance } = found;
  if (hold?.status === "captured") {
    logResolution("committed");
    return { captured: true, amount: hold.amount, balance, ledgerId: hold.ledger_id!, alreadyProcessed: true };
  }
  if (hold?.status === "held") {
    logResolution("not_committed");
    throw commitError;
  }
  if (!hold) {
    // A hold cannot be deleted while the capture holds its lock, and the service role cannot delete one at all.
    logResolution("unresolved");
    throw captureIndeterminateUnknown();
  }
  logResolution("not_committed", { holdStatus: hold.status });
  throw new AppError(409, "This operation can no longer be captured.", "NOT_CAPTURABLE", { status: hold.status });
}

/** One attempt at the capture, in its own transaction. */
function runCaptureTransaction(userId: string, referenceId: string, claims: SettlementClaims | undefined) {
  return withTransaction(async (client) => {
      await lockUser(client, userId);
      const hold = await findHold(client, userId, referenceId);
      if (!hold) {
        throw new AppError(404, "No reservation for this operation.", "HOLD_NOT_FOUND");
      }
      assertHoldMatchesCapability(hold, claims);
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
        const code = pgErrorCode(err);
        // Not terminal: the whole transaction must roll back and release its locks. Rolling back only to the savepoint would
        // keep the locks a deadlock partner is waiting for, and it would commit a 'capture_failed' the error does not justify.
        if (!code || !TERMINAL_DEBIT_SQLSTATES.has(code)) throw err;
        await client.query("ROLLBACK TO SAVEPOINT capture_debit");
        const reason = code === PG_INSUFFICIENT_CREDITS ? "insufficient_credits_at_capture" : `db_error_${code}`;
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
}

/**
 * Release a held reservation after a failed operation. Never writes to the ledger.
 * Safe to call blindly: unknown, already-released and expired references are no-ops;
 * a captured operation is never refundable. Each case reports its `outcome`.
 *
 * @throws 403 SETTLEMENT_NOT_AUTHORIZED — `claims` were given and do not match the row; nothing changes
 *
 * @param claims verified capability claims, on the capability path only
 */
export async function releaseOperation(userId: string, referenceIdInput: unknown, reason: string, claims?: SettlementClaims): Promise<RefundResult> {
  const referenceId = assertValidReference(referenceIdInput);
  const settleReason = reason.slice(0, 200) || "released";

  return withTransaction(async (client) => {
    await lockUser(client, userId);
    const hold = await findHold(client, userId, referenceId);

    if (!hold) {
      return { refunded: false, amount: 0, balance: await availableBalance(client, userId), ledgerId: null, outcome: "not_found", reason: "nothing_charged" };
    }
    assertHoldMatchesCapability(hold, claims);
    if (hold.status === "captured") {
      return { refunded: false, amount: hold.amount, balance: await availableBalance(client, userId), ledgerId: null, outcome: "already_captured", reason: "not_refundable" };
    }
    if (hold.status === "capture_failed") {
      return { refunded: false, amount: hold.amount, balance: await availableBalance(client, userId), ledgerId: null, outcome: "capture_failed", reason: "nothing_charged" };
    }
    if (hold.status !== "held") {
      return {
        refunded: false,
        amount: hold.amount,
        balance: await availableBalance(client, userId),
        ledgerId: null,
        outcome: hold.status === "expired" ? "already_expired" : "already_released",
        reason: "already_refunded",
        alreadyProcessed: true,
      };
    }

    await client.query(
      `UPDATE ai_credit_holds SET status = 'released', settled_at = NOW(), settle_reason = $3
       WHERE user_id = $1 AND reference_id = $2`,
      [userId, referenceId, settleReason],
    );
    const balance = await availableBalance(client, userId);
    console.log("[credits] Released", { userId, amount: hold.amount, referenceId, reason: settleReason, balance });
    return { refunded: true, amount: hold.amount, balance, ledgerId: null, outcome: "released" };
  });
}

/** Settle every expired reservation (never charged). Returns how many were settled. */
export async function releaseExpiredHolds(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT release_expired_ai_holds() AS n`);
  return rows[0]?.n ?? 0;
}
