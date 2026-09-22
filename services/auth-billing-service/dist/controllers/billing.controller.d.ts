import type { Request, Response, NextFunction } from "express";
export declare function getBalance(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function getHistory(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * POST /api/billing/checkout
 * Body: { packageId }  — all purchases settle in USD via Lemon Squeezy.
 */
export declare function createCheckout(req: Request, res: Response, next: NextFunction): Promise<void>;
/** GET /api/billing/operation-costs — server-authoritative AI price list. */
export declare function getOperationCosts(_req: Request, res: Response): void;
/**
 * POST /api/billing/consume
 * Body: { operationType, referenceId, metadata? }
 *
 * Returns 402 with `{ success: false, code: "INSUFFICIENT_CREDITS", requiredCredits }`
 * when the balance is too low — the shape the web client keys off to open the
 * billing modal.
 */
export declare function consumeCredits(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * POST /api/billing/refund
 * Body: { referenceId, reason? }
 *
 * Compensating transaction for an AI operation that failed after being charged.
 * Always 200 — "nothing was charged" and "already refunded" are normal outcomes
 * reported in the body, not errors, so a caller can fire this from a catch block
 * without needing to branch.
 */
export declare function refundCredits(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function deductCredits(req: Request, res: Response, next: NextFunction): Promise<void>;
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
export declare function lemonSqueezyWebhook(req: Request, res: Response): void;
