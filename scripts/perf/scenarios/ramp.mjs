/**
 * Part 3 ramp: mixed production-like traffic (lib/mixed.mjs) at increasing fixed arrival rates (open loop),
 * until the system breaks, then one step beyond to show how it fails. A step "breaks" when the error rate
 * exceeds 1 %, arrivals are dropped (> maxInFlight outstanding), or any non-chat kind's p95 exceeds 1 s.
 * Per step: per-kind p50/p95/p99 and statuses, both servers' ELU / event-loop lag / memory / sockets, and the
 * database (active / idle-in-transaction backends, lock waits). Mock Gemini: lognormal 1.5 s / 4 s.
 * After the overload step, a recovery step at the last good rate shows whether the stack comes back by itself.
 *   node scripts/perf/run.mjs ramp [--duration 30] [--warmup 5]
 * PERF_RAMP_STEPS=25,50,100 overrides the rates (requests per second).
 * PERF_RAMP_TARGET=api drives Express directly (lib/mixed.mjs target "api"): a single Express's own limit.
 */
import { runOpenLoop } from "../lib/load.mjs";
import { mixedTraffic } from "../lib/mixed.mjs";
import { startDbSampler } from "../lib/db-sampler.mjs";
import { processWindow } from "../lib/window.mjs";

export const defaults = { seedArgs: "--users 5000 --rows 20", concurrency: [1], duration: 30, warmup: 5, gemini: "lognormal:1500:4000" };
export const stack = { hopLog: false, procLog: true, apiOverrides: { AI_DAILY_TURNS_GLOBAL: "100000000" } };

const STEPS = (process.env.PERF_RAMP_STEPS ?? "25,50,100,150,200,300,400,600,800").split(",").map(Number);
const TARGET = process.env.PERF_RAMP_TARGET === "api" ? "api" : "web";

export function stepBroke(step) {
  if (step.errorRatePct > 1) return `error rate ${step.errorRatePct} %`;
  const dropped = Object.values(step.kinds).reduce((a, k) => a + k.dropped, 0);
  if (dropped > 0) return `${dropped} arrivals dropped (client in-flight cap)`;
  const slow = Object.entries(step.kinds).filter(([k, v]) => k !== "chat" && v.p95 > 1000);
  if (slow.length) return `p95 > 1 s: ${slow.map(([k, v]) => `${k} ${Math.round(v.p95)} ms`).join(", ")}`;
  return null;
}

export async function run(ctx) {
  const steps = [];
  const sampler = await startDbSampler({ intervalMs: 250 });
  const tag = Date.now().toString(36);
  // Arrival indices continue across steps: each arrival keeps its own client IP for the whole run, so the
  // login limiter (5 per IP + email per 15 min) never sees a pair again (it did when every step restarted at 0).
  let base = 0;
  let brokeAt = null;
  let recovery = null;
  const step = async (rate, label) => {
    console.log(`[ramp] ${label} ${rate} req/s …`);
    const s = await runOpenLoop({
      ratePerSec: rate,
      durationMs: ctx.opts.durationMs,
      warmupMs: ctx.opts.warmupMs,
      pick: ((pick, from) => (i) => pick(from + i))(mixedTraffic(ctx, { runTag: `r${tag}${label[0]}${rate}x`, target: TARGET }), base),
      maxInFlight: 1500,
      timeoutMs: 30_000,
    });
    base += s.total + Math.ceil((rate * ctx.opts.warmupMs) / 1000) + 1;
    s.db = sampler.summary(s.windowStart, s.windowEnd);
    s.api = processWindow(ctx.stackFiles.apiProcLog, s.windowStart, s.windowEnd);
    s.web = processWindow(ctx.stackFiles.webProcLog, s.windowStart, s.windowEnd);
    s.broke = stepBroke(s);
    console.log(
      `[ramp] ${label} ${rate}/s → ${s.achievedPerSec}/s, errors ${s.errorRatePct} %, in-flight max ${s.maxInFlight} | ` +
        Object.entries(s.kinds).map(([n, v]) => `${n} p95 ${Math.round(v.p95 ?? 0)}`).join(", ") +
        ` | web ELU ${s.web?.eluMean} lag ${s.web?.lagP99MaxMs} | api ELU ${s.api?.eluMean} lag ${s.api?.lagP99MaxMs} | db active ${s.db.active.max} idleTx ${s.db.idle_in_tx.max} lockWait ${s.db.lock_waiting.max}` +
        (s.broke ? ` | BROKE: ${s.broke}` : ""),
    );
    return s;
  };
  try {
    for (const rate of STEPS) {
      const s = await step(rate, "step");
      steps.push(s);
      if (brokeAt !== null) break; // one step beyond the breaking point, then stop
      if (s.broke) brokeAt = rate;
    }
    const lastGood = steps.filter((s) => !s.broke).at(-1)?.ratePerSec;
    if (brokeAt !== null && lastGood) recovery = await step(lastGood, "recovery");
  } finally {
    await sampler.stop();
    ctx.record("ramp", { target: TARGET, steps, brokeAt, lastGoodRate: steps.filter((s) => !s.broke).at(-1)?.ratePerSec ?? null, recovery });
  }
}
