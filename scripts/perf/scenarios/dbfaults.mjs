/**
 * Database faults (PERF-13 and pool saturation). Express reaches PostgreSQL through the harness TCP
 * proxy (127.0.0.1 only, scripts/perf/lib/tcp-proxy.mjs); the BFF and the browser path are unchanged.
 *  A. latency: 0 / 1 / 5 ms per direction → reserve+capture (many users) and balance, c = 50;
 *  B. pool saturation: a harness-only trigger makes every hold INSERT sleep 200 ms (pg_sleep), so each
 *     reservation holds a pool connection; c = 10 / 20 / 40 / 80 against the pool's max of 20;
 *  C. cold start: drop every connection, keep new ones waiting 0.3 / 1.5 / 2.5 / 5 s (Neon resume vs the
 *     pool's 2 s connect timeout), fire 20 concurrent balance reads, record each status and the recovery;
 *  D. DB down for 10 s: statuses while down (500 vs 503), recovery time after.
 * The trigger and its function exist only in the guarded moleculestudio_perf_test database and are
 * created and dropped by this scenario (the seed recreates the database on every run anyway).
 *   node scripts/perf/run.mjs dbfaults
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { perfDatabaseUrl, serviceRoot } from "../config.mjs";
import { assertTestDatabaseUrl } from "../../test/db-guard.mjs";
import { startTcpProxyProcess } from "../lib/tcp-proxy.mjs";
import { browserRequest, rotatingUser } from "../lib/requests.mjs";

const pg = createRequire(path.join(serviceRoot, "package.json"))("pg");

export const defaults = { concurrency: [50], duration: 10, warmup: 2 };
export const stack = {
  hopLog: false,
  procLog: true,
  apiOverrides: { AI_DAILY_TURNS_PER_USER: "100000000", AI_DAILY_TURNS_GLOBAL: "100000000" },
};

const PERF_DB = "moleculestudio_perf_test";

async function withDb(fn) {
  const url = perfDatabaseUrl();
  const { database } = assertTestDatabaseUrl(url);
  if (database !== PERF_DB) throw new Error(`[dbfaults] refusing database ${database}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const SLOW_DDL = `
CREATE OR REPLACE FUNCTION perf_harness_slow_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_sleep(0.2);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS perf_harness_slow_hold_trg ON ai_credit_holds;
CREATE TRIGGER perf_harness_slow_hold_trg BEFORE INSERT ON ai_credit_holds
  FOR EACH ROW EXECUTE FUNCTION perf_harness_slow_hold();`;
const DROP_SLOW = `
DROP TRIGGER IF EXISTS perf_harness_slow_hold_trg ON ai_credit_holds;
DROP FUNCTION IF EXISTS perf_harness_slow_hold();`;

/** Runs before the stack: Express gets the proxy as its database host. */
export async function prepare() {
  const url = new URL(perfDatabaseUrl());
  const proxy = await startTcpProxyProcess({ targetHost: url.hostname, targetPort: Number(url.port || 5432) });
  url.host = `127.0.0.1:${proxy.port}`;
  return {
    apiOverrides: { DATABASE_URL: url.toString() },
    extras: { proxy },
    cleanup: async () => {
      await withDb((c) => c.query(DROP_SLOW)).catch(() => {});
      await proxy.close();
    },
  };
}

function meteringFlow(ctx, pickUser) {
  const call = (token, p, body) => ({
    method: "POST",
    path: `/api/billing/${p}`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-internal-service-key": ctx.internalKey },
    body: JSON.stringify(body),
  });
  return async (it) => {
    const token = ctx.session(pickUser(it));
    const referenceId = randomUUID();
    const reserved = await it.send(call(token, "consume", { operationType: "AI_CHAT_QUERY", referenceId }));
    if (reserved.status !== 200) return;
    await it.send(call(token, "capture", { referenceId }));
  };
}

async function burst(ctx, n) {
  const started = performance.now();
  return Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const req = browserRequest(ctx.session(1 + i), i, "GET", "/api/billing/balance");
      const t = performance.now();
      try {
        const res = await fetch(`${ctx.webOrigin}/api/billing/balance`, { headers: req.headers, signal: AbortSignal.timeout(30_000) });
        const body = await res.text();
        return { status: res.status, ms: Math.round(performance.now() - t), code: /"code":"([A-Z_]+)"/.exec(body)?.[1] ?? null };
      } catch (err) {
        return { status: 0, ms: Math.round(performance.now() - t), code: err.name };
      }
    }),
  ).then((r) => ({ results: r, wallMs: Math.round(performance.now() - started) }));
}

async function timeToRecovery(ctx, limitMs = 60_000) {
  const t = performance.now();
  while (performance.now() - t < limitMs) {
    const req = browserRequest(ctx.session(1), 0, "GET", "/api/billing/balance");
    const res = await fetch(`${ctx.webOrigin}/api/billing/balance`, { headers: req.headers }).catch(() => null);
    if (res?.status === 200) return Math.round(performance.now() - t);
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

const tally = (results) => results.reduce((acc, r) => ((acc[`${r.status}${r.code ? ` ${r.code}` : ""}`] = (acc[`${r.status}${r.code ? ` ${r.code}` : ""}`] ?? 0) + 1), acc), {});

export async function run(ctx) {
  const { proxy } = ctx.extras;
  const pick = (c) => rotatingUser(ctx.users.length, c);

  // A. Latency.
  for (const latency of [0, 1, 5]) {
    await proxy.setLatency(latency);
    await ctx.measure(`A latency ${latency} ms: reserve+capture c=50`, { origin: ctx.apiOrigin, concurrency: 50, flow: meteringFlow(ctx, pick(50)), dbSampler: true });
    await ctx.measure(`A latency ${latency} ms: balance BFF c=50`, {
      origin: ctx.webOrigin,
      concurrency: 50,
      request: (it) => browserRequest(ctx.session(pick(50)(it)), it.vu, "GET", "/api/billing/balance"),
    });
  }
  await proxy.setLatency(0);

  // B. Pool saturation.
  await withDb((c) => c.query(SLOW_DDL));
  try {
    for (const c of [10, 20, 40, 80]) {
      await ctx.measure(`B slow hold insert (200 ms): reserve+capture c=${c}`, { origin: ctx.apiOrigin, concurrency: c, flow: meteringFlow(ctx, pick(c)), dbSampler: true });
    }
  } finally {
    await withDb((c) => c.query(DROP_SLOW));
  }

  // C. Cold start.
  const cold = [];
  for (const wakeMs of [300, 1500, 2500, 5000]) {
    await proxy.suspend(wakeMs);
    const b = await burst(ctx, 20);
    const recoveryMs = await timeToRecovery(ctx);
    cold.push({ wakeMs, statuses: tally(b.results), maxMs: Math.max(...b.results.map((r) => r.ms)), wallMs: b.wallMs, recoveryMs });
    console.log(`[dbfaults] cold start ${wakeMs} ms: ${JSON.stringify(tally(b.results))}, recovery ${recoveryMs} ms`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  ctx.record("coldStart", cold);

  // D. DB down for 10 s.
  await proxy.setDown(true);
  const down = [];
  const downUntil = performance.now() + 10_000;
  while (performance.now() < downUntil) {
    down.push(...(await burst(ctx, 5)).results);
    await new Promise((r) => setTimeout(r, 500));
  }
  await proxy.setDown(false);
  const recoveryMs = await timeToRecovery(ctx);
  ctx.record("dbDown", { statuses: tally(down), maxMs: Math.max(...down.map((r) => r.ms)), recoveryMs });
  console.log(`[dbfaults] DB down: ${JSON.stringify(tally(down))}, recovery ${recoveryMs} ms`);
  ctx.record("proxyStats", await proxy.stats());
}
