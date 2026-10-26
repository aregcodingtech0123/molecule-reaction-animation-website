/**
 * One AI Lab turn through the BFF: JWT → /auth/me → /consume → Gemini (mock) → /capture, with the
 * per-hop breakdown from the Next process. Overhead = end-to-end minus the Gemini hop.
 *   node scripts/perf/run.mjs chat [--gemini fixed:0|lognormal:1500:4000] [--concurrency 1,10,50]
 *
 * Users rotate over 5 000 seeded users so none reaches the BFF's per-user limit (10 / min). The global
 * daily cap is raised (recorded in the result) because a benchmark makes more turns than the default
 * 3 000 / 24 h allows; the cap query itself still runs on every reservation. Per-user caps stay at
 * the default. Cap behaviour at the boundary is its own Part 1 scenario.
 */
import { perfDatabaseUrl } from "../config.mjs";
import { startTcpProxyProcess } from "../lib/tcp-proxy.mjs";
import { browserRequest, rotatingUser } from "../lib/requests.mjs";

export const defaults = { seedArgs: "--users 5000 --rows 20", concurrency: [1, 10, 50], duration: 15, warmup: 3, gemini: "fixed:0" };
// PERF_CHAT_HOPLOG=0 runs without the hop log (measures the instrumentation's own cost).
const hopLog = process.env.PERF_CHAT_HOPLOG !== "0";
// PERF-19 experiments: PERF_CHAT_FORCE_GC_MS forces full GCs in Next (heap troughs = retained memory);
// PERF_CHAT_GEMINI_TIMEOUT_MS overrides GEMINI_TIMEOUT_MS (does retention scale with the timeout?).
const webOverrides = {
  ...(process.env.PERF_CHAT_FORCE_GC_MS ? { PERF_FORCE_GC_MS: process.env.PERF_CHAT_FORCE_GC_MS } : {}),
  ...(process.env.PERF_CHAT_GEMINI_TIMEOUT_MS ? { GEMINI_TIMEOUT_MS: process.env.PERF_CHAT_GEMINI_TIMEOUT_MS } : {}),
};
export const stack = { hopLog, procLog: true, apiOverrides: { AI_DAILY_TURNS_GLOBAL: "100000000" }, webOverrides };

/**
 * PERF_DB_PROXY_LATENCY_MS: Express reaches PostgreSQL through the harness TCP proxy (127.0.0.1 only)
 * with this delay per direction — a production-like DB round trip (Render → Neon ≈ 1–2 ms) instead of
 * loopback.
 */
export async function prepare() {
  const latency = Number(process.env.PERF_DB_PROXY_LATENCY_MS || 0);
  if (!latency) return {};
  const url = new URL(perfDatabaseUrl());
  const proxy = await startTcpProxyProcess({ targetHost: url.hostname, targetPort: Number(url.port || 5432) });
  await proxy.setLatency(latency);
  url.host = `127.0.0.1:${proxy.port}`;
  return { apiOverrides: { DATABASE_URL: url.toString(), PERF_DB_PROXY_LATENCY_MS: String(latency) }, cleanup: () => proxy.close() };
}

export async function run(ctx) {
  ctx.note(`Gemini mock latency: ${JSON.stringify(ctx.opts.gemini)}`);
  for (const c of ctx.opts.concurrency) {
    const pick = rotatingUser(ctx.users.length, c);
    await ctx.measure(`chat turn c=${c}`, {
      origin: ctx.webOrigin,
      concurrency: c,
      tag: hopLog,
      request: (it) =>
        browserRequest(ctx.session(pick(it)), it.vu, "POST", "/api/chat", {
          messages: [{ role: "user", content: "Explain why benzene is aromatic in two sentences." }],
        }),
    });
  }
}
