/**
 * Cross-check of the in-repo load driver against autocannon 8 (dev dependency) on the same endpoints,
 * concurrency, duration and request shapes, alternating tool by run so drift affects both alike.
 * Both report p50 / p90 / p99 / req/s (autocannon has no p95). autocannon keeps latencies as whole
 * milliseconds; the in-repo driver keeps fractions — compare accordingly. Discrepancies are reported,
 * not resolved by picking one.
 *   node scripts/perf/run.mjs crosscheck [--runs 5]
 */
import autocannon from "autocannon";
import { runClosedLoop } from "../lib/load.mjs";
import { acrossRuns } from "../lib/stats.mjs";
import { apiRequest, browserRequest, rotatingUser } from "../lib/requests.mjs";

export const defaults = { concurrency: [10], duration: 15, warmup: 3, seedArgs: "--users 5000 --rows 20", gemini: "fixed:0" };
export const stack = { hopLog: false, procLog: true, apiOverrides: { AI_DAILY_TURNS_GLOBAL: "100000000" } };

function runAutocannon({ origin, concurrency, durationS, warmupS, request }) {
  let i = 0;
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: origin,
        connections: concurrency,
        duration: durationS,
        warmup: warmupS > 0 ? { connections: concurrency, duration: warmupS } : undefined,
        requests: [
          {
            setupRequest: (req) => {
              const n = i++;
              const spec = request({ vu: n % concurrency, iteration: Math.floor(n / concurrency) });
              return { ...req, method: spec.method ?? "GET", path: spec.path, headers: spec.headers ?? {}, body: spec.body };
            },
          },
        ],
      },
      (err, res) => (err ? reject(err) : resolve(res)),
    );
  });
}

export async function run(ctx) {
  const c = ctx.opts.concurrency[0];
  const pick = rotatingUser(ctx.users.length, c);
  const targets = [
    ["balance via BFF", ctx.webOrigin, (it) => browserRequest(ctx.session(pick(it)), it.vu, "GET", "/api/billing/balance")],
    ["balance on Express", ctx.apiOrigin, (it) => apiRequest(ctx.session(pick(it)), "GET", "/api/billing/balance")],
    [
      "chat turn via BFF (Gemini mock 0 ms)",
      ctx.webOrigin,
      (it) => browserRequest(ctx.session(pick(it)), it.vu, "POST", "/api/chat", { messages: [{ role: "user", content: "Hi" }] }),
    ],
  ];
  const out = {};
  for (const [name, origin, request] of targets) {
    const ours = [];
    const theirs = [];
    for (let r = 0; r < ctx.opts.runs; r++) {
      const a = await runClosedLoop({ origin, concurrency: c, durationMs: ctx.opts.durationMs, warmupMs: ctx.opts.warmupMs, request });
      ours.push({ p50: a.p50, p90: a.p90, p99: a.p99, rps: a.rps, non2xx: a.failures });
      const b = await runAutocannon({ origin, concurrency: c, durationS: ctx.opts.durationMs / 1000, warmupS: ctx.opts.warmupMs / 1000, request });
      theirs.push({ p50: b.latency.p50, p90: b.latency.p90, p99: b.latency.p99, rps: b.requests.average, non2xx: b.non2xx + b.errors + b.timeouts });
      console.log(`[crosscheck] ${name} run ${r + 1}: in-repo p50 ${a.p50} p90 ${a.p90} p99 ${a.p99} ${a.rps}/s | autocannon p50 ${b.latency.p50} p90 ${b.latency.p90} p99 ${b.latency.p99} ${b.requests.average}/s`);
    }
    const keys = ["p50", "p90", "p99", "rps"];
    const A = acrossRuns(ours, keys);
    const B = acrossRuns(theirs, keys);
    out[name] = {
      inRepo: A,
      autocannon: B,
      non2xx: { inRepo: ours.reduce((s, x) => s + x.non2xx, 0), autocannon: theirs.reduce((s, x) => s + x.non2xx, 0) },
      // Ratio of medians (autocannon / in-repo); 1.00 = identical.
      ratio: Object.fromEntries(keys.map((k) => [k, A[k] && B[k] ? Number((B[k].median / A[k].median).toFixed(2)) : null])),
    };
  }
  ctx.record("crosscheck", out);
}
