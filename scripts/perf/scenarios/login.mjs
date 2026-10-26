/**
 * Password login through the BFF at bcrypt cost 10 (the production default and SEC-08 floor), c = 1 / 4 / 16
 * (PERF-20). bcrypt runs on the libuv pool (4 threads by default), so the questions are queueing above 4
 * concurrent logins and whether the Express event loop stays responsive (procLog: lag p99, ELU).
 * Every attempt comes from its own client IP (as many distinct users would), so the login limiter
 * (5 per IP and email / 15 min) never answers: this measures the bcrypt path, not the limiter. PERF_UV_THREADPOOL_SIZE sets UV_THREADPOOL_SIZE on Express (comparison
 * only, recorded).
 *   node scripts/perf/run.mjs login
 */
import { PERF_PASSWORD } from "../config.mjs";
import { browserRequest, rotatingUser } from "../lib/requests.mjs";

const pool = process.env.PERF_UV_THREADPOOL_SIZE;

export const defaults = { concurrency: [1, 4, 16], duration: 15, warmup: 3 };
export const stack = { hopLog: false, procLog: true, apiOverrides: pool ? { UV_THREADPOOL_SIZE: pool } : {} };

export async function run(ctx) {
  ctx.note(`UV_THREADPOOL_SIZE on Express: ${pool ?? "default (4)"}`);
  for (const c of ctx.opts.concurrency) {
    const pick = rotatingUser(ctx.users.length, c);
    await ctx.measure(`login c=${c}`, {
      origin: ctx.webOrigin,
      concurrency: c,
      request: (it) =>
        browserRequest(null, it.iteration * c + it.vu, "POST", "/api/auth/login", { email: ctx.users[pick(it)].email, password: PERF_PASSWORD }),
    });
  }
}
