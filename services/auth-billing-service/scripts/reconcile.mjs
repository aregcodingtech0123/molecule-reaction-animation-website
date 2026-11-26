/**
 * Read-only ledger reconciliation report (FINDING-05, FINDING-22, SEC-14, R19).
 * Prints every row of ledger_reconciliation(), every refunded Lemon order whose
 * credits are still in the ledger and not reviewed yet (refunded_orders_to_review(),
 * migration 013), and every stored webhook event not processed after 15 minutes
 * (webhook_events_to_review(), migration 015), and every purchase that credited nobody because no account matched
 * (webhook_missing_user_to_review(), migration 018), and every paid order refused for its pack or amount
 * (lib/uncredited-purchases.mjs); exit code 2 when any lists anything,
 * so it can gate a cron/CI job.
 *
 * Usage: node scripts/reconcile.mjs
 */
import pg from "pg";
import { loadServiceEnv, resolveMigrationUrl } from "./lib/cli-env.mjs";
import { MISSING_USER_SQL, REFUNDS_SQL, reportUnprocessedEvents } from "./lib/reconcile-sections.mjs";
import { reportUncreditedPurchases } from "./lib/uncredited-purchases.mjs";

loadServiceEnv();

const client = new pg.Client({ connectionString: resolveMigrationUrl() });
await client.connect();
try {
  await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  const { rows } = await client.query(
    `SELECT issue, user_id::text, cached_balance, ledger_sum::text, difference::text, reference_id, detail
     FROM ledger_reconciliation()`,
  );
  if (rows.length === 0) {
    console.log("[reconcile] OK — every cached balance equals SUM(ledger); no failed captures.");
  } else {
    const byIssue = rows.reduce((acc, r) => ((acc[r.issue] = (acc[r.issue] ?? 0) + 1), acc), {});
    console.log(`[reconcile] ${rows.length} issue(s): ${JSON.stringify(byIssue)}`);
    console.table(rows);
    process.exitCode = 2;
  }

  // Before migration 013 the function does not exist yet: nothing to report.
  const { rows: fn } = await client.query(`SELECT to_regprocedure('refunded_orders_to_review()') IS NOT NULL AS present`);
  if (fn[0].present) {
    // One row per order with its authoritative refund state (V8 contract P3.3); the 013 presence check above is kept.
    const { rows: refunds } = await client.query(REFUNDS_SQL);
    if (refunds.length === 0) {
      console.log("[reconcile] OK — no unreviewed refunded orders.");
    } else {
      console.log(
        `[reconcile] ${refunds.length} refunded order(s) still credited and not reviewed (refunded_order_credited). ` +
          "Credits are never clawed back automatically; review each, then set lemon_order_refunds.reviewed_at.",
      );
      console.table(refunds);
      process.exitCode = 2;
    }
  }

  // R19 (migration 015): stored webhook deliveries not processed 15 minutes after they arrived. Lemon got
  // a 200 for each, so it will not resend them: their credits may be missing until they are processed.
  // Review stops are listed apart; on a V8 schema closed events are only counted (V8 contract P6.3).
  if ((await reportUnprocessedEvents(client)) > 0) process.exitCode = 2;

  // Migration 018: a signed purchase that credited nobody because no account matched (including an account that was
  // deleted/anonymised). The buyer has paid and received nothing; Lemon got a 200, so it will not resend it.
  const { rows: missing } = await client.query(`SELECT to_regprocedure('webhook_missing_user_to_review()') IS NOT NULL AS present`);
  if (missing[0].present) {
    // Orders credited by the contract 5.1 definition are not listed (site 7, Q6 B); an ambiguous order stays listed.
    const { rows: orders } = await client.query(MISSING_USER_SQL);
    if (orders.length === 0) {
      console.log("[reconcile] OK — no purchase is waiting because its buyer matched no account.");
    } else {
      console.log(
        `[reconcile] ${orders.length} purchase(s) credited nobody because no account matched (webhook_missing_user). ` +
          "The buyer paid and received nothing: refund the order in the Lemon dashboard, then set lemon_webhook_events.reviewed_at (runbook §9).",
      );
      console.table(orders);
      process.exitCode = 2;
    }
  }

  if ((await reportUncreditedPurchases(client)) > 0) process.exitCode = 2;
} finally {
  await client.end();
}
