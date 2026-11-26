/**
 * Step 7.5 V8 consumer (contract 5.2, P4.2, X3, Q7, Q-T3, I-6 ii, 15.7). Used only when WEBHOOK_INGEST_MODE=external; it needs the
 * V8 migration 022 (typed columns, `eligible`, `ingested_by`, credit_verified_purchase) and the R0 grants (S7).
 *
 * - Consumes ONLY rows stored by the separate ingestion process (`ingested_by <> current_user`). Rows the main service stored
 *   itself are legacy rows: the new build never drains them (F3, step 4). The legacy claim takes the exact complement
 *   (`ingested_by = current_user`, inboxProvenance.service.ts), so a row has one owner.
 * - Readiness (F-4): before any pass the V8 schema, functions and privileges are checked (catalogue only). If something is
 *   missing the pass does nothing, says so once, and the state is visible to /health; there is NO fallback to legacy processing.
 * - Only an eligible `order_created` is sent to credit_verified_purchase(), and nothing else decides a credit. Its outcomes are
 *   processed labels, except `policy_incomplete`, which stays failed, counted, with its own log code (Q7).
 * - `eligible = false` orders get a label from the shared state reader (N-2): paid -> not_eligible, not paid -> order_not_paid,
 *   confirmed full refund -> order_refunded; partial, fraudulent and unknown states are review stops.
 * - `order_refunded` goes to the refund recorder, validated against the DATABASE policy (ledger_policy), like purchases (F-6).
 * - Failures are classified by classifyInboxFailure (P4.2): fixed text only, never server text. Review stops and closed events are
 *   never claimed (Q-T3, 17.8); a claimed event whose payload is gone becomes `review:payload_cleared` (I-6 ii).
 * - A claimant records its result only while it still holds the claim (status 'processing' and the `attempts` value its claim
 *   produced, F-5 / contract 15.9).
 * - Retry policy: pending rows at once (grace 0 s, X3); failed rows at most every 60 s per row and at most 10 attempts (Q7);
 *   `webhooks:replay` ignores the limit and the spacing, never the partition, the review stops or the readiness check.
 */
import { CREDIT_PACKAGES } from "../config/packages.js";
import { safeErrorLogFields } from "../db/diagnostics.js";
import { pool } from "../db/index.js";
import { classifyInboxFailure } from "../lib/inboxFailure.js";
import { REVIEW_DESCRIPTIONS, orderCreatedStateVerdict, readOrderPaymentState } from "../lib/lemonEvent.js";
import { parseLemonSqueezyEvent } from "../lib/lemonsqueezy.js";
import { AppError } from "../types/index.js";
import { reviewStop } from "./checkout.service.js";
import { processLemonSqueezyEvent, queuePurchaseReceipt, type OriginCheck } from "./webhook.service.js";
import { CLAIMABLE_FAILED, MAX_AUTOMATIC_ATTEMPTS, type ProcessResult } from "./webhookInbox.service.js";

/** Minimum spacing between two automatic attempts on the same failed row (Q7). */
export const RETRY_SPACING = "60 seconds";
const STALE_CLAIM = "10 minutes";
/** The V8 cleanup function's minimum and the published retention (OD-2). */
const PAYLOAD_RETENTION = "30 days";
/** Rows stored by the ingestion process, never by this service (legacy rows are left to the old build, F3). */
const INGESTED = "ingested_by <> current_user";
/** F-3: the payload clean-up is a daily-scale housekeeping job, not a per-poll one: at most once an hour per process. */
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** credit_verified_purchase() outcomes that end the event as processed (contract 5.2). */
const PROCESSED_OUTCOMES: ReadonlySet<string> = new Set([
  "credited",
  "already_processed",
  "missing_user",
  "unresolved_package",
  "amount_mismatch",
  "store_mismatch",
  "test_mode_order",
  "currency_mismatch",
]);

/** The distinct log code of Q7: the policy tables are not filled in yet (S5); the event stays failed and counted. */
export const POLICY_INCOMPLETE_LOG_CODE = "POLICY_INCOMPLETE";
const POLICY_INCOMPLETE_TEXT = "policy_incomplete: ledger_policy.lemon_store_id is not set";

// ── F-4: readiness of the V8 schema (catalogue reads only; nothing is created or changed) ─────────────────────────────────────

/** Columns migration 022 adds to the inbox that the consumer relies on (12 typed/provenance columns and the two review columns). */
const REQUIRED_COLUMNS = [
  "ingested_by", "eligible", "order_store_id", "order_test_mode", "order_variant_id", "order_currency", "order_total_cents",
  "order_subtotal_cents", "order_item_price_cents", "buyer_user_id", "buyer_email", "pending_order_id", "review_disposition", "review_note",
] as const;
const GUARD_TRIGGERS = ["trg_lemon_webhook_events_review_insert", "trg_lemon_webhook_events_review_update"] as const;
const q = (names: readonly string[]) => names.map((n) => `'${n}'`).join(", ");

export const V8_READINESS_SQL = `SELECT
  to_regclass('public.lemon_webhook_events') IS NOT NULL AS table_present,
  (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public.lemon_webhook_events') AND NOT attisdropped
     AND attname IN (${q(REQUIRED_COLUMNS)}))::int AS columns_found,
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = to_regclass('public.lemon_webhook_events') AND NOT tgisinternal
     AND tgname IN (${q(GUARD_TRIGGERS)}))::int AS guard_triggers,
  to_regclass('public.ledger_policy') IS NOT NULL AS policy_present,
  COALESCE(has_table_privilege(current_user, to_regclass('public.ledger_policy'), 'SELECT'), false) AS can_read_policy,
  to_regprocedure('credit_verified_purchase(bigint)') IS NOT NULL AS credit_fn,
  COALESCE(has_function_privilege(current_user, to_regprocedure('credit_verified_purchase(bigint)'), 'EXECUTE'), false) AS can_credit,
  to_regprocedure('clear_processed_webhook_payloads(interval)') IS NOT NULL AS clear_fn,
  COALESCE(has_function_privilege(current_user, to_regprocedure('clear_processed_webhook_payloads(interval)'), 'EXECUTE'), false) AS can_clear`;

export interface ConsumerReadiness {
  ready: boolean;
  /** Fixed sentences naming what is missing; never database text. */
  problems: string[];
}

/** Pure: what a probe row says. Exported for tests. */
export function consumerReadinessProblems(row: Record<string, unknown> | undefined): string[] {
  if (!row) return ["the readiness probe returned no answer"];
  const problems: string[] = [];
  if (row.table_present !== true) return ["table lemon_webhook_events not found"];
  if (row.columns_found !== REQUIRED_COLUMNS.length) problems.push("inbox columns of migration 022 (V8) are missing");
  if (row.guard_triggers !== GUARD_TRIGGERS.length) problems.push("review-column guard triggers of migration 022 (V8) are missing");
  if (row.policy_present !== true) problems.push("table ledger_policy is missing");
  else if (row.can_read_policy !== true) problems.push("this role cannot read ledger_policy (grants S7/S10-R)");
  if (row.credit_fn !== true) problems.push("function credit_verified_purchase is missing");
  else if (row.can_credit !== true) problems.push("this role cannot execute credit_verified_purchase (grants S7/S10-R)");
  if (row.clear_fn !== true) problems.push("function clear_processed_webhook_payloads is missing");
  else if (row.can_clear !== true) problems.push("this role cannot execute clear_processed_webhook_payloads (grants S7/S10-R)");
  return problems;
}

let readiness: ConsumerReadiness | null = null;
let lastReported = "";

/** Tests only. */
export function resetConsumerReadiness(): void {
  readiness = null;
  lastReported = "";
}

/** What /health and the replay report. Before the first check it is "not checked yet", never ready. */
export function getConsumerReadiness(): ConsumerReadiness {
  return readiness ?? { ready: false, problems: ["not checked yet"] };
}

/**
 * Check the V8 schema. A positive answer is remembered (the schema does not go away; a revoked privilege shows as a classified
 * 42501 on the next call). A negative answer or a failed probe is checked again at the next pass and is logged once per change.
 */
export async function checkConsumerReadiness(): Promise<ConsumerReadiness> {
  if (readiness?.ready) return readiness;
  let problems: string[];
  try {
    const { rows } = await pool.query<Record<string, unknown>>(V8_READINESS_SQL);
    problems = consumerReadinessProblems(rows[0]);
  } catch (err) {
    problems = ["the readiness probe failed (database unavailable?)"];
    void err; // the database's own text is never kept or logged here
  }
  readiness = { ready: problems.length === 0, problems };
  const key = problems.join("|");
  if (key !== lastReported) {
    lastReported = key;
    if (readiness.ready) console.log("[V8 consumer] Ready: the V8 schema, functions and privileges are in place.");
    else console.error("[V8 consumer] NOT READY — nothing is consumed and there is no fallback to legacy processing:", problems);
  }
  return readiness;
}

// ── F-3: throttle ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Run `fn` at most once per `intervalMs`; a skipped call returns undefined. A failing run is not retried before the interval. */
export function throttled<T>(fn: () => Promise<T>, intervalMs: number, now: () => number = Date.now): () => Promise<T | undefined> {
  let last: number | null = null;
  return async () => {
    const t = now();
    if (last !== null && t - last < intervalMs) return undefined;
    last = t;
    return fn();
  };
}

// ── consumption ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface ClaimedEvent {
  event_name: string;
  eligible: boolean;
  payload: string | null;
  attempts: number;
  provider_order_id: string | null;
  order_total_cents: number | null;
  order_subtotal_cents: number | null;
  order_currency: string | null;
}

interface FunctionRow {
  o_outcome: string;
  o_ledger_id: string | null;
  o_user_id: string | null;
  o_credits: number | null;
}

/** F-6: the origin gate of a refund event from the authoritative database policy, the same rules and order as the V8 function. */
async function refundOriginFromPolicy(): Promise<OriginCheck> {
  const { rows } = await pool.query<{ lemon_store_id: string | null; allow_test_mode: boolean }>(
    `SELECT lemon_store_id, allow_test_mode FROM ledger_policy WHERE singleton`,
  );
  const policy = rows[0];
  if (!policy || policy.lemon_store_id == null) throw new AppError(500, POLICY_INCOMPLETE_TEXT, POLICY_INCOMPLETE_LOG_CODE);
  return (_orderId, attrs) => {
    if (String(attrs.store_id ?? "") !== policy.lemon_store_id) return "store_mismatch";
    if (attrs.test_mode === true && !policy.allow_test_mode) return "test_mode_order";
    return null;
  };
}

/** F-8: the receipt shows the pack's list price, as the legacy path always did (never the tax-inclusive order total). */
function receiptAmountCents(credits: number, event: ClaimedEvent): number {
  const pack = Object.values(CREDIT_PACKAGES).find((p) => p.credits === credits);
  return pack?.priceUsdCents ?? event.order_subtotal_cents ?? event.order_total_cents ?? 0;
}

async function consume(id: string, event: ClaimedEvent): Promise<string> {
  if (event.payload == null) throw new AppError(500, REVIEW_DESCRIPTIONS.payloadCleared, "WEBHOOK_PAYLOAD_MISSING");

  if (event.event_name === "order_created" && event.eligible) {
    const { rows } = await pool.query<FunctionRow>(
      `SELECT o_outcome, o_ledger_id::text AS o_ledger_id, o_user_id::text AS o_user_id, o_credits FROM credit_verified_purchase($1)`,
      [id],
    );
    const result = rows[0];
    if (!result) throw new AppError(500, "credit_verified_purchase returned no row", "CONSUMER_NO_RESULT");
    if (result.o_outcome === "policy_incomplete") throw new AppError(500, POLICY_INCOMPLETE_TEXT, POLICY_INCOMPLETE_LOG_CODE);
    if (!PROCESSED_OUTCOMES.has(result.o_outcome)) throw new AppError(500, "credit_verified_purchase returned an unknown outcome", "CONSUMER_UNKNOWN_OUTCOME");
    if (result.o_outcome === "credited" && result.o_user_id && result.o_credits != null) {
      console.log("[V8 consumer] Credited", { storedEventId: id, orderId: event.provider_order_id, ledgerId: result.o_ledger_id });
      queuePurchaseReceipt({
        userId: result.o_user_id,
        creditsAdded: result.o_credits,
        orderId: event.provider_order_id ?? "",
        amountPaidCents: receiptAmountCents(result.o_credits, event),
        currency: "USD", // eligibility requires USD (credit_verified_purchase currency_mismatch otherwise)
      });
    }
    return result.o_outcome;
  }

  const parsed = parseLemonSqueezyEvent(Buffer.from(event.payload, "utf8"));
  if (event.event_name === "order_created") {
    const verdict = orderCreatedStateVerdict(readOrderPaymentState(parsed.data?.attributes));
    if (verdict.kind === "review") throw reviewStop(verdict.description);
    return verdict.kind === "label" ? verdict.outcome : "not_eligible";
  }
  if (event.event_name === "order_refunded") {
    const outcome = await processLemonSqueezyEvent(parsed, { refundOrigin: await refundOriginFromPolicy() });
    return (outcome.reason ?? (outcome.processed ? "refund_recorded" : "not_processed")).slice(0, 64);
  }
  return "ignored_event_type";
}

/** Claim one ingested event and consume it. "skipped": not claimable (done, claimed elsewhere, a review stop, closed, legacy) or the claim was lost. */
export async function consumeIngestedEvent(id: string): Promise<ProcessResult> {
  const { rows } = await pool.query<ClaimedEvent>(
    `UPDATE lemon_webhook_events
     SET status = 'processing', attempts = attempts + 1, claimed_at = NOW()
     WHERE id = $1 AND ${INGESTED}
       AND (status = 'pending' OR ${CLAIMABLE_FAILED}
            OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '${STALE_CLAIM}'))
     RETURNING event_name, eligible, payload, attempts, provider_order_id, order_total_cents, order_subtotal_cents, order_currency`,
    [id],
  );
  const claimed = rows[0];
  if (!claimed) return "skipped";

  try {
    const outcome = await consume(id, claimed);
    // F-5: only the claimant that still holds the claim may finish the event: `attempts` is incremented by every claim and written by
    // nothing else, so the value this claim returned identifies it. A zero-row answer means another worker owns it now (it was
    // reclaimed as stale); the credit, if any, is idempotent and the new owner will see it in the ledger.
    const finished = await pool.query(
      `UPDATE lemon_webhook_events
       SET status = 'processed', processed_at = NOW(), outcome = $2, last_error = NULL
       WHERE id = $1 AND status = 'processing' AND attempts = $3::int`,
      [id, outcome, claimed.attempts],
    );
    if (finished.rowCount === 0) {
      console.warn("[V8 consumer] Claim lost before the result was recorded — another worker owns the event now", { storedEventId: id });
      return "skipped";
    }
    return "processed";
  } catch (err) {
    const failure = classifyInboxFailure(err);
    // If this update fails too (database gone), the row stays 'processing' and is claimed again after the stale-claim interval.
    const recorded = await pool
      .query(
        `UPDATE lemon_webhook_events SET status = 'failed', last_error = $2
         WHERE id = $1 AND status = 'processing' AND attempts = $3::int`,
        [id, failure.lastError, claimed.attempts],
      )
      .catch(() => undefined);
    if (recorded && recorded.rowCount === 0) {
      console.warn("[V8 consumer] Claim lost before the failure was recorded — another worker owns the event now", { storedEventId: id });
      return "skipped";
    }
    const details = { storedEventId: id, orderId: claimed.provider_order_id, attempt: claimed.attempts, kind: failure.kind, error: failure.lastError, ...safeErrorLogFields(err) };
    if (err instanceof AppError && err.code === POLICY_INCOMPLETE_LOG_CODE) {
      console.error(`[V8 consumer] ${POLICY_INCOMPLETE_LOG_CODE} — fill ledger_policy and credit_packages (S5), then run \`npm run webhooks:replay\``, details);
    } else if (failure.kind === "review") {
      console.warn("[V8 consumer] Stopped for review — not retried; the owner closes or reopens it (db:reconcile webhook_review)", details);
    } else if (claimed.attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      console.error(`[V8 consumer] FAILED — gave up after ${claimed.attempts} attempts; run \`npm run webhooks:replay\``, details);
    } else {
      console.warn(`[V8 consumer] Processing failed — retried in ${RETRY_SPACING} (attempt ${claimed.attempts} of ${MAX_AUTOMATIC_ATTEMPTS})`, details);
    }
    return "failed";
  }
}

export interface ConsumerPassResult {
  processed: number;
  failed: number;
  skipped: number;
  /** Set when the V8 schema is not ready: nothing was consumed. */
  notReady?: string[];
}

/**
 * One consumer pass: pending ingested rows at once (grace 0 s), failed ones at most every 60 s per row and at most 10 attempts,
 * stale claims. `all` (the replay script) ignores the attempt limit and the spacing. A failing row never stops the pass.
 * Not ready (F-4): nothing is selected and `notReady` says why.
 */
export async function consumeIngestedWebhookEvents(options: { all?: boolean; limit?: number } = {}): Promise<ConsumerPassResult> {
  const ready = await checkConsumerReadiness();
  if (!ready.ready) return { processed: 0, failed: 0, skipped: 0, notReady: ready.problems };
  const all = options.all === true;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id::text FROM lemon_webhook_events
     WHERE ${INGESTED}
       AND ((status = 'pending' AND ($1 OR attempts < $2))
            OR (${CLAIMABLE_FAILED} AND ($1 OR (attempts < $2 AND claimed_at < NOW() - INTERVAL '${RETRY_SPACING}')))
            OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '${STALE_CLAIM}' AND ($1 OR attempts < $2)))
     ORDER BY received_at
     LIMIT $3`,
    [all, MAX_AUTOMATIC_ATTEMPTS, options.limit ?? 100],
  );
  const counts = { processed: 0, failed: 0, skipped: 0 };
  for (const { id } of rows) {
    try {
      counts[await consumeIngestedEvent(id)] += 1;
    } catch (err) {
      // The claim itself failed (for example the database is gone): count it and go on with the next row.
      counts.failed += 1;
      console.warn("[V8 consumer] Claim failed", { storedEventId: id, ...safeErrorLogFields(err) });
    }
  }
  return counts;
}

/** External mode: payload clean-up through the V8 owner function (the application role has no UPDATE on `payload` after S10-R). */
export async function clearPayloadsThroughFunction(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT clear_processed_webhook_payloads(INTERVAL '${PAYLOAD_RETENTION}') AS n`);
  return Number(rows[0]?.n ?? 0);
}
