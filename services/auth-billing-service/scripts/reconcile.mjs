/**
 * Read-only ledger reconciliation report (FINDING-05, FINDING-22, SEC-14).
 * Prints every row of ledger_reconciliation() and every refunded Lemon order whose
 * credits are still in the ledger and not reviewed yet (refunded_orders_to_review(),
 * migration 013); exit code 2 when either lists anything, so it can gate a cron/CI job.
 *
 * Usage: node scripts/reconcile.mjs
 */
import pg from "pg";
import { loadServiceEnv, resolveMigrationUrl } from "./lib/cli-env.mjs";

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
    const { rows: refunds } = await client.query(
      `SELECT provider_order_id, user_id::text, credits, current_balance, order_status, refunded_amount, currency,
              refunded_at::text, test_mode
       FROM refunded_orders_to_review()`,
    );
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
} finally {
  await client.end();
}
