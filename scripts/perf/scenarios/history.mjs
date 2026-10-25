/**
 * Ledger history (dashboard table, cursor pagination) for the hot user (user 0, --hot-rows rows) and a
 * regular user: first page, a mid page and the last page, through the BFF with the UI's default limit.
 * Cursors are collected once by walking the pages before measuring.
 *   node scripts/perf/run.mjs history [--seed-args "--hot-rows 1000000"]
 */
import { browserRequest } from "../lib/requests.mjs";

export const defaults = { concurrency: [1, 10], duration: 20, warmup: 5 };
export const stack = { hopLog: false, procLog: true };

async function walkCursors(ctx, userIndex) {
  const cursors = [null];
  for (;;) {
    const cursor = cursors.at(-1);
    const path = cursor ? `/api/billing/history?${new URLSearchParams({ cursor })}` : "/api/billing/history";
    const req = browserRequest(ctx.session(userIndex), 0, "GET", path);
    const res = await fetch(`${ctx.webOrigin}${path}`, { headers: req.headers });
    if (!res.ok) throw new Error(`[history] walk failed at page ${cursors.length}: HTTP ${res.status}`);
    const body = await res.json();
    if (!body.data?.nextCursor) return cursors;
    cursors.push(body.data.nextCursor);
  }
}

export async function run(ctx) {
  const targets = [
    ["hot user", 0],
    ["regular user", 1],
  ];
  for (const [label, userIndex] of targets) {
    const cursors = await walkCursors(ctx, userIndex);
    ctx.note(`${label}: ${cursors.length} page(s) at the default limit`);
    const pages = [...new Set([0, Math.floor(cursors.length / 2), cursors.length - 1])];
    for (const page of pages) {
      const cursor = cursors[page];
      const path = cursor ? `/api/billing/history?${new URLSearchParams({ cursor })}` : "/api/billing/history";
      for (const c of ctx.opts.concurrency) {
        await ctx.measure(`history ${label} page ${page + 1}/${cursors.length} c=${c}`, {
          origin: ctx.webOrigin,
          concurrency: c,
          request: ({ vu }) => browserRequest(ctx.session(userIndex), vu, "GET", path),
        });
      }
    }
  }
}
