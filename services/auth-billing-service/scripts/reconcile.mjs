/**
 * Read-only ledger reconciliation report (FINDING-05, FINDING-22).
 * Prints every row of ledger_reconciliation(); exit code 2 when issues exist,
 * so it can gate a cron/CI job.
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
} finally {
  await client.end();
}
