/**
 * Dependency-free closed-loop HTTP load driver (no container, no download).
 *
 * `concurrency` virtual users each send a request, wait for the full response body, and send the
 * next one, for `durationMs` after a `warmupMs` whose samples are discarded. Latency is measured
 * from just before the request is written to the end of the response body, on keep-alive sockets
 * (one per virtual user), as a browser or a platform proxy would hold them.
 *
 * Closed-loop drivers under-report tail latency when the server stalls (coordinated omission): a
 * stalled VU sends nothing while it waits. Use it for per-request cost and throughput at a given
 * concurrency; the Part 3 ramp/soak adds an open-loop (fixed arrival rate) mode.
 */
import http from "node:http";
import { performance } from "node:perf_hooks";
import { summarize } from "./stats.mjs";

/**
 * @param {object} o
 * @param {string} o.origin  e.g. http://localhost:3200
 * @param {number} o.concurrency
 * @param {number} o.durationMs  measured window
 * @param {number} [o.warmupMs]  discarded window before it
 * @param {(ctx: {vu: number, iteration: number}) => {method?: string, path: string, headers?: object, body?: string}} o.request
 * @param {(status: number, body: string) => boolean} [o.isOk]  default: 2xx
 * @param {number} [o.maxRequests]  stop early after this many measured requests
 * @param {boolean} [o.tag]  send `x-perf-req: <id>` and return each measured request's {id, ms, status}
 */
export async function runClosedLoop(o) {
  const url = new URL(o.origin);
  const agent = new http.Agent({ keepAlive: true, maxSockets: o.concurrency });
  const isOk = o.isOk ?? ((status) => status >= 200 && status < 300);
  const warmupMs = o.warmupMs ?? 0;
  const t0 = performance.now();
  const measureFrom = t0 + warmupMs;
  const stopAt = measureFrom + o.durationMs;
  const latencies = [];
  const statuses = {};
  const errors = {};
  let failures = 0;
  let measured = 0;
  let firstMeasuredAt = null;
  let lastMeasuredAt = null;
  const tagged = [];
  const runId = Math.random().toString(36).slice(2, 8);

  const once = (spec) =>
    new Promise((resolve) => {
      const body = spec.body ?? null;
      const headers = { ...(spec.headers ?? {}) };
      if (body !== null) headers["content-length"] = Buffer.byteLength(body);
      const start = performance.now();
      const req = http.request(
        { agent, host: url.hostname, port: url.port, method: spec.method ?? "GET", path: spec.path, headers },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ start, end: performance.now(), status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", (err) => resolve({ start, end: performance.now(), status: 0, error: err.code ?? err.message }));
        },
      );
      req.on("error", (err) => resolve({ start, end: performance.now(), status: 0, error: err.code ?? err.message }));
      if (body !== null) req.write(body);
      req.end();
    });

  const vu = async (index) => {
    for (let iteration = 0; ; iteration++) {
      if (performance.now() >= stopAt) return;
      if (o.maxRequests && measured >= o.maxRequests) return;
      const spec = o.request({ vu: index, iteration });
      const id = o.tag ? `${runId}-${index}-${iteration}` : null;
      if (id) spec.headers = { ...(spec.headers ?? {}), "x-perf-req": id };
      const r = await once(spec);
      if (r.start < measureFrom || r.end > stopAt) continue;
      measured += 1;
      firstMeasuredAt ??= r.start;
      lastMeasuredAt = r.end;
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
      if (r.status === 0 || !isOk(r.status, r.body)) failures += 1;
      latencies.push(r.end - r.start);
      if (id) tagged.push({ id, ms: r.end - r.start, status: r.status });
    }
  };

  await Promise.all(Array.from({ length: o.concurrency }, (_, i) => vu(i)));
  agent.destroy();
  const windowMs = firstMeasuredAt === null ? 0 : lastMeasuredAt - firstMeasuredAt;
  return {
    ...summarize(latencies),
    rps: windowMs > 0 ? Number(((measured / windowMs) * 1000).toFixed(2)) : null,
    failures,
    statuses,
    errors,
    concurrency: o.concurrency,
    tagged: o.tag ? tagged : undefined,
    windowStart: Date.now() - (performance.now() - (firstMeasuredAt ?? performance.now())),
    windowEnd: Date.now() - (performance.now() - (lastMeasuredAt ?? performance.now())),
  };
}
