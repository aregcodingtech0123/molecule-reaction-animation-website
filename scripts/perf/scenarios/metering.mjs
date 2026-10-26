/**
 * Reserve → capture on Express directly (as the BFF calls it, with the internal key), timed as one unit:
 *  - hot user: ONE user, c parallel turns → advisory-lock contention (PERF-04);
 *  - many users: rotating users → reserve/capture throughput and pool use.
 * The BFF's per-user chat limit (10 / min) would stop a single user long before the database does, so
 * this bypasses the BFF on purpose. AI daily caps are raised for the run (recorded in the result).
 * A DB sampler records active backends, lock waits and ungranted advisory locks per run.
 *   node scripts/perf/run.mjs metering [--concurrency 1,2,5,10,20]
 */
import { randomUUID } from "node:crypto";
import { rotatingUser } from "../lib/requests.mjs";

export const defaults = { concurrency: [1, 2, 5, 10, 20], duration: 15, warmup: 3 };
export const stack = {
  hopLog: false,
  procLog: true,
  apiOverrides: { AI_DAILY_TURNS_PER_USER: "100000000", AI_DAILY_TURNS_GLOBAL: "100000000" },
};

function meteringFlow(ctx, pickUser) {
  const call = (token, path, body) => ({
    method: "POST",
    path: `/api/billing/${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-internal-service-key": ctx.internalKey,
    },
    body: JSON.stringify(body),
  });
  return async (it) => {
    const token = ctx.session(pickUser(it));
    const referenceId = randomUUID();
    const reserved = await it.send(call(token, "consume", { operationType: "AI_CHAT_QUERY", referenceId }));
    if (reserved.status !== 200) return;
    await it.send(call(token, "capture", { referenceId }));
  };
}

export async function run(ctx) {
  for (const c of ctx.opts.concurrency) {
    await ctx.measure(`hot user reserve+capture c=${c}`, {
      origin: ctx.apiOrigin,
      concurrency: c,
      flow: meteringFlow(ctx, () => 1),
      dbSampler: true,
    });
  }
  for (const c of ctx.opts.concurrency.filter((c) => c >= 5).concat([50, 100])) {
    const pick = rotatingUser(ctx.users.length, c);
    await ctx.measure(`many users reserve+capture c=${c}`, {
      origin: ctx.apiOrigin,
      concurrency: c,
      flow: meteringFlow(ctx, pick),
      dbSampler: true,
    });
  }
}
