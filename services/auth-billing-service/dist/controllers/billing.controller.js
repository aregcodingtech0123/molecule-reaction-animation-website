import * as billingService from "../services/billing.service.js";
import { consumeCreditsForOperation, refundOperation } from "../services/aiCredits.service.js";
import { AI_OPERATION_COSTS, isAiOperationType } from "../config/aiOperations.js";
import { createUnifiedCheckout } from "../services/checkout.service.js";
import { processLemonSqueezyEvent, verifyAndParseLemonEvent, } from "../services/webhook.service.js";
import { AppError } from "../types/index.js";
export async function getBalance(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const balance = await billingService.getBalanceForUser(userId);
        res.json({
            success: true,
            data: {
                userId,
                balance,
                hasCredits: balance > 0,
            },
        });
    }
    catch (err) {
        next(err);
    }
}
export async function getHistory(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const limit = Number(req.query.limit ?? 100);
        const transactions = await billingService.getLedgerHistoryForUser(userId, limit);
        res.json({
            success: true,
            data: { transactions },
        });
    }
    catch (err) {
        next(err);
    }
}
/**
 * POST /api/billing/checkout
 * Body: { packageId }  — all purchases settle in USD via Lemon Squeezy.
 */
export async function createCheckout(req, res, next) {
    try {
        const userId = req.user?.sub;
        const userEmail = req.user?.email;
        if (!userId || !userEmail) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const body = req.body ?? {};
        const checkout = await createUnifiedCheckout({
            userId,
            userEmail,
            packageId: body.packageId,
            returnPath: body.returnPath,
        });
        res.json({
            success: true,
            data: checkout,
        });
    }
    catch (err) {
        if (err instanceof Error && err.message === "INVALID_PACKAGE") {
            next(new AppError(400, "Invalid credit package.", "INVALID_PACKAGE"));
            return;
        }
        next(err);
    }
}
/** GET /api/billing/operation-costs — server-authoritative AI price list. */
export function getOperationCosts(_req, res) {
    res.json({ success: true, data: { costs: AI_OPERATION_COSTS } });
}
/**
 * POST /api/billing/consume
 * Body: { operationType, referenceId, metadata? }
 *
 * Returns 402 with `{ success: false, code: "INSUFFICIENT_CREDITS", requiredCredits }`
 * when the balance is too low — the shape the web client keys off to open the
 * billing modal.
 */
export async function consumeCredits(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const { operationType, referenceId, metadata } = req.body ?? {};
        if (!isAiOperationType(operationType)) {
            throw new AppError(400, "Unknown AI operation.", "INVALID_OPERATION");
        }
        const result = await consumeCreditsForOperation(userId, operationType, {
            ...(metadata && typeof metadata === "object" ? metadata : {}),
            referenceId: String(referenceId ?? ""),
        });
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
/**
 * POST /api/billing/refund
 * Body: { referenceId, reason? }
 *
 * Compensating transaction for an AI operation that failed after being charged.
 * Always 200 — "nothing was charged" and "already refunded" are normal outcomes
 * reported in the body, not errors, so a caller can fire this from a catch block
 * without needing to branch.
 */
export async function refundCredits(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const { referenceId, reason } = req.body ?? {};
        const result = await refundOperation(userId, String(referenceId ?? ""), String(reason ?? "ai_operation_failed"));
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function deductCredits(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const { amount, type, referenceId } = req.body ?? {};
        const result = await billingService.deductCreditsForUser(userId, Number(amount), String(type ?? ""), String(referenceId ?? ""));
        res.json({
            success: true,
            data: {
                newBalance: result.newBalance,
                ledgerId: result.ledgerId,
                alreadyProcessed: result.alreadyProcessed,
            },
        });
    }
    catch (err) {
        next(err);
    }
}
/** Lemon Squeezy — raw JSON + X-Signature HMAC-SHA256 */
/**
 * Lemon Squeezy webhook — fast-acknowledge architecture.
 *
 * Stage 1 (synchronous): verify the `X-Signature` HMAC over the raw body.
 *   Invalid or missing signature -> 401 immediately, no database contact.
 * Stage 2 (synchronous): acknowledge with 200 so the delivery never sits in
 *   "Pending" while Postgres is queried.
 * Stage 3 (background): allocate credits. Any failure is caught and logged —
 *   it can neither crash the process nor hold the HTTP connection open.
 *
 * NOTE: because stage 2 already returned 200, Lemon Squeezy will NOT retry a
 * stage 3 failure. Failures are logged with the [Webhook] FAILED prefix and
 * must be replayed manually from the Lemon Squeezy dashboard.
 */
export function lemonSqueezyWebhook(req, res) {
    const rawBody = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
    if (!rawBody?.length) {
        res.status(400).json({ error: "Webhook requires raw request body." });
        return;
    }
    const signatureHeader = typeof req.headers["x-signature"] === "string" ? req.headers["x-signature"] : undefined;
    // ── Stage 1: synchronous signature gate (crypto only, no I/O) ──────────────
    let event;
    try {
        event = verifyAndParseLemonEvent(rawBody, signatureHeader);
    }
    catch (err) {
        const status = err instanceof AppError ? err.statusCode : 401;
        // Log server-side only; never leak the stack trace to the caller.
        console.warn("[Webhook] Rejected:", err instanceof Error ? err.message : String(err));
        res.status(status).json({ error: status === 503 ? "Webhook not configured" : "Invalid signature" });
        return;
    }
    // ── Stage 2: acknowledge BEFORE any database work ──────────────────────────
    res.status(200).json({ received: true });
    console.log("[Webhook] Acknowledged 200 OK", {
        event: event.meta?.event_name ?? "unknown",
        orderId: event.data?.id ?? null,
    });
    // ── Stage 3: background fulfilment (never awaited by the request) ──────────
    setImmediate(() => {
        void (async () => {
            try {
                await processLemonSqueezyEvent(event);
            }
            catch (err) {
                console.error("[Webhook] FAILED background credit allocation — replay this event manually:", {
                    orderId: event.data?.id ?? null,
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined,
                });
            }
        })();
    });
}
//# sourceMappingURL=billing.controller.js.map