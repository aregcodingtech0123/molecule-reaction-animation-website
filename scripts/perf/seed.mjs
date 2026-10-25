/**
 * Deterministic perf dataset in the guarded `moleculestudio_perf_test` database.
 *
 *   node scripts/perf/seed.mjs [--users 1000] [--rows 200] [--hot-rows 100000] [--spacing-min 720]
 *                              [--hot-spacing-min 5] [--seed 1]
 *
 * Recreates the database with the SAME tracked migration runner production uses (001 → latest), then
 * builds, entirely in SQL:
 *  - user 0 = the "hot" user with --hot-rows ledger rows; users 1..N with --rows rows each. Ids, emails
 *    and row contents derive from --seed (md5), so two seeds with the same arguments are identical
 *    except for timestamps, which are relative to the seed time (the 24 h windows need that);
 *  - per user: one large ADMIN_ADJUSTMENT (so load never runs out of credits), then CREDIT_PURCHASE +50
 *    on every 10th row (provider lemonsqueezy) and CREDIT_CONSUMPTION -1 otherwise, --spacing-min apart
 *    (--hot-spacing-min for the hot user). Defaults put ~1 300 holds in the last 24 h (≈1 per user plus ~260
 *    for the hot user), under the production global cap of 3 000 (SEC-16); --spacing-min 72 gives ~10x.
 *    The hot user is therefore already over the per-user cap (200): it is for read-path scenarios;
 *  - a captured AI hold for every consumption row of the last 48 h (as the reservation flow leaves it),
 *    so the daily-cap counters see realistic 24 h volumes;
 *  - user_balances = SUM(ledger), so ledger_reconciliation() is empty (checked at the end).
 * All users are verified, token_version 0, password = PERF_PASSWORD (bcrypt cost 10, hashed once).
 * Rows are INSERTed directly (with explicit created_at) because post_credit_transaction() stamps NOW();
 * no trigger is disabled and nothing is UPDATEd or DELETEd.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PERF_PASSWORD, RESULTS_DIR, perfDatabaseUrl, serviceRoot } from "./config.mjs";
import { assertTestDatabaseUrl } from "../test/db-guard.mjs";
import { prepareTestDatabase } from "../test/prepare-test-db.mjs";

const requireFromService = createRequire(path.join(serviceRoot, "package.json"));
const pg = requireFromService("pg");
const bcrypt = requireFromService("bcrypt");

export const SEED_DEFAULTS = { users: 1000, rows: 200, hotRows: 100_000, spacingMin: 720, hotSpacingMin: 5, seed: 1 };

export function parseSeedArgs(argv) {
  const out = { ...SEED_DEFAULTS };
  const names = {
    "--users": "users",
    "--rows": "rows",
    "--hot-rows": "hotRows",
    "--spacing-min": "spacingMin",
    "--hot-spacing-min": "hotSpacingMin",
    "--seed": "seed",
  };
  for (let i = 0; i < argv.length; i++) {
    const key = names[argv[i]];
    if (!key) continue;
    const v = Number(argv[++i]);
    if (!Number.isInteger(v) || v < 0) throw new Error(`${argv[i - 1]} needs a non-negative integer`);
    out[key] = v;
  }
  if (out.rows < 1 || out.hotRows < 1 || out.spacingMin < 1 || out.hotSpacingMin < 1) {
    throw new Error("--rows, --hot-rows, --spacing-min and --hot-spacing-min must be ≥ 1");
  }
  return out;
}

export async function seedPerfDatabase(options = SEED_DEFAULTS, url = perfDatabaseUrl()) {
  assertTestDatabaseUrl(url);
  const o = { ...SEED_DEFAULTS, ...options };
  const started = Date.now();
  await prepareTestDatabase(url);
  const hash = await bcrypt.hash(PERF_PASSWORD, 10);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    // u = 0 is the hot user. Per user: n rows, `gap` minutes apart.
    await client.query(
      `CREATE TEMP TABLE perf_users ON COMMIT DROP AS
       SELECT u, md5('perf-user-' || $1::int || '-' || u)::uuid AS id,
              'perf-user-' || lpad(u::text, 5, '0') || '@perf.test' AS email,
              CASE WHEN u = 0 THEN $3::int ELSE $4::int END AS n,
              CASE WHEN u = 0 THEN $6::int ELSE $5::int END AS gap
       FROM generate_series(0, $2::int) AS u`,
      [o.seed, o.users, o.hotRows, o.rows, o.spacingMin, o.hotSpacingMin],
    );
    await client.query(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       SELECT id, email, $1, true, NOW() - make_interval(mins => (n + 10) * gap) FROM perf_users`,
      [hash],
    );
    await client.query(
      `INSERT INTO credit_ledger_transactions (user_id, amount, transaction_type, reference_id, provider, created_at)
       SELECT p.id,
              CASE WHEN j = 1 THEN 1000000 WHEN j % 10 = 0 THEN 50 ELSE -1 END,
              (CASE WHEN j = 1 THEN 'ADMIN_ADJUSTMENT' WHEN j % 10 = 0 THEN 'CREDIT_PURCHASE' ELSE 'CREDIT_CONSUMPTION' END)::credit_transaction_type,
              CASE WHEN j = 1 THEN 'perf-seed'
                   WHEN j % 10 = 0 THEN 'perf_order_' || $1::int || '_' || p.u || '_' || j
                   ELSE md5('perf-turn-' || $1::int || '-' || p.u || '-' || j)::uuid::text END,
              CASE WHEN j % 10 = 0 AND j > 1 THEN 'lemonsqueezy' END,
              NOW() - make_interval(mins => (p.n - j) * p.gap, secs => abs(hashtext(p.u || ':' || j)) % 30)
       FROM perf_users p, generate_series(1, p.n) AS j`,
      [o.seed],
    );
    await client.query(
      `INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, status, created_at, expires_at, settled_at, ledger_id)
       SELECT l.user_id, l.reference_id, 'AI_CHAT_QUERY', 1, 'captured',
              l.created_at - interval '3 seconds', l.created_at + interval '597 seconds', l.created_at, l.id
       FROM credit_ledger_transactions l
       WHERE l.transaction_type = 'CREDIT_CONSUMPTION' AND l.created_at > NOW() - interval '48 hours'`,
    );
    await client.query(
      `INSERT INTO user_balances (user_id, balance)
       SELECT user_id, SUM(amount) FROM credit_ledger_transactions GROUP BY user_id`,
    );
    await client.query("COMMIT");
    await client.query("VACUUM ANALYZE");

    const { rows: problems } = await client.query("SELECT issue FROM ledger_reconciliation()");
    if (problems.length > 0) throw new Error(`[perf-seed] ledger_reconciliation() reported ${problems.length} issue(s)`);
    const { rows: [counts] } = await client.query(
      `SELECT (SELECT count(*) FROM users)::int AS users,
              (SELECT count(*) FROM credit_ledger_transactions)::int AS ledger_rows,
              (SELECT count(*) FROM ai_credit_holds)::int AS holds,
              (SELECT count(*) FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours')::int AS holds_24h`,
    );
    const manifest = { options: o, seededAt: new Date().toISOString(), seconds: (Date.now() - started) / 1000, counts };
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, "seed-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

/** Seeded users in a stable order (index 0 = hot user). */
export async function loadPerfUsers(url = perfDatabaseUrl()) {
  assertTestDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id::text, email, token_version FROM users WHERE email LIKE 'perf-user-%@perf.test' ORDER BY email`,
    );
    return rows;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const manifest = await seedPerfDatabase(parseSeedArgs(process.argv.slice(2)));
  console.log(`[perf-seed] ${JSON.stringify(manifest.counts)} in ${manifest.seconds.toFixed(1)} s`);
}
