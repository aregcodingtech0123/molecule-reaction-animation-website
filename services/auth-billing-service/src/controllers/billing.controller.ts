import type { Request, Response, NextFunction } from "express";
import * as billingService from "../services/billing.service.js";
import { captureOperation, releaseOperation, reserveCreditsForOperation } from "../services/aiCredits.service.js";
import { AI_OPERATION_COSTS, isAiOperationType } from "../config/aiOperations.js";
import { createUnifiedCheckout } from "../services/checkout.service.js";
import {
  processLemonSqueezyEvent,
  verifyAndParseLemonEvent,
} from "../services/webhook.service.js";
import { AppError } from "../types/index.js";

export async function getBalance(req: Request, res: Response, next: NextFunction): Promise<void> {
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
  } catch (err) {
    next(err);
  }
}

const DEFAULT_HISTORY_LIMIT = 100;

/**
 * `?limit=` → a number the service clamps to 1..200. Anything that is not an
 * integer (or ±Infinity) — "abc", "2.7", "NaN", a repeated parameter — falls
 * back to the default page size instead of reaching SQL as NaN (FINDING-08).
 */
function parseHistoryLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_HISTORY_LIMIT;
  if (typeof raw !== "string") return DEFAULT_HISTORY_LIMIT;
  const n = Number(raw);
  if (Number.isNaN(n)) return DEFAULT_HISTORY_LIMIT;
  if (Number.isFinite(n) && !Number.isInteger(n)) return DEFAULT_HISTORY_LIMIT;
  return n;
}

export async function getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
    }

    const limit = parseHistoryLimit(req.query.limit);
    const transactions = await billingService.getLedgerHistoryForUser(userId, limit);

    res.json({
      success: true,
      data: { transactions },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/checkout
 * Body: { packageId }  — all purchases settle in USD via Lemon Squeezy.
 */
export async function createCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
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
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_PACKAGE") {
      next(new AppError(400, "Invalid credit package.", "INVALID_PACKAGE"));
      return;
    }
    next(err);
  }
}

/** GET /api/billing/operation-costs — server-authoritative AI price list. */
export function getOperationCosts(_req: Request, res: Response): void {
  res.json({ success: true, data: { costs: AI_OPERATION_COSTS } });
}

/**
 * POST /api/billing/consume — internal only (BFF). Reserves the price of one AI
 * operation; nothing is debited until /capture.
 * Body: { operationType, referenceId }
 *
 * 402 `{ success:false, code:"INSUFFICIENT_CREDITS", requiredCredits, balance }`
 * 409 `OPERATION_ALREADY_EXISTS` when the reference was already used.
 */
export async function consumeCredits(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
    }
    const { operationType, referenceId } = req.body ?? {};
    const result = await reserveCreditsForOperation(userId, operationType, referenceId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/capture — internal only (BFF). Charges a held reservation
 * exactly once after the AI operation succeeded.
 * Body: { referenceId }
 */
export async function captureCredits(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
    }
    const result = await captureOperation(userId, req.body?.referenceId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/refund — internal only (BFF). Releases a held reservation
 * after the AI operation failed. Never refunds a captured (successful) charge.
 * Body: { referenceId, reason? }
 *
 * Always 200: "nothing charged", "already released" and "not refundable" are
 * normal outcomes reported in the body.
 */
export async function refundCredits(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
    }
    const { referenceId, reason } = req.body ?? {};
    const result = await releaseOperation(userId, referenceId, String(reason ?? "ai_operation_failed"));
    res.json({ success: true, data: result });
  } catch (err) {
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
export function lemonSqueezyWebhook(req: Request, res: Response): void {
  const rawBody = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
  if (!rawBody?.length) {
    res.status(400).json({ error: "Webhook requires raw request body." });
    return;
  }

  const signatureHeader =
    typeof req.headers["x-signature"] === "string" ? req.headers["x-signature"] : undefined;

  // ── Stage 1: synchronous signature gate (crypto only, no I/O) ──────────────
  let event;
  try {
    event = verifyAndParseLemonEvent(rawBody, signatureHeader);
  } catch (err) {
    const status = err instanceof AppError ? err.statusCode : 401;
    // Log server-side only; never leak the stack trace to the caller.
    console.warn("[Webhook] Rejected:", err instanceof Error ? err.message : String(err));
    // 400 only happens after the signature was verified (FINDING-14).
    const error = status === 503 ? "Webhook not configured" : status === 400 ? "Invalid webhook body" : "Invalid signature";
    res.status(status).json({ error });
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
      } catch (err) {
        console.error(
          "[Webhook] FAILED background credit allocation — replay this event manually:",
          {
            orderId: event.data?.id ?? null,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          },
        );
      }
    })();
  });
}
