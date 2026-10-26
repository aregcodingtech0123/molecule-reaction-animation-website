/**
 * Preloaded into BOTH perf servers (NODE_OPTIONS=--import). Same fail-closed network guard as E2E
 * (scripts/test/network-guard.mjs): every non-loopback host is blocked unless stubbed here.
 *
 *  - Gemini (generativelanguage.googleapis.com) is REDIRECTED to the local mock server
 *    (scripts/perf/mock-gemini.mjs, PERF_GEMINI_ORIGIN): only the URL changes, the caller's `init` —
 *    and so its abort signal — reaches the real fetch untouched, exactly as in production (PERF-21,
 *    scripts/perf/lib/gemini-redirect.mjs).
 *  - Lemon checkout and Resend answer canned responses in-process (no latency modelled).
 *
 * Optional instrumentation (off unless the variable is set; the runner sets it per scenario):
 *  - PERF_HOP_LOG: JSON lines {t, hop, ms, status, req} for every upstream fetch this process makes
 *    (Next → Express and Next → Gemini), i.e. the per-hop breakdown of /api/chat. `req` is the load
 *    driver's `x-perf-req` header of the incoming request that caused the call (AsyncLocalStorage), so
 *    hops can be joined to their request exactly.
 *  - PERF_PROC_LOG: one JSON line per second {t, proc, rss, heapUsed, elu, lagP50, lagP99, lagMax}.
 * Lines are buffered and appended asynchronously once a second (and synchronously at exit).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import http from "node:http";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { installNetworkGuard, jsonResponse, stubExternal } from "../test/network-guard.mjs";
import { GEMINI_HOST, geminiRedirect } from "./lib/gemini-redirect.mjs";

// Build only (`next build` self-hosts next/font files): the same two font hosts E2E allows. Never at runtime.
installNetworkGuard(
  process.env.PERF_ALLOW_FONT_HOSTS === "1" ? { allowHosts: ["fonts.googleapis.com", "fonts.gstatic.com"] } : {},
);

globalThis.fetch = geminiRedirect(globalThis.fetch, process.env.PERF_GEMINI_ORIGIN);

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
  if (url.hostname === GEMINI_HOST) return "gemini";
  const m = url.pathname.match(/^\/api\/(auth|billing|users)\/(.+)$/);
  return m ? `${m[1]}/${m[2]}` : url.pathname;
}

if (process.env.PERF_HOP_LOG) {
  const write = lineWriter(process.env.PERF_HOP_LOG);
  // Tag everything an incoming request does with the driver's request id.
  const current = new AsyncLocalStorage();
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function tagRequest(event, req, ...rest) {
    const id = event === "request" ? req?.headers?.["x-perf-req"] : undefined;
    return id ? current.run(String(id), () => emit.call(this, event, req, ...rest)) : emit.call(this, event, req, ...rest);
  };
  const inner = globalThis.fetch;
  globalThis.fetch = async function timedFetch(input, init) {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    const t = Date.now();
    const start = performance.now();
    try {
      const res = await inner(input, init);
      // Time to response headers, as the caller sees it before reading the (small JSON) body.
      write({ t, hop: hopName(url), ms: performance.now() - start, status: res.status, req: current.getStore() });
      return res;
    } catch (err) {
      write({ t, hop: hopName(url), ms: performance.now() - start, status: 0, error: String(err?.name ?? err), req: current.getStore() });
      throw err;
    }
  };
}

// PERF-21 evidence: force a full GC every N ms (needs --expose-gc; config.mjs adds it when this is set).
if (process.env.PERF_FORCE_GC_MS && typeof globalThis.gc === "function") {
  setInterval(() => globalThis.gc(), Number(process.env.PERF_FORCE_GC_MS)).unref();
}

if (process.env.PERF_CPU_PROF_DIR) {
  const after = Number(process.env.PERF_CPU_PROF_AFTER_MS || 0);
  const span = Number(process.env.PERF_CPU_PROF_FOR_MS || 30_000);
  const { Session } = await import("node:inspector/promises");
  setTimeout(async () => {
    const session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 500 });
    await session.post("Profiler.start");
    setTimeout(async () => {
      const { profile } = await session.post("Profiler.stop");
      const name = `${process.env.PERF_PROC_NAME || process.pid}-${Date.now()}.cpuprofile`;
      fs.writeFileSync(`${process.env.PERF_CPU_PROF_DIR}/${name}`, JSON.stringify(profile));
      session.disconnect();
    }, span).unref();
  }, after).unref();
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
