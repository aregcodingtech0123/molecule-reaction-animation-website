/**
 * Local stand-in for the Gemini REST API (`POST /v1beta/models/{model}:generateContent`), reached only
 * through the perf preload's forward. Never contacts anything.
 *
 *   node scripts/perf/mock-gemini.mjs [--port 4290]
 *
 * Behaviour is set at runtime (no restart):
 *   POST /__config  { latency: {kind:"fixed",ms} | {kind:"uniform",min,max} | {kind:"lognormal",median,p95},
 *                     failureRate: 0..1, failureMode: "500"|"503"|"hang"|"empty"|"reset",
 *                     answerChars: number, seed: number }
 *   GET  /__stats   { served, failed, byMode, config }
 *   POST /__reset-stats
 * "hang" never answers (exercises GEMINI_TIMEOUT_MS); "empty" answers 200 with no text (→ 502 + release);
 * "reset" destroys the socket.
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import { latencySampler, seededRandom } from "./lib/random.mjs";
import { assertNetworkGuard } from "./lib/guard.mjs";

/** Sleep with sub-millisecond precision: a coarse timer until ~20 ms before, then setImmediate polling. */
export function preciseSleep(ms) {
  const due = performance.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      const left = due - performance.now();
      if (left <= 0) resolve();
      else if (left > 20) setTimeout(tick, left - 17);
      else setImmediate(tick);
    };
    tick();
  });
}

const DEFAULTS = { latency: { kind: "fixed", ms: 0 }, failureRate: 0, failureMode: "500", answerChars: 600, seed: 1 };

/**
 * @param {{ standalone?: boolean }} [options] `standalone` only for this file's own process (the stack's mock
 *   server, which makes no outbound calls). In-process use — an experiment next to the Gemini SDK — requires the
 *   network guard (PERF incident, Part 1).
 */
export function createMockGemini(options = {}) {
  if (!options.standalone) assertNetworkGuard("createMockGemini() in-process");
  let config = { ...DEFAULTS };
  let rand = seededRandom(config.seed);
  let failRand = seededRandom(config.seed ^ 0x9e3779b9);
  let sample = latencySampler(config.latency, rand);
  let stats = { served: 0, failed: 0, byMode: {} };
  const hanging = new Set();

  const apply = (next) => {
    config = { ...DEFAULTS, ...next };
    rand = seededRandom(config.seed);
    failRand = seededRandom(config.seed ^ 0x9e3779b9);
    sample = latencySampler(config.latency, rand);
  };

  const answer = (chars) => {
    const sentence = "Benzene (C6H6) is a planar aromatic ring with delocalised pi electrons. ";
    return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars).trim();
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    const json = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    if (req.url === "/__config" && req.method === "POST") {
      try {
        apply(JSON.parse(body || "{}"));
        return json(200, config);
      } catch (err) {
        return json(400, { error: String(err.message) });
      }
    }
    if (req.url === "/__config") return json(200, config);
    if (req.url === "/__stats") return json(200, { ...stats, config });
    if (req.url === "/__reset-stats" && req.method === "POST") {
      stats = { served: 0, failed: 0, byMode: {} };
      return json(200, stats);
    }
    if (req.method !== "POST" || !/:generateContent$/.test(req.url ?? "")) return json(404, { error: "not found" });

    const delay = sample();
    const fail = config.failureRate > 0 && failRand() < config.failureRate;
    // No timer for 0 ms, a precise wait otherwise: Windows timers fire in ~15.6 ms steps, which made a
    // "0 ms" mock answer after 1–15 ms and phase-locked single-user runs to the timer tick.
    if (delay > 0) await preciseSleep(delay);
    // The caller gave up (GEMINI_TIMEOUT_MS abort): nothing to answer. (req itself is always destroyed
    // once its body has been read, so check the socket.)
    if (req.socket.destroyed) return;

    if (fail) {
      stats.failed += 1;
      stats.byMode[config.failureMode] = (stats.byMode[config.failureMode] ?? 0) + 1;
      switch (config.failureMode) {
        case "hang":
          hanging.add(res);
          res.on("close", () => hanging.delete(res));
          return;
        case "reset":
          return req.socket.destroy();
        case "empty":
          return json(200, { candidates: [{ content: { role: "model", parts: [{ text: "" }] }, finishReason: "STOP" }] });
        default:
          return json(Number(config.failureMode) || 500, { error: { code: 500, message: "mock failure", status: "INTERNAL" } });
      }
    }

    stats.served += 1;
    json(200, {
      candidates: [{ content: { role: "model", parts: [{ text: answer(config.answerChars) }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 150, totalTokenCount: 200 },
    });
  });
  server.keepAliveTimeout = 65_000;

  return {
    server,
    configure: apply,
    close: () =>
      new Promise((resolve) => {
        for (const res of hanging) res.destroy();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--port");
  const port = Number(i > 0 ? process.argv[i + 1] : process.env.PERF_GEMINI_PORT || 4290);
  const { server } = createMockGemini({ standalone: true });
  server.listen(port, "127.0.0.1", () => console.log(`[mock-gemini] listening on 127.0.0.1:${port}`));
}
