import type { Request, Response, NextFunction } from "express";
import * as billingService from "../services/billing.service.js";
import { captureOperation, releaseOperation, reserveCreditsForOperation } from "../services/aiCredits.service.js";
import { AI_OPERATION_COSTS, isAiOperationType } from "../config/aiOperations.js";
import { createUnifiedCheckout } from "../services/checkout.service.js";
import { verifyAndParseLemonEvent } from "../services/webhook.service.js";
import { processStoredWebhookEvent, storeWebhookEvent } from "../services/webhookInbox.service.js";
import { env } from "../config/env.js";
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
    const cursor = req.query.cursor === undefined ? null : billingService.decodeHistoryCursor(req.query.cursor);
    const page = await billingService.getLedgerHistoryForUser(userId, limit, cursor);

    res.json({
      success: true,
      data: { transactions: page.transactions, nextCursor: page.nextCursor },
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

/** Reject after `ms` (the work itself keeps running; its late result is ignored). */
function withTimeout<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`not stored within ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Lemon Squeezy webhook — store, then acknowledge (R19).
 *
 * Stage 1 (synchronous): verify the `X-Signature` HMAC over the raw body.
 *   Invalid or missing signature -> 401 immediately, no database contact.
 * Stage 2: store the verified delivery in `lemon_webhook_events` (one INSERT, bounded by
 *   WEBHOOK_STORE_TIMEOUT_MS, default 3 s), THEN answer 200. If it cannot be stored in time
 *   (database down, resuming or saturated) the answer is 503 and Lemon retries the delivery
 *   (up to three more times: 5 s, 25 s, 125 s — Lemon's webhook docs). A slow database
 *   therefore never holds Lemon's request open longer than the deadline.
 * Stage 3 (background): process the stored event. A failure is recorded on the row and retried
 *   by the service (retryStoredWebhookEvents) — never lost: before R19 the 200 came first and a
 *   failed allocation needed a manual resend from Lemon's dashboard.
 */
export async function lemonSqueezyWebhook(req: Request, res: Response): Promise<void> {
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

  const orderId = event.data?.id ?? null;
  const eventName = event.meta?.event_name ?? "unknown";

  // ── Stage 2: store the delivery, then acknowledge ──────────────────────────
  let stored;
  try {
    stored = await withTimeout(env.webhookStoreTimeoutMs, storeWebhookEvent(rawBody, event));
  } catch (err) {
    console.error("[Webhook] NOT STORED — answered 503 so Lemon retries the delivery", {
      event: eventName,
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Webhook temporarily unavailable" });
    return;
  }

  res.status(200).json({ received: true });
  console.log("[Webhook] Acknowledged 200 OK", {
    event: eventName,
    orderId,
    storedEventId: stored.id,
    ...(stored.inserted ? {} : { duplicateOf: stored.status }),
  });

  // ── Stage 3: background processing of the stored event ─────────────────────
  if (stored.status === "processed") return;
  const id = stored.id;
  setImmediate(() => {
    void processStoredWebhookEvent(id).catch((err) =>
      // Only the claim itself can throw here (database gone): the row stays stored and is retried.
      console.warn("[Webhook] Processing deferred — the event is stored and will be retried", {
        storedEventId: id,
        orderId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  });
}
