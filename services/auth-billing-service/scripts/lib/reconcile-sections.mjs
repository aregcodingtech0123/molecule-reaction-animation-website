/**
 * db:reconcile, V8 contract changes that are read-only and work on the current schema (Q6 B: no migration, 015/013/018 unchanged).
 *
 *  - "credited" means contract 5.1: a provider-keyed ledger row for `ls_order_<id>`, or EXACTLY ONE historical provider-less
 *    positive ADMIN_ADJUSTMENT of that exact reference. An ambiguous order (more than one historical row, no provider-keyed row)
 *    is never treated as credited: it stays listed, with its historical count. Used by webhook_uncredited (site 6) and the
 *    missing-user section (site 7).
 *  - Unprocessed events (P6.3): open review stops (`review:` description) are listed apart from ordinary failures, with their own
 *    remedy; on a V8 schema (review_disposition present) CLOSED events are only counted by disposition, never listed.
 *  - Refunds (P3.3): one row per order with its authoritative refund state: `refunded` if any full-refund row exists, otherwise
 *    the largest partial refund (refunded_orders_to_review() breaks equal-amount ties by arrival time).
 * Never the stored message (it holds the buyer's e-mail).
 */
const REF = (orderId) => `'ls_order_' || ${orderId}`;

/** Count of eligible historical provider-less manual credits of the order's exact reference (N-1). */
export const historicalCreditsSql = (orderId) =>
  `(SELECT count(*) FROM credit_ledger_transactions h
     WHERE h.reference_id = ${REF(orderId)} AND h.provider IS NULL AND h.transaction_type = 'ADMIN_ADJUSTMENT' AND h.amount > 0)`;

/** Contract 5.1 as one SQL predicate: true only for a credited order (never for an ambiguous one). */
export const orderCreditedSql = (orderId) =>
  `(EXISTS (SELECT 1 FROM credit_ledger_transactions l WHERE l.provider = 'lemonsqueezy' AND l.reference_id = ${REF(orderId)})
    OR ${historicalCreditsSql(orderId)} = 1)`;

/** Site 7 (Q6 B): the missing-user list without orders credited by the 5.1 definition. */
export const MISSING_USER_SQL = `
  SELECT m.id::text, m.event_name, m.provider_order_id, m.received_at::text, m.processed_at::text,
         ${historicalCreditsSql("m.provider_order_id")}::int AS historical_manual_credits
  FROM webhook_missing_user_to_review() m
  WHERE NOT ${orderCreditedSql("m.provider_order_id")}
  ORDER BY m.received_at`;

/**
 * P3.3: one row per order that still has an unreviewed refund row, showing its AUTHORITATIVE refund state computed over all its
 * refund rows: `refunded` if any full-refund row exists, otherwise the largest partial refund. Same join and scope as
 * refunded_orders_to_review() (migration 013, unchanged): the order's provider-keyed CREDIT_PURCHASE.
 */
export const REFUNDS_SQL = `
  SELECT * FROM (
    SELECT DISTINCT ON (r.provider_order_id)
           r.provider_order_id::text, t.user_id::text, t.amount AS credits, b.balance AS current_balance,
           r.order_status::text, r.refunded_amount, r.currency::text, r.refunded_at::text, r.test_mode,
           (SELECT count(*) FROM lemon_order_refunds u WHERE u.provider_order_id = r.provider_order_id AND u.reviewed_at IS NULL)::int
             AS unreviewed_refund_rows
    FROM lemon_order_refunds r
    JOIN credit_ledger_transactions t
      ON t.provider = 'lemonsqueezy' AND t.reference_id = 'ls_order_' || r.provider_order_id AND t.transaction_type = 'CREDIT_PURCHASE'
    LEFT JOIN user_balances b ON b.user_id = t.user_id
    WHERE EXISTS (SELECT 1 FROM lemon_order_refunds u WHERE u.provider_order_id = r.provider_order_id AND u.reviewed_at IS NULL)
    ORDER BY r.provider_order_id, (r.order_status = 'refunded') DESC, r.refunded_amount DESC, r.received_at DESC
  ) authoritative
  ORDER BY refunded_amount DESC, provider_order_id`;

const UNPROCESSED_COLUMNS = `t.id::text, t.event_name, t.provider_order_id, t.status, t.attempts, t.last_error, t.received_at::text`;

/** Roles whose rows the V8 consumer owns: the ingestion login and the table owner (the trust list of credit_verified_purchase). */
const V8_INGEST_ROLES = `ARRAY[pg_get_userbyid((SELECT c.relowner FROM pg_class c WHERE c.oid = 'public.lemon_webhook_events'::regclass)), 'moleculestudio_webhook']`;

/**
 * Unprocessed events, by schema capability: `v8` = migration 022 V8 (closed events exist), `prov` = the `ingested_by` column exists.
 * provenance: `v8_ingested` (stored by the ingestion process: V8 consumer) or `legacy` (stored by the main service: legacy drain only,
 * G-R1 B). Before the column exists every row is legacy and the column is NULL.
 */
export function unprocessedSql({ v8, prov }) {
  const closed = v8 ? "CASE WHEN e.reviewed_at IS NOT NULL THEN e.review_disposition END" : "NULL::text";
  const provenance = prov ? `CASE WHEN e.ingested_by = ANY(${V8_INGEST_ROLES}) THEN 'v8_ingested' ELSE 'legacy' END` : "NULL::text";
  const join = v8 || prov ? "LEFT JOIN lemon_webhook_events e ON e.id = t.id" : "";
  return `
  SELECT ${UNPROCESSED_COLUMNS}, ${closed} AS closed_disposition, ${provenance} AS provenance
  FROM webhook_events_to_review() t
  ${join}`;
}
/** Current schema (before V8 022): no disposition and no provenance exist. */
export const UNPROCESSED_SQL = unprocessedSql({ v8: false, prov: false });
/** V8 schema: an event is CLOSED when reviewed_at and review_disposition are both set; provenance is known. */
export const UNPROCESSED_V8_SQL = unprocessedSql({ v8: true, prov: true });

export const UNPROCESSED_PROBE_SQL = `SELECT to_regprocedure('webhook_events_to_review(interval)') IS NOT NULL AS present,
            EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('lemon_webhook_events')
                      AND attname = 'review_disposition' AND NOT attisdropped) AS v8,
            EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('lemon_webhook_events')
                      AND attname = 'ingested_by' AND NOT attisdropped) AS prov`;

/** Remedies, by provenance. A legacy row is never directed to a replay that cannot process it (and vice versa). */
export const REMEDY = Object.freeze({
  failure_legacy:
    "Legacy rows (stored by the main service): fix the cause (last_error), then replay with a build in `legacy` mode (WEBHOOK_INGEST_MODE unset). " +
    "In `external` mode `npm run webhooks:replay` does NOT process them: they are drained only by the F3 procedure with the old build.",
  failure_v8:
    "V8-ingested rows (stored by the ingestion process): fix the cause (last_error), then run `npm run webhooks:replay` with WEBHOOK_INGEST_MODE=external. " +
    "A build in `legacy` mode never takes them.",
  failure_plain: "Fix the cause (last_error), then run `npm run webhooks:replay`.",
  review_v8:
    "They are not retried automatically and never credited by themselves: the owner closes each with a disposition, or reopens it after the cause is fixed (`npm run db:review-event`, runbook).",
  review_pre_v8:
    "They are not retried automatically and never credited by themselves. Before the V8 migration 022 there is no supported close or reopen procedure: " +
    "leave them listed (this report keeps exiting 2, which is the safe state) and do not edit the row by hand; the owner decision is handled with the V8 tool once migration 022 is applied.",
});

/** Print the unprocessed-events section; returns how many events need action (closed events never count). */
export async function reportUnprocessedEvents(client, out = console) {
  const { rows: probe } = await client.query(UNPROCESSED_PROBE_SQL);
  if (!probe[0].present) return 0;
  const { rows } = await client.query(unprocessedSql({ v8: probe[0].v8 === true, prov: probe[0].prov === true }));
  const closed = rows.filter((r) => r.closed_disposition);
  const open = rows.filter((r) => !r.closed_disposition && typeof r.last_error === "string" && r.last_error.startsWith("review:"));
  const failures = rows.filter((r) => !r.closed_disposition && !open.includes(r));
  const strip = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "closed_disposition" && !(key === "provenance" && row.provenance == null)));

  if (open.length === 0 && failures.length === 0) {
    out.log("[reconcile] OK — every stored Lemon webhook event is processed or closed by a review decision.");
  }
  if (failures.length > 0) {
    out.log(`[reconcile] ${failures.length} stored Lemon webhook event(s) not processed (webhook_unprocessed).`);
    const group = (provenance) => failures.filter((r) => r.provenance === provenance);
    const plain = failures.filter((r) => r.provenance == null);
    for (const [rowsOf, remedy] of [
      [group("legacy"), REMEDY.failure_legacy],
      [group("v8_ingested"), REMEDY.failure_v8],
      [plain, REMEDY.failure_plain],
    ]) {
      if (rowsOf.length === 0) continue;
      out.log(`[reconcile]   ${rowsOf.length}: ${remedy}`);
      out.table(rowsOf.map(strip));
    }
  }
  if (open.length > 0) {
    out.log(
      `[reconcile] ${open.length} stored Lemon webhook event(s) stopped for review (webhook_review). ` +
        (probe[0].v8 === true ? REMEDY.review_v8 : REMEDY.review_pre_v8),
    );
    out.table(open.map(strip));
  }
  if (closed.length > 0) {
    const byDisposition = closed.reduce((acc, r) => ((acc[r.closed_disposition] = (acc[r.closed_disposition] ?? 0) + 1), acc), {});
    out.log(`[reconcile] info — ${closed.length} event(s) closed by a review decision (not listed): ${JSON.stringify(byDisposition)}`);
  }
  return open.length + failures.length;
}
