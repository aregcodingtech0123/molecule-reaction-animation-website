/**
 * Charge-consistency checks after a load / soak / failure run (Part 3), against the guarded perf database:
 *  - AI reservations by status, and how many are still `held` past their expiry (should be 0 once the sweeper ran);
 *  - CAPTURE_FAILED lines in the server logs (BFF: capture never reached billing; Express: debit refused);
 *  - the real `db:reconcile` script (services/auth-billing-service/scripts/reconcile.mjs): exit 0 = every cached
 *    balance equals SUM(ledger), no failed or unsettled captures, no unreviewed refunds. It runs with only the perf
 *    database URL in its environment (MOLECULESTUDIO_SKIP_DOTENV=1 and the dotenv stub: never the real .env).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { perfDatabaseUrl, repoRoot, serviceRoot } from "../config.mjs";
import { assertTestDatabaseUrl } from "../../test/db-guard.mjs";

const pg = createRequire(path.join(serviceRoot, "package.json"))("pg");

/** Reservations by status (and by `status/settle_reason` for those created since `since`, a Date). */
export async function holdSummary({ url = perfDatabaseUrl(), since = null } = {}) {
  assertTestDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT status, count(*)::int AS n FROM ai_credit_holds GROUP BY status ORDER BY status`);
    const { rows: [stale] } = await client.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE status = 'held' AND expires_at < NOW()`);
    const { rows: [open] } = await client.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE status = 'held'`);
    const out = { byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])), heldPastExpiry: stale.n, heldNow: open.n };
    if (since) {
      const { rows: recent } = await client.query(
        `SELECT status || COALESCE('/' || settle_reason, '') AS k, count(*)::int AS n FROM ai_credit_holds WHERE created_at >= $1 GROUP BY 1 ORDER BY 1`,
        [since],
      );
      out.sinceByStatusReason = Object.fromEntries(recent.map((r) => [r.k, r.n]));
    }
    return out;
  } finally {
    await client.end();
  }
}

/**
 * Money and webhook state since `since` (a Date): ledger rows by type, and stored webhook events by
 * status / outcome (R19 inbox; absent before migration 015).
 */
export async function ledgerAndInboxSince(since, url = perfDatabaseUrl()) {
  assertTestDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: ledger } = await client.query(
      `SELECT transaction_type::text AS type, count(*)::int AS n FROM credit_ledger_transactions WHERE created_at >= $1 GROUP BY 1 ORDER BY 1`,
      [since],
    );
    const { rows: dup } = await client.query(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM credit_ledger_transactions WHERE created_at >= $1 AND reference_id IS NOT NULL
         GROUP BY reference_id, transaction_type HAVING count(*) > 1) d`,
      [since],
    );
    const out = { ledger: Object.fromEntries(ledger.map((r) => [r.type, r.n])), duplicateReferences: dup[0].n };
    const { rows: present } = await client.query(`SELECT to_regclass('public.lemon_webhook_events') IS NOT NULL AS present`);
    if (present[0].present) {
      const { rows: inbox } = await client.query(
        `SELECT status || COALESCE('/' || outcome, '') AS k, count(*)::int AS n FROM lemon_webhook_events WHERE received_at >= $1 GROUP BY 1 ORDER BY 1`,
        [since],
      );
      out.inbox = Object.fromEntries(inbox.map((r) => [r.k, r.n]));
      out.inboxOpen = inbox.filter((r) => !r.k.startsWith("processed")).reduce((a, r) => a + r.n, 0);
    }
    return out;
  } finally {
    await client.end();
  }
}

export function runReconcile(url = perfDatabaseUrl()) {
  assertTestDatabaseUrl(url);
  const res = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(path.join(repoRoot, "scripts/test/no-dotenv.mjs")).href, path.join(serviceRoot, "scripts/reconcile.mjs")],
    {
      cwd: serviceRoot,
      encoding: "utf8",
      timeout: 120_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "test", MOLECULESTUDIO_SKIP_DOTENV: "1", MIGRATION_DATABASE_URL: url },
    },
  );
  return { exitCode: res.status, output: `${res.stdout}${res.stderr}`.split("\n").filter((l) => l.startsWith("[reconcile]")).join(" | ") };
}

export function countLogLines(file, needle) {
  if (!file || !fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.includes(needle)).length;
}
