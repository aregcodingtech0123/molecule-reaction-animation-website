/**
 * Daily-cap boundary with PRODUCTION caps (200 per user, 3 000 global per rolling 24 h; SEC-16), through
 * the BFF, in an order where each check sees exactly the window it needs:
 *  1. per-user: a user at 199 turns → turn 200 served, turn 201 → 429 AI_DAILY_LIMIT + Retry-After;
 *  2. global: the window topped up to 2 999 → the next turn served, the one after → 503 AI_CAPACITY_REACHED;
 *  3. cost of the 503 refusal path under load (c = 10, rotating users);
 *  4. cost of the 429 refusal path under load (1 000 users put at their cap; the per-user check runs first).
 * Past turns are inserted as released holds (they count toward both caps, were never charged, have no
 * ledger rows). 5 000 users keep every user under the BFF's own limit of 10 turns / min.
 *   node scripts/perf/run.mjs caps
 */
import path from "node:path";
import { createRequire } from "node:module";
import { perfDatabaseUrl, serviceRoot } from "../config.mjs";
import { assertTestDatabaseUrl } from "../../test/db-guard.mjs";
import { browserRequest } from "../lib/requests.mjs";

const pg = createRequire(path.join(serviceRoot, "package.json"))("pg");

// 48 h spacing: regular users have no turn in the last 24 h, so the window starts at ~260 (the hot user).
export const defaults = { seedArgs: "--users 5000 --rows 20 --spacing-min 2880", concurrency: [10], duration: 10, warmup: 2 };
export const stack = { hopLog: false, procLog: true };

// Enough users that no one exceeds the BFF limit (10 turns / min) across the warm-up and 5 runs.
const CAPPED = { from: 10, count: 1000 }; // users put at their per-user cap for step 4
const FREE_FROM = 1500; // users for global-cap traffic (never capped individually)

async function withDb(fn) {
  const url = perfDatabaseUrl();
  assertTestDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function addPastTurns(client, userIds, perUser) {
  if (perUser <= 0 || userIds.length === 0) return;
  await client.query(
    `INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, status, created_at, expires_at, settled_at, settle_reason)
     SELECT u, 'perf-cap-' || gen_random_uuid(), 'AI_CHAT_QUERY', 1, 'released',
            NOW() - interval '1 hour', NOW() - interval '50 minutes', NOW() - interval '50 minutes', 'perf_seed'
     FROM unnest($1::uuid[]) AS u, generate_series(1, $2::int)`,
    [userIds, perUser],
  );
}

const windowCount = (c, userId) =>
  c
    .query(
      `SELECT count(*)::int AS n FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours'${userId ? " AND user_id = $1" : ""}`,
      userId ? [userId] : [],
    )
    .then((r) => r.rows[0].n);

const chatBody = { messages: [{ role: "user", content: "Hi" }] };

export async function run(ctx) {
  const turn = (userIndex, vu = 0) =>
    fetch(`${ctx.webOrigin}/api/chat`, browserRequest(ctx.session(userIndex), vu, "POST", "/api/chat", chatBody)).then(async (r) => ({
      status: r.status,
      retryAfter: r.headers.get("retry-after"),
      body: await r.json(),
    }));
  const checks = [];
  const check = (name, ok, got) => {
    checks.push({ name, ok, got });
    console.log(`[caps] ${ok ? "ok  " : "FAIL"} ${name}`);
  };

  // 1. Per-user boundary.
  const user = ctx.users[2];
  await withDb(async (c) => addPastTurns(c, [user.id], 199 - (await windowCount(c, user.id))));
  const t200 = await turn(2);
  check("per-user turn 200 is served", t200.status === 200, t200.status);
  const t201 = await turn(2);
  check("per-user turn 201 → 429 AI_DAILY_LIMIT with Retry-After", t201.status === 429 && t201.body.error === "AI_DAILY_LIMIT" && Number(t201.retryAfter) > 0, t201);

  // 2. Global boundary: 2 999 in the window, one turn each from fresh users.
  const before = await withDb((c) => windowCount(c));
  ctx.note(`turns in the window before the global check: ${before}`);
  if (before > 2999) throw new Error("[caps] the seeded window already exceeds 2 999 — use a smaller seed");
  await withDb((c) => addPastTurns(c, ctx.users.slice(300, 300 + (2999 - before)).map((u) => u.id), 1));
  const g3000 = await turn(FREE_FROM);
  check("global turn 3 000 is served", g3000.status === 200, g3000.status);
  const g3001 = await turn(FREE_FROM + 1);
  check("global turn 3 001 → 503 AI_CAPACITY_REACHED", g3001.status === 503 && g3001.body.error === "AI_CAPACITY_REACHED", g3001);

  // 3. Global refusal under load.
  const free = ctx.users.length - FREE_FROM - 2;
  await ctx.measure("global cap refusal (503) c=10", {
    origin: ctx.webOrigin,
    concurrency: 10,
    maxRequests: 2000,
    isOk: (status) => status === 503,
    request: (it) => browserRequest(ctx.session(FREE_FROM + 2 + ((it.iteration * 10 + it.vu) % free)), it.vu, "POST", "/api/chat", chatBody),
  });

  // 4. Per-user refusal under load (the per-user check runs before the global one).
  await withDb((c) => addPastTurns(c, ctx.users.slice(CAPPED.from, CAPPED.from + CAPPED.count).map((u) => u.id), 200));
  await ctx.measure("per-user cap refusal (429) c=10", {
    origin: ctx.webOrigin,
    concurrency: 10,
    maxRequests: 600,
    isOk: (status, body) => status === 429 && body.includes("AI_DAILY_LIMIT"),
    request: (it) => browserRequest(ctx.session(CAPPED.from + ((it.iteration * 10 + it.vu) % CAPPED.count)), it.vu, "POST", "/api/chat", chatBody),
  });

  ctx.record("checks", checks);
  if (checks.some((c) => !c.ok)) throw new Error(`[caps] ${checks.filter((c) => !c.ok).length} boundary check(s) failed`);
}
