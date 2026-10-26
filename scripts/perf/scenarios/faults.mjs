/**
 * Part 3 failure injection under load: mixed traffic (lib/mixed.mjs) at a fixed rate through consecutive
 * phases, each fault switched on at the phase start and off at its end:
 *   baseline → Gemini 5xx (50 % of model calls) → Gemini hang (50 %; GEMINI_TIMEOUT_MS) →
 *   DB latency +20 ms per direction → DB spike +100 ms per direction → billing unavailable for 30 s in the
 *   middle of a 90 s phase (in-flight chat turns straddle it) → recovery.
 * The DB faults use the harness TCP proxy between Express and PostgreSQL; "billing unavailable" a second
 * proxy between the BFF and Express (AUTH/BILLING/USERS_SERVICE_URL): every connection dropped, new ones
 * refused. Signed webhooks go to Express directly (the payment provider does not pass through the BFF).
 * Per phase: per-kind statuses / p95, and a 5 s timeline (errors by status), so error behaviour (clean
 * 502/503/504 vs resets or hangs) and recovery are visible.
 * Afterwards: wait until every reservation of the run is settled (sweeper: AI_HOLD_TTL_SECONDS=180,
 * AI_HOLD_SWEEP_INTERVAL_MS=30000), then the charge-consistency checks (lib/integrity.mjs).
 * TTL 180 s ≥ 2 × the longest turn with production BFF defaults (30 s model + capture retries ≈ 85 s).
 *   PERF_FAULT_RATE=<req/s> node scripts/perf/run.mjs faults
 */
import path from "node:path";
import { API_PORT, perfDatabaseUrl } from "../config.mjs";
import { startTcpProxyProcess } from "../lib/tcp-proxy.mjs";
import { runOpenLoop } from "../lib/load.mjs";
import { mixedTraffic } from "../lib/mixed.mjs";
import { startDbSampler } from "../lib/db-sampler.mjs";
import { processWindow } from "../lib/window.mjs";
import { countLogLines, holdSummary, runReconcile } from "../lib/integrity.mjs";

const HOLD_TTL_S = 180;
const SWEEP_MS = 30_000;

export const defaults = { seedArgs: "--users 5000 --rows 20", concurrency: [1], gemini: "lognormal:1500:4000" };
export const stack = {
  hopLog: false,
  procLog: true,
  apiOverrides: { AI_DAILY_TURNS_GLOBAL: "100000000", AI_HOLD_TTL_SECONDS: String(HOLD_TTL_S), AI_HOLD_SWEEP_INTERVAL_MS: String(SWEEP_MS) },
};

/** Runs before the stack: Express reaches PostgreSQL, and the BFF reaches Express, through local proxies. */
export async function prepare() {
  const dbUrl = new URL(perfDatabaseUrl());
  const db = await startTcpProxyProcess({ targetHost: dbUrl.hostname, targetPort: Number(dbUrl.port || 5432) });
  dbUrl.host = `127.0.0.1:${db.port}`;
  const billing = await startTcpProxyProcess({ targetHost: "127.0.0.1", targetPort: API_PORT });
  const via = `http://127.0.0.1:${billing.port}`;
  return {
    apiOverrides: { DATABASE_URL: dbUrl.toString() },
    webOverrides: { AUTH_SERVICE_URL: `${via}/api/auth`, BILLING_SERVICE_URL: `${via}/api/billing`, USERS_SERVICE_URL: `${via}/api/users` },
    extras: { dbProxy: db, billingProxy: billing },
    cleanup: async () => {
      await db.close();
      await billing.close();
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(ctx) {
  const rate = Number(process.env.PERF_FAULT_RATE || 100);
  const { dbProxy, billingProxy } = ctx.extras;
  // `/__config` replaces the whole configuration: keep the run's latency model in every change.
  const mock = (cfg) => ctx.configureMock({ latency: ctx.opts.gemini, ...cfg });
  const healthy = { failureRate: 0 };
  const phases = [
    { name: "baseline", seconds: 60 },
    { name: "gemini 5xx 50 %", seconds: 60, on: () => mock({ failureRate: 0.5, failureMode: "500" }), off: () => mock(healthy) },
    { name: "gemini hang 50 %", seconds: 60, on: () => mock({ failureRate: 0.5, failureMode: "hang" }), off: () => mock(healthy) },
    { name: "db +20 ms/direction", seconds: 60, on: () => dbProxy.setLatency(20), off: () => dbProxy.setLatency(0) },
    { name: "db spike +100 ms/direction", seconds: 30, on: () => dbProxy.setLatency(100), off: () => dbProxy.setLatency(0) },
    { name: "billing down 30 s (from 30 s to 60 s)", seconds: 90, at: [[30, () => billingProxy.setDown(true)], [60, () => billingProxy.setDown(false)]] },
    { name: "recovery", seconds: 60 },
  ];

  const startedAt = new Date();
  const holdsBefore = await holdSummary();
  const sampler = await startDbSampler({ intervalMs: 500 });
  const pick = mixedTraffic(ctx, { runTag: `f${Date.now().toString(36)}x` });
  let offset = 0;
  const results = [];
  try {
    for (const phase of phases) {
      await phase.on?.();
      const timeline = new Map();
      let t0 = 0;
      const timers = (phase.at ?? []).map(([s, fn]) => setTimeout(fn, s * 1000));
      const res = await runOpenLoop({
        ratePerSec: rate,
        durationMs: phase.seconds * 1000,
        pick: (i) => {
          if (i === 0) t0 = performance.now();
          return pick(offset + i);
        },
        maxInFlight: 3000,
        timeoutMs: 120_000,
        onResult: (r) => {
          const b = Math.floor((r.scheduledAt - t0) / 5000) * 5;
          const e = timeline.get(b) ?? { n: 0, err: {} };
          e.n += 1;
          if (!(r.status >= 200 && r.status < 400)) {
            const key = `${r.kind} ${r.status || r.error}`;
            e.err[key] = (e.err[key] ?? 0) + 1;
          }
          timeline.set(b, e);
        },
      });
      timers.forEach(clearTimeout);
      await phase.off?.();
      offset += res.total + 1;
      const out = {
        phase: phase.name,
        seconds: phase.seconds,
        achievedPerSec: res.achievedPerSec,
        errorRatePct: res.errorRatePct,
        maxInFlight: res.maxInFlight,
        kinds: Object.fromEntries(Object.entries(res.kinds).map(([k, v]) => [k, { n: v.n, p50: Math.round(v.p50 ?? 0), p95: Math.round(v.p95 ?? 0), max: Math.round(v.max ?? 0), statuses: v.statuses, errors: v.errors, dropped: v.dropped }])),
        timeline: [...timeline.entries()].sort((a, b) => a[0] - b[0]).map(([s, e]) => ({ s, ...e })),
        api: processWindow(ctx.stackFiles.apiProcLog, res.windowStart, res.windowEnd),
        web: processWindow(ctx.stackFiles.webProcLog, res.windowStart, res.windowEnd),
        db: sampler.summary(res.windowStart, res.windowEnd),
      };
      results.push(out);
      console.log(
        `[faults] ${phase.name}: ${out.achievedPerSec}/s, errors ${out.errorRatePct} %, in-flight max ${out.maxInFlight} | ` +
          Object.entries(out.kinds).map(([k, v]) => `${k} p95 ${v.p95} ${JSON.stringify(v.statuses)}${Object.keys(v.errors).length ? ` ${JSON.stringify(v.errors)}` : ""}`).join("; ") +
          ` | db active ${out.db.active.max} waiting ${out.db.lock_waiting.max}`,
      );
      for (const e of out.timeline) if (Object.keys(e.err).length) console.log(`[faults]   t+${e.s}s n=${e.n} ${JSON.stringify(e.err)}`);
    }
  } finally {
    await sampler.stop();
    await mock(healthy).catch(() => {});
    await dbProxy.setLatency(0);
    await billingProxy.setDown(false);
  }

  // Every reservation of the run must settle: captured / released at once, or expired by the sweeper
  // (TTL + one sweep interval at most). Poll until none is held, with a bounded wait.
  const settleStart = performance.now();
  let holds = await holdSummary({ since: startedAt });
  while (holds.heldNow > 0 && performance.now() - settleStart < (HOLD_TTL_S * 1000 + SWEEP_MS) * 1.5) {
    await sleep(10_000);
    holds = await holdSummary({ since: startedAt });
  }
  const settledAfterMs = Math.round(performance.now() - settleStart);
  const reconcile = runReconcile();
  const captureFailedLines = { web: countLogLines(path.join(ctx.runDir, "web.log"), "CAPTURE_FAILED"), api: countLogLines(path.join(ctx.runDir, "api.log"), "CAPTURE_FAILED") };
  const after = { holdsBefore, holds, settledAfterMs, reconcile, captureFailedLines, dbProxy: await dbProxy.stats(), billingProxy: await billingProxy.stats() };
  ctx.record("faults", { rate, holdTtlSeconds: HOLD_TTL_S, sweepIntervalMs: SWEEP_MS, phases: results, after });
  console.log(`[faults] after (${settledAfterMs} ms): holds ${JSON.stringify(holds)} | CAPTURE_FAILED lines ${JSON.stringify(captureFailedLines)} | reconcile exit ${reconcile.exitCode}: ${reconcile.output}`);
}
