/**
 * Sustained mixed traffic for memory and event-loop behaviour (PERF-14/18/19): one long closed-loop run
 * (default 10 min) where each VU iteration picks chat (Gemini lognormal 300/1200 ms), balance or history
 * by a fixed weight, with the process log on. The result keeps the per-minute heap trough (heap after GC
 * shows retained memory; peaks are just garbage waiting to be collected) for both servers, so retained
 * growth can be told apart from lazy GC.
 *   node scripts/perf/run.mjs soak --runs 1 [--duration 600] [--concurrency 20]
 */
import { browserRequest, rotatingUser } from "../lib/requests.mjs";

export const defaults = { seedArgs: "--users 5000 --rows 20", concurrency: [20], duration: 600, warmup: 30, gemini: "lognormal:300:1200" };
export const stack = { hopLog: false, procLog: true, apiOverrides: { AI_DAILY_TURNS_GLOBAL: "100000000" } };

export async function run(ctx) {
  const c = ctx.opts.concurrency[0];
  const pick = rotatingUser(ctx.users.length, c);
  // Of every 10 iterations: 2 chat, 6 balance, 2 history — chat keeps per-user turns well under 10 / min.
  const kinds = ["chat", "balance", "balance", "history", "balance", "chat", "balance", "balance", "history", "balance"];
  await ctx.measure(`mixed soak c=${c}`, {
    origin: ctx.webOrigin,
    concurrency: c,
    request: (it) => {
      const token = ctx.session(pick(it));
      switch (kinds[(it.iteration + it.vu) % kinds.length]) {
        case "chat":
          return browserRequest(token, it.vu, "POST", "/api/chat", { messages: [{ role: "user", content: "What is a covalent bond?" }] });
        case "history":
          return browserRequest(token, it.vu, "GET", "/api/billing/history");
        default:
          return browserRequest(token, it.vu, "GET", "/api/billing/balance");
      }
    },
  });
  ctx.wantHeapTrend = true;
}
