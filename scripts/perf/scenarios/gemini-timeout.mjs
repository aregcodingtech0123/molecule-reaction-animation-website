/**
 * PERF-21 reproduction: does GEMINI_TIMEOUT_MS bound a turn whose model call never answers, including the
 * FIRST turn after the Next server starts? The mock hangs every call (run with --gemini-failure 1:hang);
 * three turns are sent one after another on a fresh stack and each one's time to answer is recorded.
 *   node scripts/perf/run.mjs gemini-timeout --gemini-failure 1:hang [--runs 1]
 * PERF_REPRO_TIMEOUT_MS sets GEMINI_TIMEOUT_MS (default 30000, the production default).
 * PERF_REPRO_FORCE_GC_MS forces a full GC in the Next process at that interval, so a signal that is only
 * weakly reachable is collected deterministically instead of by luck.
 */
import { performance } from "node:perf_hooks";
import { browserRequest } from "../lib/requests.mjs";

const timeoutMs = Number(process.env.PERF_REPRO_TIMEOUT_MS || 30_000);

const forceGcMs = process.env.PERF_REPRO_FORCE_GC_MS || "";

export const defaults = { seedArgs: "--users 20 --rows 20 --hot-rows 500", concurrency: [1] };
export const stack = {
  hopLog: true,
  procLog: false,
  webOverrides: { GEMINI_TIMEOUT_MS: String(timeoutMs), ...(forceGcMs ? { PERF_FORCE_GC_MS: forceGcMs } : {}) },
};

export async function run(ctx) {
  ctx.note(`GEMINI_TIMEOUT_MS=${timeoutMs}; forced GC every ${forceGcMs || "—"} ms; mock: ${JSON.stringify(ctx.opts.geminiFailure)}`);
  const turns = [];
  for (let i = 0; i < 3; i++) {
    const req = browserRequest(ctx.session(1 + i), i, "POST", "/api/chat", { messages: [{ role: "user", content: "What is benzene?" }] });
    const start = performance.now();
    let status = 0;
    let body = "";
    try {
      // Client cap well above undici's 300 s headers timeout, so a missing abort shows as ~300 s, not as our cap.
      const res = await fetch(`${ctx.webOrigin}/api/chat`, { ...req, signal: AbortSignal.timeout(timeoutMs + 330_000) });
      status = res.status;
      body = (await res.text()).slice(0, 200);
    } catch (err) {
      body = String(err?.name ?? err);
    }
    const elapsedMs = Math.round(performance.now() - start);
    turns.push({ turn: i + 1, status, elapsedMs, body });
    console.log(`[gemini-timeout] turn ${i + 1}: HTTP ${status} after ${elapsedMs} ms ${body}`);
  }
  ctx.record("turns", turns);
}
