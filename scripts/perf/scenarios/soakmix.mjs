/**
 * Part 3 soak: mixed production-like traffic (lib/mixed.mjs) at a fixed rate for 15 minutes (open loop), as
 * consecutive 1-minute segments so drift is visible: per minute, per-kind p95 and errors, both servers' heap /
 * RSS / event-loop lag / open handles and sockets, and database backends. Afterwards the charge-consistency
 * checks (lib/integrity.mjs): reservations held past expiry, CAPTURE_FAILED lines, `db:reconcile` exit code.
 *   PERF_SOAK_RATE=<req/s> node scripts/perf/run.mjs soakmix [--duration 900]
 */
import path from "node:path";
import { runOpenLoop } from "../lib/load.mjs";
import { mixedTraffic } from "../lib/mixed.mjs";
import { startDbSampler } from "../lib/db-sampler.mjs";
import { processWindow } from "../lib/window.mjs";
import { countLogLines, holdSummary, runReconcile } from "../lib/integrity.mjs";

export const defaults = { seedArgs: "--users 5000 --rows 20", concurrency: [1], duration: 900, warmup: 30, gemini: "lognormal:1500:4000" };
export const stack = { hopLog: false, procLog: true, apiOverrides: { AI_DAILY_TURNS_GLOBAL: "100000000" } };

export async function run(ctx) {
  const rate = Number(process.env.PERF_SOAK_RATE || 100);
  const minutes = Math.max(1, Math.round(ctx.opts.durationMs / 60_000));
  const sampler = await startDbSampler({ intervalMs: 1000 });
  const pick = mixedTraffic(ctx, { runTag: `soak${Date.now().toString(36)}x` });
  const startedAt = new Date();
  let offset = 0;
  const segments = [];
  try {
    // Warm-up at the same rate, discarded.
    await runOpenLoop({ ratePerSec: rate, durationMs: ctx.opts.warmupMs, pick: (i) => pick(offset + i), maxInFlight: 1500 });
    offset += Math.ceil((rate * ctx.opts.warmupMs) / 1000);
    for (let m = 0; m < minutes; m++) {
      const seg = await runOpenLoop({ ratePerSec: rate, durationMs: 60_000, pick: (i) => pick(offset + i), maxInFlight: 1500, timeoutMs: 30_000 });
      offset += seg.total + 1;
      const s = {
        minute: m + 1,
        achievedPerSec: seg.achievedPerSec,
        errorRatePct: seg.errorRatePct,
        p95: Object.fromEntries(Object.entries(seg.kinds).map(([k, v]) => [k, Math.round(v.p95 ?? 0)])),
        errors: Object.fromEntries(Object.entries(seg.kinds).filter(([, v]) => v.errorRatePct > 0).map(([k, v]) => [k, { statuses: v.statuses, codes: v.errors, dropped: v.dropped }])),
        api: processWindow(ctx.stackFiles.apiProcLog, seg.windowStart, seg.windowEnd),
        web: processWindow(ctx.stackFiles.webProcLog, seg.windowStart, seg.windowEnd),
        db: sampler.summary(seg.windowStart, seg.windowEnd),
      };
      segments.push(s);
      console.log(
        `[soak] min ${String(s.minute).padStart(2)}: ${s.achievedPerSec}/s err ${s.errorRatePct} % | p95 ${Object.entries(s.p95).map(([k, v]) => `${k} ${v}`).join(" ")} | ` +
          `web heap ${s.web?.heapMaxMiB} rss ${s.web?.rssMaxMiB} sockets ${s.web?.socketsMax} lag ${s.web?.lagP99MaxMs} | api heap ${s.api?.heapMaxMiB} rss ${s.api?.rssMaxMiB} sockets ${s.api?.socketsMax} handles ${s.api?.handlesMax} | db backends max active ${s.db.active.max} idle ${s.db.idle.max} idleTx ${s.db.idle_in_tx.max}`,
      );
    }
  } finally {
    await sampler.stop();
  }
  // Let in-flight captures and webhook fulfilment settle before checking.
  await new Promise((r) => setTimeout(r, 15_000));
  const holds = await holdSummary({ since: startedAt });
  const reconcile = runReconcile();
  const captureFailedLines = { web: countLogLines(path.join(ctx.runDir, "web.log"), "CAPTURE_FAILED"), api: countLogLines(path.join(ctx.runDir, "api.log"), "CAPTURE_FAILED") };
  ctx.record("soak", { rate, segments, after: { holds, reconcile, captureFailedLines } });
  console.log(`[soak] after: holds ${JSON.stringify(holds)} | CAPTURE_FAILED lines ${JSON.stringify(captureFailedLines)} | reconcile exit ${reconcile.exitCode}: ${reconcile.output}`);
}
