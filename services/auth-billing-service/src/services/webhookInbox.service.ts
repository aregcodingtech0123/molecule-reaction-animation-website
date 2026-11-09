/**
 * Durable inbox for Lemon Squeezy webhooks (R19, migration 015).
 *
 * The webhook stores every verified delivery with ONE insert before it answers 200, then processes it from
 * the stored row. A delivery that cannot be stored is answered 503 and Lemon retries it (5 s, 25 s, 125 s);
 * a stored event whose processing fails is retried here (retryStoredWebhookEvents, every
 * WEBHOOK_RETRY_INTERVAL_MS, up to MAX_AUTOMATIC_ATTEMPTS) and can always be replayed by hand
 * (`npm run webhooks:replay`). Unfinished events are listed by `db:reconcile`.
 *
 * Fulfilment itself is unchanged (processLemonSqueezyEvent: origin gate, amount / currency checks,
 * crediting idempotent per order), so processing an event twice can never credit twice.
 */
import { createHash } from "node:crypto";
import { safeErrorDescription, safeErrorLogFields, safeStackFrames } from "../db/diagnostics.js";
import { pool } from "../db/index.js";
import { parseLemonSqueezyEvent, type LemonOrderCreatedEvent } from "../lib/lemonsqueezy.js";
import { AppError } from "../types/index.js";
import { processLemonSqueezyEvent, type ProcessOutcome } from "./webhook.service.js";

/** Automatic attempts per event (≈ 10 min at the default 60 s interval); `webhooks:replay` ignores it. */
export const MAX_AUTOMATIC_ATTEMPTS = 10;
/** A stored event the immediate processing has not picked up within this is retried by the worker. */
const RETRY_GRACE = "30 seconds";
/** A claim older than this belongs to a process that died mid-way: the event may be claimed again. */
const STALE_CLAIM = "10 minutes";
/** The payload (it carries the buyer's e-mail) is cleared this long after an event was processed. */
const PAYLOAD_RETENTION = "30 days";

export interface StoredWebhookEvent {
  id: string;
  status: string;
  /** false: an identical delivery (Lemon retry or dashboard resend) was already stored. */
  inserted: boolean;
}

/** Store one verified delivery (or return the row of an identical earlier one). */
export async function storeWebhookEvent(rawBody: Buffer, event: LemonOrderCreatedEvent): Promise<StoredWebhookEvent> {
  const hash = createHash("sha256").update(rawBody).digest();
  const eventName = String(event.meta?.event_name ?? "unknown").slice(0, 64);
  const orderId = event.data?.id == null ? null : String(event.data.id).slice(0, 64);
  const { rows } = await pool.query<StoredWebhookEvent>(
    `INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (body_sha256) DO UPDATE SET body_sha256 = EXCLUDED.body_sha256
     RETURNING id::text, status, (xmax = 0) AS inserted`,
    [hash, eventName, orderId, rawBody.toString("utf8")],
  );
  return rows[0]!;
}

/**
 * What `last_error` and the log say about a failed attempt. An AppError's message was written by this service; anything else may
 * carry the database's text (DETAIL quotes row values) and gets a fixed description. People read this column (db:reconcile, the
 * runbook); no code compares it.
 */
function failureText(err: unknown): string {
  return err instanceof AppError ? err.message : safeErrorDescription(err);
}

function outcomeLabel(outcome: ProcessOutcome): string {
  return (outcome.reason ?? (outcome.processed ? "credited" : "not_processed")).slice(0, 64);
}

export type ProcessResult = "processed" | "failed" | "skipped";

/**
 * Claim one stored event and run fulfilment on it. "skipped": already processed, or being processed by
 * someone else (a fresh claim). The claim is a single UPDATE, so two callers never run it at once.
 */
export async function processStoredWebhookEvent(id: string): Promise<ProcessResult> {
  const { rows } = await pool.query<{ payload: string | null; attempts: number; provider_order_id: string | null }>(
    `UPDATE lemon_webhook_events
     SET status = 'processing', attempts = attempts + 1, claimed_at = NOW()
     WHERE id = $1
       AND (status IN ('pending', 'failed')
            OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '${STALE_CLAIM}'))
     RETURNING payload, attempts, provider_order_id`,
    [id],
  );
  const claimed = rows[0];
  if (!claimed) return "skipped";

  try {
    if (claimed.payload == null) throw new AppError(500, "stored payload is missing", "WEBHOOK_PAYLOAD_MISSING");
    const outcome = await processLemonSqueezyEvent(parseLemonSqueezyEvent(Buffer.from(claimed.payload, "utf8")));
    await pool.query(
      `UPDATE lemon_webhook_events
       SET status = 'processed', processed_at = NOW(), outcome = $2, last_error = NULL
       WHERE id = $1`,
      [id, outcomeLabel(outcome)],
    );
    return "processed";
  } catch (err) {
    const message = failureText(err);
    // If this update fails too (database gone), the row stays 'processing' and is claimed again later.
    await pool
      .query(`UPDATE lemon_webhook_events SET status = 'failed', last_error = $2 WHERE id = $1`, [id, message])
      .catch(() => undefined);
    const stack = safeStackFrames(err);
    const details = {
      storedEventId: id,
      orderId: claimed.provider_order_id,
      attempt: claimed.attempts,
      error: message,
      ...safeErrorLogFields(err),
      ...(stack ? { stack } : {}),
    };
    if (claimed.attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      console.error(
        `[Webhook] FAILED background credit allocation — stored event gave up after ${claimed.attempts} attempts; run \`npm run webhooks:replay\``,
        details,
      );
    } else {
      console.warn(
        `[Webhook] Processing failed — the event is stored and will be retried (attempt ${claimed.attempts} of ${MAX_AUTOMATIC_ATTEMPTS})`,
        details,
      );
    }
    return "failed";
  }
}

/**
 * Process the stored events that are not done: failed ones, ones the immediate processing never picked up,
 * and stale claims. `all` (the replay script) ignores the attempt limit and the grace period.
 */
export async function retryStoredWebhookEvents(options: { all?: boolean; limit?: number } = {}): Promise<{
  processed: number;
  failed: number;
  skipped: number;
}> {
  const all = options.all === true;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id::text FROM lemon_webhook_events
     WHERE (status IN ('pending', 'failed')
            AND ($1 OR (attempts < $2 AND received_at < NOW() - INTERVAL '${RETRY_GRACE}')))
        OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '${STALE_CLAIM}' AND ($1 OR attempts < $2))
     ORDER BY received_at
     LIMIT $3`,
    [all, MAX_AUTOMATIC_ATTEMPTS, options.limit ?? 100],
  );
  const counts = { processed: 0, failed: 0, skipped: 0 };
  for (const { id } of rows) counts[await processStoredWebhookEvent(id)] += 1;
  return counts;
}

/** Clear the payload of events processed more than PAYLOAD_RETENTION ago (data minimisation). */
export async function clearOldWebhookPayloads(): Promise<number> {
  const result = await pool.query(
    `UPDATE lemon_webhook_events SET payload = NULL
     WHERE status = 'processed' AND payload IS NOT NULL AND processed_at < NOW() - INTERVAL '${PAYLOAD_RETENTION}'`,
  );
  return result.rowCount ?? 0;
}
