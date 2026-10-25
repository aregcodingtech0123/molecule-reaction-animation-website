/**
 * Preloaded into BOTH perf servers (NODE_OPTIONS=--import). Same fail-closed network guard as E2E
 * (scripts/test/network-guard.mjs): every non-loopback host is blocked unless stubbed here.
 *
 *  - Gemini (generativelanguage.googleapis.com) is FORWARDED to the local mock server
 *    (scripts/perf/mock-gemini.mjs, PERF_GEMINI_ORIGIN) with the caller's abort signal, so
 *    GEMINI_TIMEOUT_MS and latency/failure injection behave as against a real remote.
 *  - Lemon checkout and Resend answer canned responses in-process (no latency modelled).
 *
 * Optional instrumentation (off unless the variable is set; the runner sets it per scenario):
 *  - PERF_HOP_LOG: JSON lines {t, hop, ms, status} for every upstream fetch this process makes
 *    (Next → Express and Next → Gemini), i.e. the per-hop breakdown of /api/chat.
 *  - PERF_PROC_LOG: one JSON line per second {t, proc, rss, heapUsed, elu, lagP50, lagP99, lagMax}.
 * Lines are buffered and appended asynchronously once a second (and synchronously at exit).
 */
import fs from "node:fs";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { installNetworkGuard, jsonResponse, stubExternal } from "../test/network-guard.mjs";

// Build only (`next build` self-hosts next/font files): the same two font hosts E2E allows. Never at runtime.
installNetworkGuard(
  process.env.PERF_ALLOW_FONT_HOSTS === "1" ? { allowHosts: ["fonts.googleapis.com", "fonts.gstatic.com"] } : {},
);

const geminiOrigin = process.env.PERF_GEMINI_ORIGIN;

stubExternal("generativelanguage.googleapis.com", async (url, _init, request) => {
  if (!geminiOrigin) throw new Error("[perf-preload] PERF_GEMINI_ORIGIN is not set");
  // Loopback: the guard passes it to the real fetch.
  return fetch(`${geminiOrigin}${url.pathname}${url.search}`, {
    method: request.method,
    headers: { "content-type": "application/json" },
    body: await request.text(),
    signal: request.signal,
  });
});

stubExternal("api.lemonsqueezy.com", () =>
  jsonResponse(
    { data: { type: "checkouts", id: "perf", attributes: { url: "https://checkout.perf.test/buy/perf" } } },
    201,
  ),
);

stubExternal("api.resend.com", () => jsonResponse({ id: "perf-mail" }));

// ── Instrumentation ──────────────────────────────────────────────────────────

function lineWriter(file) {
  let buffer = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const chunk = buffer.join("");
    buffer = [];
    fs.appendFile(file, chunk, () => {});
  };
  setInterval(flush, 1000).unref();
  process.on("exit", () => {
    if (buffer.length) fs.appendFileSync(file, buffer.join(""));
  });
  return (obj) => buffer.push(`${JSON.stringify(obj)}\n`);
}

function hopName(url) {
  if (url.hostname === "generativelanguage.googleapis.com") return "gemini";
  const m = url.pathname.match(/^\/api\/(auth|billing|users)\/(.+)$/);
  return m ? `${m[1]}/${m[2]}` : url.pathname;
}

if (process.env.PERF_HOP_LOG) {
  const write = lineWriter(process.env.PERF_HOP_LOG);
  const inner = globalThis.fetch;
  globalThis.fetch = async function timedFetch(input, init) {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    // The Gemini forward re-enters fetch for the mock: time only the outer call.
    if (url.origin === geminiOrigin) return inner(input, init);
    const t = Date.now();
    const start = performance.now();
    try {
      const res = await inner(input, init);
      // Time to response headers, as the caller sees it before reading the (small JSON) body.
      write({ t, hop: hopName(url), ms: performance.now() - start, status: res.status });
      return res;
    } catch (err) {
      write({ t, hop: hopName(url), ms: performance.now() - start, status: 0, error: String(err?.name ?? err) });
      throw err;
    }
  };
}

if (process.env.PERF_PROC_LOG) {
  const write = lineWriter(process.env.PERF_PROC_LOG);
  const proc = process.env.PERF_PROC_NAME || String(process.pid);
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let lastElu = performance.eventLoopUtilization();
  setInterval(() => {
    const elu = performance.eventLoopUtilization(lastElu);
    lastElu = performance.eventLoopUtilization();
    const mem = process.memoryUsage();
    write({
      t: Date.now(),
      proc,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      elu: Number(elu.utilization.toFixed(4)),
      lagP50: lag.percentile(50) / 1e6,
      lagP99: lag.percentile(99) / 1e6,
      lagMax: lag.max / 1e6,
    });
    lag.reset();
  }, 1000).unref();
}
