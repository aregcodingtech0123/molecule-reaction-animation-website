import { pool } from "../db/index.js";
import { AI_OPERATION_LABELS, costForOperation, isAiOperationType, } from "../config/aiOperations.js";
import { AppError } from "../types/index.js";
/** Postgres raises this from post_credit_transaction when a spend would go negative. */
const PG_INSUFFICIENT_CREDITS = "P0001";
/** Unique violation — our idempotency index caught a replay. */
const PG_UNIQUE_VIOLATION = "23505";
const MAX_REFERENCE_LENGTH = 255;
function pgErrorCode(err) {
    return err && typeof err === "object" && "code" in err
        ? (err.code ?? null)
        : null;
}
/** Balance without the 404 that `billing.service.getBalanceForUser` throws — absent row means zero. */
async function readBalance(userId) {
    const result = await pool.query(`SELECT balance FROM user_balances WHERE user_id = $1 LIMIT 1`, [userId]);
    return result.rows[0]?.balance ?? 0;
}
function assertValidReference(referenceId) {
    const trimmed = referenceId?.trim();
    if (!trimmed) {
        throw new AppError(400, "referenceId is required.", "INVALID_REFERENCE");
    }
    if (trimmed.length > MAX_REFERENCE_LENGTH) {
        throw new AppError(400, "referenceId is too long.", "INVALID_REFERENCE");
    }
    return trimmed;
}
async function findLedgerRow(userId, transactionType, referenceId) {
    const result = await pool.query(`SELECT id::text, amount FROM credit_ledger_transactions
      WHERE user_id = $1
        AND transaction_type = $2::credit_transaction_type
        AND reference_id = $3
      LIMIT 1`, [userId, transactionType, referenceId]);
    return result.rows[0] ?? null;
}
/**
 * Charge a user for one AI operation.
 *
 * The pre-flight balance read below is a courtesy: it lets us return a precise
 * 402 without touching the ledger. It is NOT the safety guard, because another
 * request can spend the balance between the read and the write. The real guard
 * is inside `post_credit_transaction`, which takes a per-user advisory lock and
 * refuses any update that would drive the balance below zero (P0001). Both
 * paths surface the same INSUFFICIENT_CREDITS error.
 *
 * @throws AppError 400 on an unknown operation or malformed reference
 * @throws AppError 402 `INSUFFICIENT_CREDITS` with `requiredCredits` + `balance`
 */
export async function consumeCreditsForOperation(userId, operationType, metadata) {
    if (!isAiOperationType(operationType)) {
        throw new AppError(400, "Unknown AI operation.", "INVALID_OPERATION");
    }
    const referenceId = assertValidReference(metadata?.referenceId);
    const cost = costForOperation(operationType);
    const existing = await findLedgerRow(userId, "CREDIT_CONSUMPTION", referenceId);
    if (existing) {
        return {
            operationType,
            cost,
            balance: await readBalance(userId),
            ledgerId: existing.id,
            alreadyProcessed: true,
        };
    }
    const balance = await readBalance(userId);
    if (balance < cost) {
        throw new AppError(402, "Insufficient credits.", "INSUFFICIENT_CREDITS", {
            requiredCredits: cost,
            balance,
            operationType,
        });
    }
    let ledgerId;
    try {
        const posted = await pool.query(`SELECT post_credit_transaction($1, $2, 'CREDIT_CONSUMPTION'::credit_transaction_type, $3) AS ledger_id`, [userId, -cost, referenceId]);
        ledgerId = posted.rows[0]?.ledger_id ?? null;
    }
    catch (err) {
        const code = pgErrorCode(err);
        if (code === PG_INSUFFICIENT_CREDITS) {
            throw new AppError(402, "Insufficient credits.", "INSUFFICIENT_CREDITS", {
                requiredCredits: cost,
                balance: await readBalance(userId),
                operationType,
            });
        }
        // Concurrent replay of the same reference — the first one won, so this is a
        // success from the caller's point of view, not a double charge.
        if (code === PG_UNIQUE_VIOLATION) {
            const winner = await findLedgerRow(userId, "CREDIT_CONSUMPTION", referenceId);
            return {
                operationType,
                cost,
                balance: await readBalance(userId),
                ledgerId: winner?.id ?? null,
                alreadyProcessed: true,
            };
        }
        throw err;
    }
    const newBalance = await readBalance(userId);
    console.log("[credits] Consumed", {
        userId,
        operation: AI_OPERATION_LABELS[operationType],
        cost,
        referenceId,
        newBalance,
        ledgerId,
    });
    return { operationType, cost, balance: newBalance, ledgerId, alreadyProcessed: false };
}
/**
 * Give back credits when an AI operation failed after it was charged.
 *
 * Refunds the amount actually taken, read back from the ledger, rather than the
 * current price — a price change between the charge and the failure must not
 * hand the user more (or less) than they paid.
 *
 * Safe to call blindly: it is a no-op when nothing was charged for this
 * reference, and a no-op when a refund already exists.
 */
export async function refundOperation(userId, referenceId, reason) {
    const reference = assertValidReference(referenceId);
    const charge = await findLedgerRow(userId, "CREDIT_CONSUMPTION", reference);
    if (!charge) {
        return {
            refunded: false,
            amount: 0,
            balance: await readBalance(userId),
            ledgerId: null,
            reason: "nothing_charged",
        };
    }
    const alreadyRefunded = await findLedgerRow(userId, "CREDIT_REFUND", reference);
    if (alreadyRefunded) {
        return {
            refunded: false,
            amount: Math.abs(alreadyRefunded.amount),
            balance: await readBalance(userId),
            ledgerId: alreadyRefunded.id,
            reason: "already_refunded",
        };
    }
    const amount = Math.abs(charge.amount);
    try {
        const posted = await pool.query(`SELECT post_credit_transaction($1, $2, 'CREDIT_REFUND'::credit_transaction_type, $3) AS ledger_id`, [userId, amount, reference]);
        const balance = await readBalance(userId);
        console.log("[credits] Refunded", { userId, amount, referenceId: reference, reason, balance });
        return { refunded: true, amount, balance, ledgerId: posted.rows[0]?.ledger_id ?? null };
    }
    catch (err) {
        if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
            const winner = await findLedgerRow(userId, "CREDIT_REFUND", reference);
            return {
                refunded: false,
                amount,
                balance: await readBalance(userId),
                ledgerId: winner?.id ?? null,
                reason: "already_refunded",
            };
        }
        throw err;
    }
}
//# sourceMappingURL=aiCredits.service.js.map