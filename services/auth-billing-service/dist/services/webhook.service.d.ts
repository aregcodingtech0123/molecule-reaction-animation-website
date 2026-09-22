import { type LemonOrderCreatedEvent } from "../lib/lemonsqueezy.js";
/**
 * Stage 1 — SYNCHRONOUS gate. No I/O, no database.
 *
 * Verifies the `X-Signature` HMAC-SHA256 over the raw body and parses the JSON.
 * Throws `AppError(401)` on a bad/missing signature and `AppError(503)` when
 * `LEMONSQUEEZY_WEBHOOK_SECRET` is unset. Callers run this BEFORE acknowledging
 * so an unauthenticated request never reaches the database.
 */
export declare function verifyAndParseLemonEvent(rawBody: Buffer, signatureHeader: string | undefined): LemonOrderCreatedEvent;
export interface ProcessOutcome {
    processed: boolean;
    reason?: string;
    ledgerId?: string | null;
    userId?: string;
    packageId?: string;
    creditAmount?: number;
    variantId?: string | number | null;
    orderId?: string;
}
/**
 * Stage 2 — ASYNCHRONOUS fulfilment. Runs AFTER the 200 OK has been flushed,
 * so its latency never holds the Lemon Squeezy delivery open.
 *
 * 1) Resolve user from `meta.custom_data.user_id` (fallback: order email)
 * 2) Resolve package from variant_id, falling back to `custom_data.package_id`
 * 3) Credit the user via the immutable ledger (`CREDIT_PURCHASE`)
 *
 * Never throws for business-rule rejections — it returns a reason so the caller
 * can log it. Genuine faults (for example the database being unreachable) do
 * propagate, and the caller is responsible for catching them.
 */
export declare function processLemonSqueezyEvent(event: LemonOrderCreatedEvent): Promise<ProcessOutcome>;
/** Health probe — verify DB connectivity for billing ops. */
export declare function pingBillingDb(): Promise<void>;
