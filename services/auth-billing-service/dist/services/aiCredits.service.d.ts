import { type AiOperationType } from "../config/aiOperations.js";
export interface ConsumeMetadata {
    /**
     * Idempotency key for the operation — typically the AI job / chat turn id.
     * Replaying the same reference never charges twice.
     */
    referenceId: string;
    /** Free-form context; logged alongside the spend, not persisted to the ledger. */
    [key: string]: unknown;
}
export interface ConsumeResult {
    operationType: AiOperationType;
    cost: number;
    balance: number;
    ledgerId: string | null;
    /** True when this reference had already been charged — no new deduction occurred. */
    alreadyProcessed: boolean;
}
export interface RefundResult {
    refunded: boolean;
    amount: number;
    balance: number;
    ledgerId: string | null;
    reason?: string;
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
export declare function consumeCreditsForOperation(userId: string, operationType: AiOperationType, metadata: ConsumeMetadata): Promise<ConsumeResult>;
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
export declare function refundOperation(userId: string, referenceId: string, reason: string): Promise<RefundResult>;
