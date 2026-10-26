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
 * @param {(ctx: {vu: number, iteration: number, send: (spec: object) => Promise<{status: number, body: string}>}) => Promise<void>} [o.flow]
 *   instead of `request`: several requests timed as one unit (e.g. reserve then capture)
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

  /** A flow: several requests measured as one unit; its status is the last non-2xx, else the last one's. */
  const runFlow = async (ctx) => {
    const start = performance.now();
    let status = 200;
    let error;
    let body = "";
    const send = async (spec) => {
      const r = await once(spec);
      if (r.error) error = r.error;
      if (status >= 200 && status < 300) status = r.status;
      body = r.body ?? "";
      return r;
    };
    await o.flow({ ...ctx, send });
    return { start, end: performance.now(), status, error, body };
  };

  const vu = async (index) => {
    for (let iteration = 0; ; iteration++) {
      if (performance.now() >= stopAt) return;
      if (o.maxRequests && measured >= o.maxRequests) return;
      let r;
      let id = null;
      if (o.flow) {
        r = await runFlow({ vu: index, iteration });
      } else {
        const spec = o.request({ vu: index, iteration });
        id = o.tag ? `${runId}-${index}-${iteration}` : null;
        if (id) spec.headers = { ...(spec.headers ?? {}), "x-perf-req": id };
        r = await once(spec);
      }
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

/**
 * Open-loop (fixed arrival rate) driver for Part 3: requests are *scheduled* at `ratePerSec` whatever the
 * server does, and each latency is measured from its scheduled start — so a stalled server shows up as
 * growing latency instead of fewer requests (no coordinated omission). Each arrival picks its request
 * from `pick(index)` → { kind, origin, spec }. Per kind: latency summary, statuses, errors.
 *
 * `maxInFlight` bounds client resources: an arrival that finds that many requests outstanding is recorded
 * as `dropped` (the server is not keeping up) rather than queued in the client. `timeoutMs` aborts a request
 * (recorded as status 0 / "timeout").
 *
 * @param {object} o
 * @param {number} o.ratePerSec
 * @param {number} o.durationMs   measured window
 * @param {number} [o.warmupMs]   discarded window before it (same rate)
 * @param {(i: number) => { kind: string, origin: string, spec: { method?: string, path: string, headers?: object, body?: string, then?: () => object | null } }} o.pick
 *   `then` (optional): the next request of the same arrival, sent after a 2xx answer (same origin)
 * @param {number} [o.maxInFlight]
 * @param {number} [o.timeoutMs]
 * @param {(r: { kind: string, status: number, error: string | null, scheduledAt: number, ms: number, measured: boolean }) => void} [o.onResult]
 *   called once per completed request (timelines around an injected fault)
 */
export async function runOpenLoop(o) {
  const maxInFlight = o.maxInFlight ?? 2000;
  const timeoutMs = o.timeoutMs ?? 30_000;
  const agents = new Map();
  const agentFor = (origin) => {
    if (!agents.has(origin)) agents.set(origin, new http.Agent({ keepAlive: true, maxSockets: maxInFlight }));
    return agents.get(origin);
  };
  const warmupMs = o.warmupMs ?? 0;
  const t0 = performance.now();
  const measureFrom = t0 + warmupMs;
  const stopAt = measureFrom + o.durationMs;
  const intervalMs = 1000 / o.ratePerSec;
  const byKind = new Map();
  const kind = (k) => {
    if (!byKind.has(k)) byKind.set(k, { latencies: [], statuses: {}, errors: {}, dropped: 0, n: 0 });
    return byKind.get(k);
  };
  let inFlight = 0;
  let maxSeenInFlight = 0;
  let scheduled = 0;
  const pending = new Set();

  const send = (k, origin, spec, scheduledAt, measured) => {
    const url = new URL(origin);
    inFlight += 1;
    maxSeenInFlight = Math.max(maxSeenInFlight, inFlight);
    const done = new Promise((resolve) => {
      const finish = (status, error) => {
        inFlight -= 1;
        if (measured) {
          const s = kind(k);
          s.n += 1;
          s.latencies.push(performance.now() - scheduledAt);
          s.statuses[status] = (s.statuses[status] ?? 0) + 1;
          if (error) s.errors[error] = (s.errors[error] ?? 0) + 1;
        }
        o.onResult?.({ kind: k, status, error: error ?? null, scheduledAt, ms: performance.now() - scheduledAt, measured });
        resolve();
      };
      const fire = (spec) => {
        const body = spec.body ?? null;
        const headers = { ...(spec.headers ?? {}) };
        if (body !== null) headers["content-length"] = Buffer.byteLength(body);
        const req = http.request(
          { agent: agentFor(origin), host: url.hostname, port: url.port, method: spec.method ?? "GET", path: spec.path, headers },
          (res) => {
            res.on("data", () => {});
            res.on("end", () => {
              // A follow-up request of the same arrival (reserve → capture); latency runs to its end.
              const next = res.statusCode >= 200 && res.statusCode < 300 ? spec.then?.() : null;
              if (next) fire(next);
              else finish(res.statusCode);
            });
            res.on("error", (err) => finish(0, err.code ?? err.message));
          },
        );
        req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timeout"), { code: "timeout" })));
        req.on("error", (err) => finish(0, err.code ?? err.message));
        if (body !== null) req.write(body);
        req.end();
      };
      fire(spec);
    });
    pending.add(done);
    done.then(() => pending.delete(done));
  };

  // Dispatch every arrival whose scheduled time has come (timers are coarse on Windows: catch up in batches).
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      // Half-open window [t0, stopAt): rate × duration arrivals exactly.
      while (t0 + scheduled * intervalMs <= now && t0 + scheduled * intervalMs < stopAt) {
        const scheduledAt = t0 + scheduled * intervalMs;
        const measured = scheduledAt >= measureFrom;
        const { kind: k, origin, spec } = o.pick(scheduled);
        scheduled += 1;
        if (inFlight >= maxInFlight) {
          if (measured) kind(k).dropped += 1;
          continue;
        }
        send(k, origin, spec, scheduledAt, measured);
      }
      if (now >= stopAt) resolve();
      else setTimeout(tick, 2);
    };
    tick();
  });
  await Promise.all(pending);
  for (const a of agents.values()) a.destroy();

  const kinds = {};
  let total = 0;
  let failed = 0;
  for (const [k, s] of byKind) {
    const ok = Object.entries(s.statuses).reduce((a, [st, n]) => a + (Number(st) >= 200 && Number(st) < 400 ? n : 0), 0);
    total += s.n + s.dropped;
    failed += s.n - ok + s.dropped;
    kinds[k] = { ...summarize(s.latencies), statuses: s.statuses, errors: s.errors, dropped: s.dropped, errorRatePct: s.n + s.dropped ? Number((((s.n - ok + s.dropped) / (s.n + s.dropped)) * 100).toFixed(2)) : 0 };
  }
  return {
    ratePerSec: o.ratePerSec,
    achievedPerSec: Number(((total / o.durationMs) * 1000).toFixed(1)),
    total,
    errorRatePct: total ? Number(((failed / total) * 100).toFixed(2)) : 0,
    maxInFlight: maxSeenInFlight,
    kinds,
    windowStart: Date.now() - (performance.now() - measureFrom),
    windowEnd: Date.now() - (performance.now() - stopAt),
  };
}
