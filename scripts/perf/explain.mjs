/**
 * EXPLAIN (ANALYZE, BUFFERS) of every hot query against the seeded perf database (PERF-05/16/17).
 *
 *   node scripts/perf/explain.mjs [--repeat 5] [--label default]
 *
 * The SQL below is copied verbatim from the service (file noted per query); keep it in sync. Each query
 * runs once as warm-up, then `--repeat` times; the result keeps the median execution time, the spread,
 * and the plan of the last run (node types, indexes, buffers). Writes run inside a transaction that is
 * rolled back. Statements inside SQL functions (post_credit_transaction, ledger_reconciliation, …) are
 * explained with auto_explain, LOADed for this session only and reported as NOTICEs (no server setting
 * changes). Output: perf-results/<timestamp>-explain-<label>/result.json and plans.txt.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { RESULTS_DIR, perfDatabaseUrl, serviceRoot } from "./config.mjs";
import { assertTestDatabaseUrl } from "../test/db-guard.mjs";

const pg = createRequire(path.join(serviceRoot, "package.json"))("pg");

const HISTORY_SQL = `SELECT id::text, amount, transaction_type::text, reference_id, provider, created_at,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_time
     FROM credit_ledger_transactions
     WHERE user_id = $1
       AND ($3::timestamp IS NULL OR (created_at, id) < ($3::timestamp AT TIME ZONE 'UTC', $4::bigint))
     ORDER BY created_at DESC, id DESC
     LIMIT $2`;

/** @returns {Array<{ name: string, source: string, sql: string, params: unknown[], write?: boolean, nested?: boolean }>} */
function queries(p) {
  return [
    { name: "auth: revoked jti", source: "services/tokenRevocation.service.ts", sql: `SELECT expires_at FROM revoked_tokens WHERE jti = $1 AND expires_at > NOW() LIMIT 1`, params: [randomUUID()] },
    { name: "auth: token_version", source: "middlewares/requireAuth.ts", sql: `SELECT token_version FROM users WHERE id = $1`, params: [p.regular] },
    { name: "auth: is_verified", source: "middlewares/requireVerified.ts", sql: `SELECT is_verified FROM users WHERE id = $1 LIMIT 1`, params: [p.regular] },
    { name: "balance", source: "services/billing.service.ts", sql: `SELECT balance FROM user_balances WHERE user_id = $1 LIMIT 1`, params: [p.regular] },
    { name: "history hot first page", source: "services/billing.service.ts", sql: HISTORY_SQL, params: [p.hot, 101, null, null] },
    { name: "history hot middle page", source: "services/billing.service.ts", sql: HISTORY_SQL, params: [p.hot, 101, p.hotMid.t, p.hotMid.i] },
    { name: "history hot last page", source: "services/billing.service.ts", sql: HISTORY_SQL, params: [p.hot, 101, p.hotLast.t, p.hotLast.i] },
    { name: "history regular first page", source: "services/billing.service.ts", sql: HISTORY_SQL, params: [p.regular, 101, null, null] },
    { name: "reserve: advisory lock", source: "services/aiCredits.service.ts", sql: `SELECT pg_advisory_xact_lock(hashtext($1::text))`, params: [p.regular], write: true },
    {
      name: "reserve: find hold (FOR UPDATE)",
      source: "services/aiCredits.service.ts",
      sql: `SELECT status, amount, operation_type, expires_at <= NOW() AS expired, ledger_id::text
     FROM ai_credit_holds
     WHERE user_id = $1 AND reference_id = $2
     FOR UPDATE`,
      params: [p.regular, randomUUID()],
      write: true,
    },
    {
      name: "reserve: daily caps",
      source: "services/aiCredits.service.ts",
      sql: `SELECT
       (SELECT count(*)::int FROM ai_credit_holds WHERE user_id = $1 AND created_at > NOW() - interval '24 hours') AS mine,
       (SELECT min(created_at) FROM ai_credit_holds WHERE user_id = $1 AND created_at > NOW() - interval '24 hours') AS oldest_mine,
       (SELECT count(*)::int FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours') AS total`,
      params: [p.regular],
    },
    {
      name: "reserve: available balance",
      source: "services/aiCredits.service.ts",
      sql: `SELECT COALESCE((SELECT balance FROM user_balances WHERE user_id = $1), 0)
          - COALESCE((SELECT SUM(amount) FROM ai_credit_holds
                      WHERE user_id = $1 AND status = 'held' AND expires_at > NOW()), 0) AS available`,
      params: [p.regular],
    },
    {
      name: "reserve: insert hold",
      source: "services/aiCredits.service.ts",
      sql: `INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + make_interval(secs => $5))
       RETURNING expires_at`,
      params: [p.regular, randomUUID(), "AI_CHAT_QUERY", 1, 600],
      write: true,
    },
    {
      name: "capture: post_credit_transaction (nested)",
      source: "services/aiCredits.service.ts → 008_ledger_hardening.sql",
      sql: `SELECT post_credit_transaction($1, $2, 'CREDIT_CONSUMPTION'::credit_transaction_type, $3)::text AS ledger_id`,
      params: [p.regular, -1, randomUUID()],
      write: true,
      nested: true,
    },
    {
      name: "webhook: purchase already credited?",
      source: "services/checkout.service.ts",
      sql: `SELECT id::text FROM credit_ledger_transactions
       WHERE provider = $1 AND reference_id = $2
       LIMIT 1`,
      params: ["lemonsqueezy", p.purchaseRef],
    },
    {
      name: "webhook: user by email",
      source: "services/webhook.service.ts",
      sql: `SELECT id::text FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
      params: [p.regularEmail],
    },
    {
      name: "webhook: credit purchase (nested)",
      source: "services/checkout.service.ts → 008_ledger_hardening.sql",
      sql: `SELECT post_credit_transaction($1, $2, 'CREDIT_PURCHASE'::credit_transaction_type, $3, $4) AS ledger_id`,
      params: [p.regular, 50, `perf_explain_${randomUUID()}`, "lemonsqueezy"],
      write: true,
      nested: true,
    },
    { name: "reconcile: ledger_reconciliation() (nested)", source: "scripts/reconcile.mjs → 008/009", sql: `SELECT * FROM ledger_reconciliation()`, params: [], nested: true },
    { name: "reconcile: refunded_orders_to_review() (nested)", source: "scripts/reconcile.mjs → 013", sql: `SELECT * FROM refunded_orders_to_review()`, params: [], nested: true },
    { name: "sweeper: release_expired_ai_holds() (nested)", source: "services/aiCredits.service.ts → 009", sql: `SELECT release_expired_ai_holds() AS n`, params: [], write: true, nested: true },
  ];
}

async function parameters(client) {
  const users = await client.query(
    `SELECT id::text, email FROM users WHERE email LIKE 'perf-user-%@perf.test' ORDER BY email LIMIT 2`,
  );
  if (users.rows.length < 2) throw new Error("[explain] seed the perf database first (node scripts/perf/seed.mjs)");
  const [hot, regular] = users.rows;
  const { rows: [{ n }] } = await client.query(`SELECT count(*)::int AS n FROM credit_ledger_transactions WHERE user_id = $1`, [hot.id]);
  const cursorAt = async (offset) => {
    const { rows } = await client.query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS t, id::text AS i
       FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC OFFSET $2 LIMIT 1`,
      [hot.id, offset],
    );
    return rows[0];
  };
  const pages = Math.ceil(n / 100);
  const purchase = await client.query(
    `SELECT reference_id FROM credit_ledger_transactions WHERE user_id = $1 AND provider = 'lemonsqueezy' LIMIT 1`,
    [regular.id],
  );
  return {
    hot: hot.id,
    regular: regular.id,
    regularEmail: regular.email,
    hotRows: n,
    hotMid: await cursorAt(Math.floor(pages / 2) * 100 - 1),
    hotLast: await cursorAt((pages - 1) * 100 - 1),
    purchaseRef: purchase.rows[0]?.reference_id ?? "missing",
  };
}

function walk(node, out) {
  out.nodes.push(node["Node Type"] + (node["Index Name"] ? ` (${node["Index Name"]})` : node["Relation Name"] ? ` on ${node["Relation Name"]}` : ""));
  for (const child of node.Plans ?? []) walk(child, out);
  return out;
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};

async function explainOne(client, q, repeat, notices) {
  const times = [];
  let last = null;
  let nested = [];
  for (let i = 0; i <= repeat; i++) {
    notices.length = 0;
    await client.query("BEGIN");
    try {
      const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`, q.params);
      const plan = rows[0]["QUERY PLAN"][0];
      if (i > 0) times.push(plan["Execution Time"]);
      last = plan;
      nested = [...notices];
    } finally {
      // Reads and writes alike: nothing the analysis executes is kept.
      await client.query("ROLLBACK");
    }
  }
  const shape = walk(last.Plan, { nodes: [] });
  return {
    name: q.name,
    source: q.source,
    executionMs: { median: Number(median(times).toFixed(3)), min: Number(Math.min(...times).toFixed(3)), max: Number(Math.max(...times).toFixed(3)) },
    planningMs: Number(last["Planning Time"].toFixed(3)),
    nodes: shape.nodes,
    sharedHit: last.Plan["Shared Hit Blocks"],
    sharedRead: last.Plan["Shared Read Blocks"],
    rows: last.Plan["Actual Rows"],
    nestedPlans: q.nested ? nested : undefined,
    plan: last,
  };
}

export async function runExplain({ repeat = 5, label = "default" } = {}, url = perfDatabaseUrl()) {
  assertTestDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url });
  const notices = [];
  client.on("notice", (n) => notices.push(n.message));
  await client.connect();
  try {
    // Session-only: auto_explain for statements inside functions, sent to this client as NOTICEs.
    await client.query("LOAD 'auto_explain'");
    for (const [k, v] of Object.entries({
      "auto_explain.log_min_duration": "0",
      "auto_explain.log_analyze": "on",
      "auto_explain.log_buffers": "on",
      "auto_explain.log_nested_statements": "on",
      "auto_explain.log_level": "notice",
    })) {
      await client.query(`SET ${k} = '${v}'`);
    }
    const p = await parameters(client);
    const { rows: [counts] } = await client.query(
      `SELECT (SELECT count(*) FROM credit_ledger_transactions)::int AS ledger_rows,
              (SELECT count(*) FROM ai_credit_holds)::int AS holds,
              (SELECT count(*) FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours')::int AS holds_24h,
              (SELECT count(*) FROM users)::int AS users`,
    );
    const results = [];
    for (const q of queries(p)) {
      const r = await explainOne(client, q, repeat, notices);
      results.push(r);
      console.log(`${r.executionMs.median.toFixed(3).padStart(10)} ms  ${r.name.padEnd(48)} ${r.nodes.slice(0, 4).join(" > ")}`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(RESULTS_DIR, `${stamp}-explain-${label}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "result.json"), `${JSON.stringify({ label, counts, hotRows: p.hotRows, repeat, results }, null, 2)}\n`);
    fs.writeFileSync(
      path.join(dir, "plans.txt"),
      results
        .map((r) => `== ${r.name} (${r.source}) — median ${r.executionMs.median} ms\n${JSON.stringify(r.plan.Plan, null, 1)}\n${(r.nestedPlans ?? []).join("\n")}`)
        .join("\n\n"),
    );
    console.log(`[explain] ${JSON.stringify(counts)} → ${path.relative(process.cwd(), dir)}`);
    return { counts, results, dir };
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const get = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  await runExplain({ repeat: Number(get("--repeat", 5)), label: get("--label", "default") });
}
