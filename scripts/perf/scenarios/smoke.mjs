/**
 * Harness self-test (not a benchmark): a page, a BFF read and one chat turn each answer 2xx on the
 * production stack, with the per-hop log on. Small seed, one VU, a few requests.
 *   node scripts/perf/run.mjs smoke --runs 1
 */
import { browserRequest } from "../lib/requests.mjs";

export const defaults = { seedArgs: "--users 20 --rows 20 --hot-rows 500", concurrency: [1], duration: 3, warmup: 0 };
export const stack = { hopLog: true, procLog: true };

export async function run(ctx) {
  const assertClean = (name, m) => {
    if (m.failures > 0 || m.runs.some((r) => r.n === 0)) {
      throw new Error(`[smoke] ${name}: ${m.failures} failure(s), statuses ${JSON.stringify(m.statuses)}`);
    }
  };
  const user = 1;
  assertClean("page /", await ctx.measure("page / (anonymous)", {
    origin: ctx.webOrigin,
    concurrency: 1,
    maxRequests: 5,
    request: ({ vu }) => ({ ...browserRequest(null, vu, "GET", "/"), headers: { accept: "text/html" } }),
  }));
  assertClean("balance", await ctx.measure("GET /api/billing/balance (BFF)", {
    origin: ctx.webOrigin,
    concurrency: 1,
    maxRequests: 5,
    request: ({ vu }) => browserRequest(ctx.session(user), vu, "GET", "/api/billing/balance"),
  }));
  assertClean("chat", await ctx.measure("POST /api/chat (BFF, mock Gemini)", {
    origin: ctx.webOrigin,
    concurrency: 1,
    maxRequests: 3,
    request: ({ vu }) =>
      browserRequest(ctx.session(user), vu, "POST", "/api/chat", { messages: [{ role: "user", content: "What is benzene?" }] }),
  }));
}
