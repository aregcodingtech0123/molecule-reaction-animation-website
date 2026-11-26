import { historicalCreditsSql, orderCreditedSql } from "./reconcile-sections.mjs";

/**
 * db:reconcile section `webhook_uncredited` (Step 7.5): signed, paid orders that were refused because their variant maps to no
 * pack or their amount matches no list price. Read-only, no function or migration needed (reviewed_at exists since 018).
 *
 * One row per order, however many deliveries it had. Not listed: an order credited through another delivery, and an order that
 * webhook_missing_user already lists. `invalid_package_id` is the name older builds gave to an unknown pack; `not_eligible` is the
 * V8 consumer's label for a paid order the ingestion process did not verify (N-2). "Credited" is contract 5.1 (site 6): an
 * ambiguous order (several historical manual credits) stays listed, with its historical count.
 * Order ids, outcomes and times only: never the stored message (it holds the buyer's e-mail).
 */
export const UNCREDITED_PURCHASES_SQL = `
  SELECT e.provider_order_id,
         string_agg(DISTINCT e.outcome, ', ' ORDER BY e.outcome) AS outcome,
         min(e.received_at)::text AS first_received_at,
         count(*)::int AS deliveries,
         ${historicalCreditsSql("e.provider_order_id")}::int AS historical_manual_credits
  FROM lemon_webhook_events e
  WHERE e.status = 'processed'
    AND e.event_name = 'order_created'
    AND e.outcome IN ('not_eligible', 'unresolved_package', 'amount_mismatch', 'invalid_package_id')
    AND e.reviewed_at IS NULL
    AND e.provider_order_id IS NOT NULL
    AND NOT ${orderCreditedSql("e.provider_order_id")}
    AND NOT EXISTS (SELECT 1 FROM lemon_webhook_events m
                    WHERE m.provider_order_id = e.provider_order_id
                      AND m.status = 'processed' AND m.outcome = 'missing_user' AND m.reviewed_at IS NULL)
  GROUP BY e.provider_order_id
  ORDER BY min(e.received_at)`;

/** Print the section; returns how many orders are waiting. On a database without the column (before 018) it is skipped. */
export async function reportUncreditedPurchases(client, out = console) {
  const { rows: column } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('lemon_webhook_events')
                      AND attname = 'reviewed_at' AND NOT attisdropped) AS present`,
  );
  if (!column[0].present) return 0;

  const { rows } = await client.query(UNCREDITED_PURCHASES_SQL);
  if (rows.length === 0) {
    out.log("[reconcile] OK — no paid order is waiting because its pack or amount was refused.");
    return 0;
  }
  out.log(
    `[reconcile] ${rows.length} paid order(s) credited nobody because the pack or the amount was refused (webhook_uncredited). ` +
      "Check each in the Lemon dashboard, refund or credit it, then set lemon_webhook_events.reviewed_at (runbook §9).",
  );
  out.table(rows);
  return rows.length;
}
