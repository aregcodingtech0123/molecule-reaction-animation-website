/**
 * Balance read (the dashboard header and the post-checkout poll): through the BFF as the browser calls
 * it, and directly against Express to isolate the BFF hop. Users rotate; each VU has its own IP.
 *   node scripts/perf/run.mjs balance [--concurrency 1,10,50]
 */
import { apiRequest, browserRequest, rotatingUser } from "../lib/requests.mjs";

export const defaults = { concurrency: [1, 10, 50], duration: 20, warmup: 5 };
export const stack = { hopLog: false, procLog: true };

export async function run(ctx) {
  for (const c of ctx.opts.concurrency) {
    const pick = rotatingUser(ctx.users.length, c);
    await ctx.measure(`balance BFF c=${c}`, {
      origin: ctx.webOrigin,
      concurrency: c,
      request: (it) => browserRequest(ctx.session(pick(it)), it.vu, "GET", "/api/billing/balance"),
    });
    await ctx.measure(`balance Express c=${c}`, {
      origin: ctx.apiOrigin,
      concurrency: c,
      request: (it) => apiRequest(ctx.session(pick(it)), "GET", "/api/billing/balance"),
    });
  }
}
