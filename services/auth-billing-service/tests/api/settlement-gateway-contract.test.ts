/**
 * Phase 2C step 4: the HTTP contract around the capability that settlement-capability.test.ts does not pin. Real routes over
 * real HTTP (supertest listens on a real socket) against the real test database.
 *
 * Log checks use util.inspect over the raw console arguments: JSON.stringify would drop an Error's message and stack.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, waitFor } from "../support/db";
import { CAPABILITY_FIELD, claimsOf, mintForRow } from "../support/settlement";

const app = createApp();
let db: pg.Pool;
let logs: ConsoleSpies;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await closePool();
});
beforeEach(() => {
  logs = spyConsole();
});

type U = { id: string; email: string };
type Route = "/capture" | "/refund";
const ROUTES: Route[] = ["/capture", "/refund"];
const NOT_AUTHORIZED = { success: false, error: "Settlement not authorized.", code: "SETTLEMENT_NOT_AUTHORIZED" };
const NOT_FOUND = { success: false, error: "Route not found." };

const everythingLogged = () => inspect([logs.log.mock.calls, logs.warn.mock.calls, logs.error.mock.calls], { depth: 10, breakLength: Infinity, maxStringLength: null, maxArrayLength: null });

async function fundedUser(balance = 10): Promise<U> {
  const u = await createUser(db, { balance: 0, verified: true });
  if (balance > 0) await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, balance]);
  return u;
}

function post(path: string, body: unknown, opts: { key?: string | null; authorization?: string; query?: string; headers?: Record<string, string> } = {}) {
  let req = request(app).post(`/api/billing${path}${opts.query ?? ""}`);
  const key = opts.key === undefined ? TEST_ENV.INTERNAL_SERVICE_SECRET : opts.key;
  if (key !== null) req = req.set("X-Internal-Service-Key", key);
  if (opts.authorization) req = req.set("Authorization", opts.authorization);
  for (const [name, value] of Object.entries(opts.headers ?? {})) req = req.set(name, value);
  return body === undefined ? req : req.send(body as object);
}

async function reserve(u: U, operationType = "AI_CHAT_QUERY") {
  const referenceId = randomUUID();
  const res = await post("/consume", { operationType, referenceId }, { authorization: bearer(u) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { res, referenceId, captureToken: res.body.data.captureCapabilityToken as string, refundToken: res.body.data.refundCapabilityToken as string };
}
const tokenFor = (route: Route, r: { captureToken: string; refundToken: string }) => (route === "/capture" ? r.captureToken : r.refundToken);

async function holdOf(u: U, referenceId: string) {
  const { rows } = await db.query(`SELECT status, amount, ledger_id::text, settled_at, settle_reason, expires_at FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`, [u.id, referenceId]);
  return rows[0] ?? null;
}
const debits = async (u: U, referenceId: string) => (await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION" && r.reference_id === referenceId);

/** Move a hold into the past, so a token minted for the row afterwards has a past `rexp` too. */
async function ageHold(u: U, referenceId: string, secondsAgo: number) {
  await db.query(`UPDATE ai_credit_holds SET created_at = NOW() - interval '2 days', expires_at = NOW() - make_interval(secs => $3) WHERE user_id = $1 AND reference_id = $2`, [u.id, referenceId, secondsAgo]);
}

/**
 * The first capture of a hold that has just expired. Parallel suites call the global release_expired_ai_holds(), so a hold aged
 * in the open could be settled by them before the capture sees it. Here the row only looks expired once this transaction commits,
 * and by then the capture is already first in the queue for the row's lock.
 */
async function firstCaptureOfJustExpiredHold(u: U, referenceId: string) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const pid = (await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number;
    await c.query("BEGIN");
    await c.query(`UPDATE ai_credit_holds SET created_at = NOW() - interval '2 days', expires_at = NOW() - interval '1 second' WHERE user_id = $1 AND reference_id = $2`, [u.id, referenceId]);
    const token = await mintForRow(c as unknown as pg.Pool, "capture", u.id, referenceId);
    const inflight = post("/capture", { referenceId, [CAPABILITY_FIELD]: token }).then((r) => r);
    await waitFor(async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [pid])).rows[0]!.n >= 1);
    await c.query("COMMIT");
    return { first: await inflight, token };
  } finally {
    await c.end();
  }
}

async function withEnv<T>(vars: Record<string, string>, work: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await work();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("/consume: where the capabilities are, and where they are not", () => {
  it("exactly two tokens, at data.captureCapabilityToken and data.refundCapabilityToken, in nothing but the body", async () => {
    const u = await fundedUser();
    const { res, referenceId, captureToken, refundToken } = await reserve(u);

    expect(Object.keys(res.body).sort()).toEqual(["data", "success"]);
    expect(Object.keys(res.body.data).sort()).toEqual(["alreadyProcessed", "balance", "captureCapabilityToken", "cost", "expiresAt", "ledgerId", "operationType", "refundCapabilityToken", "status"]);
    expect(res.text.match(/msc1\./g)).toHaveLength(2);
    expect(JSON.stringify(res.headers)).not.toContain("msc1.");

    expect(claimsOf(captureToken)).toMatchObject({ pur: "capture", sub: u.id, ref: referenceId, amt: 1 });
    expect(claimsOf(refundToken)).toMatchObject({ pur: "refund", sub: u.id, ref: referenceId, amt: 1 });
    expect(everythingLogged()).not.toContain("msc1.");
  });

  it("the token's user and reference come from the row, not from anything else in the request", async () => {
    const u = await fundedUser();
    const stranger = await fundedUser();
    const referenceId = randomUUID();
    const res = await post("/consume", { operationType: "AI_CHAT_QUERY", referenceId: `  ${referenceId}  `, userId: stranger.id, amount: 99 }, { authorization: bearer(u) });
    expect(res.status).toBe(200);
    expect(claimsOf(res.body.data.captureCapabilityToken)).toMatchObject({ sub: u.id, ref: referenceId, amt: 1 });
  });
});

describe.each(ROUTES)("the internal key comes first on %s", (route) => {
  it.each<[string, string | null]>([
    ["missing", null],
    ["wrong", "wrong-key-0123456789-abcdefghijklmnopqrstuv"],
    ["a capability", "msc1.abc.def"],
    ["the user's session JWT", "Bearer not-the-key"],
  ])("key %s: 404 for a valid and an invalid capability alike, so the route's existence and the token's validity are not revealed", async (_label, key) => {
    const u = await fundedUser();
    const r = await reserve(u);
    for (const token of [tokenFor(route, r), "not-a-token"]) {
      const res = await post(route, { referenceId: r.referenceId, [CAPABILITY_FIELD]: token }, { key });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    expect(await holdOf(u, r.referenceId)).toMatchObject({ status: "held" });
    expect(everythingLogged()).not.toContain("SETTLEMENT_AUTH_REJECTED");
    expect(everythingLogged()).not.toContain(tokenFor(route, r));
  });

  it("an unconfigured internal secret: 404, even for an empty key and a valid capability", async () => {
    const u = await fundedUser();
    const r = await reserve(u);
    await withEnv({ INTERNAL_SERVICE_SECRET: "" }, async () => {
      for (const key of [null, "", "anything"]) {
        const res = await post(route, { referenceId: r.referenceId, [CAPABILITY_FIELD]: tokenFor(route, r) }, { key });
        expect(res.status).toBe(404);
      }
    });
    expect(await holdOf(u, r.referenceId)).toMatchObject({ status: "held" });
  });
});

describe.each(ROUTES)("the capability is read from the JSON body only, on %s", (route) => {
  it.each<[string, (token: string) => Parameters<typeof post>[2]]>([
    ["a query parameter", (t) => ({ query: `?${CAPABILITY_FIELD}=${t}` })],
    ["a custom header", (t) => ({ headers: { "X-Settlement-Capability": t, [CAPABILITY_FIELD]: t } })],
    ["the Authorization header", (t) => ({ authorization: `Bearer ${t}` })],
  ])("in %s it authorises nothing: the legacy path answers 401", async (_label, where) => {
    const u = await fundedUser();
    const r = await reserve(u);
    const res = await post(route, { referenceId: r.referenceId }, where(tokenFor(route, r)));
    expect(res.status).toBe(401);
    expect(await holdOf(u, r.referenceId)).toMatchObject({ status: "held" });
    expect(everythingLogged()).not.toContain(tokenFor(route, r));
  });

  it("a query string on a refused request stays out of the rejection log", async () => {
    const u = await fundedUser();
    const r = await reserve(u);
    const res = await post(route, { referenceId: r.referenceId, [CAPABILITY_FIELD]: "junk" }, { query: `?leak=${tokenFor(route, r)}` });
    expect(res.status).toBe(403);
    expect(everythingLogged()).toContain("SETTLEMENT_AUTH_REJECTED");
    expect(everythingLogged()).toContain(`path: '/api/billing${route}'`);
    expect(everythingLogged()).not.toContain(tokenFor(route, r));
    const unkeyed = await post(route, { referenceId: r.referenceId }, { key: null, query: `?leak=${tokenFor(route, r)}` });
    expect(unkeyed.status).toBe(404);
    expect(everythingLogged()).not.toContain(tokenFor(route, r));
  });
});

describe.each(ROUTES)("the reference in the body, on %s", (route) => {
  it.each<[string, Record<string, unknown>]>([
    ["missing", {}],
    ["null", { referenceId: null }],
    ["a number", { referenceId: 42 }],
    ["an array", { referenceId: ["x"] }],
    ["an object", { referenceId: {} }],
    ["empty", { referenceId: "" }],
    ["whitespace", { referenceId: "   " }],
  ])("%s: a genuine token is refused, because it does not take the place of the request's own statement", async (_label, reference) => {
    const u = await fundedUser();
    const r = await reserve(u);
    const res = await post(route, { ...reference, [CAPABILITY_FIELD]: tokenFor(route, r) });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_AUTHORIZED);
    expect(await holdOf(u, r.referenceId)).toMatchObject({ status: "held" });
  });

  it("surrounding whitespace is trimmed, as on the legacy path", async () => {
    const u = await fundedUser();
    const r = await reserve(u);
    const res = await post(route, { referenceId: `  ${r.referenceId} `, [CAPABILITY_FIELD]: tokenFor(route, r) });
    expect(res.status).toBe(200);
  });
});

describe.each(ROUTES)("request bodies that never reach the capability check, on %s", (route) => {
  it("malformed JSON around a token: 400, the token is neither echoed nor logged, nothing changes", async () => {
    const u = await fundedUser();
    const r = await reserve(u);
    const token = tokenFor(route, r);
    const res = await post(route, undefined, { headers: { "Content-Type": "application/json" } }).send(`{"${CAPABILITY_FIELD}":"${token}",`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: "Malformed JSON body.", code: "INVALID_JSON" });
    expect(res.text).not.toContain(token);
    expect(everythingLogged()).not.toContain(token);
    expect(await holdOf(u, r.referenceId)).toMatchObject({ status: "held" });
  });

  it("a body over the 32 kB limit: 413, the token is neither echoed nor logged, nothing changes", async () => {
    const u = await fundedUser();
    const r = await reserve(u);
    const token = tokenFor(route, r);
    const res = await post(route, { referenceId: r.referenceId, [CAPABILITY_FIELD]: token, padding: "x".repeat(40_000) });
    expect(res.status).toBe(413);
    expect(res.text).not.toContain(token);
    expect(everythingLogged()).not.toContain(token);
    expect(await holdOf(u, r.referenceId)).toMatchObject({ status: "held" });
  });

  it("a token far over its own size limit but inside the body limit: the uniform 403", async () => {
    const u = await fundedUser();
    const r = await reserve(u);
    const res = await post(route, { referenceId: r.referenceId, [CAPABILITY_FIELD]: `${tokenFor(route, r)}${"A".repeat(20_000)}` });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_AUTHORIZED);
  });
});

describe("repeating a capture whose first answer was a refusal", () => {
  it("HOLD_EXPIRED, then NOT_CAPTURABLE on every repeat, with the row unchanged after the first and no debit", async () => {
    const u = await fundedUser();
    const { referenceId } = await reserve(u);
    const { first, token } = await firstCaptureOfJustExpiredHold(u, referenceId);
    const body = { referenceId, [CAPABILITY_FIELD]: token };

    expect(first.status).toBe(409);
    expect(first.body.code).toBe("HOLD_EXPIRED");
    const settled = await holdOf(u, referenceId);
    expect(settled).toMatchObject({ status: "expired", settle_reason: "capture_after_expiry" });

    for (let i = 0; i < 3; i++) {
      const again = await post("/capture", body);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: "NOT_CAPTURABLE", status: "expired" });
    }
    expect(await holdOf(u, referenceId)).toEqual(settled);
    expect(await debits(u, referenceId)).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(10);
  });

  it("CAPTURE_FAILED, then NOT_CAPTURABLE on every repeat, and no debit even once the credits are back", async () => {
    const u = await fundedUser(5);
    const { referenceId, captureToken } = await reserve(u, "ARCH_RENDER_STD");
    await db.query(`SELECT post_credit_transaction($1, -5, 'ADMIN_ADJUSTMENT', 'drain')`, [u.id]);
    const body = { referenceId, [CAPABILITY_FIELD]: captureToken };

    expect((await post("/capture", body)).body.code).toBe("CAPTURE_FAILED");
    const settled = await holdOf(u, referenceId);
    await db.query(`SELECT post_credit_transaction($1, 5, 'ADMIN_ADJUSTMENT', 'topup')`, [u.id]);

    for (let i = 0; i < 3; i++) {
      const again = await post("/capture", body);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: "NOT_CAPTURABLE", status: "capture_failed" });
    }
    expect(await holdOf(u, referenceId)).toEqual(settled);
    expect(await debits(u, referenceId)).toEqual([]);
  });
});

describe("every terminal refund outcome is stable: three repeats, the same answer, the same row", () => {
  async function expectStable(u: U, referenceId: string, token: string, outcome: string) {
    const answers: unknown[] = [];
    const before = await holdOf(u, referenceId);
    for (let i = 0; i < 3; i++) {
      const res = await post("/refund", { referenceId, [CAPABILITY_FIELD]: token });
      expect(res.status).toBe(200);
      answers.push(res.body);
    }
    expect((answers[0] as { data: { outcome: string } }).data.outcome).toBe(outcome);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(await holdOf(u, referenceId)).toEqual(before);
    expect(JSON.stringify(answers)).not.toContain("msc1.");
  }

  it("already_released", async () => {
    const u = await fundedUser();
    const { referenceId, refundToken } = await reserve(u);
    expect((await post("/refund", { referenceId, [CAPABILITY_FIELD]: refundToken })).body.data.outcome).toBe("released");
    await expectStable(u, referenceId, refundToken, "already_released");
  });

  it("already_expired", async () => {
    const u = await fundedUser();
    const { referenceId } = await reserve(u);
    // This hold only, not the global sweep: that would also settle the aged holds of tests running in parallel.
    await ageHold(u, referenceId, 1);
    await db.query(`UPDATE ai_credit_holds SET status = 'expired', settled_at = NOW(), settle_reason = 'expired_unsettled' WHERE user_id = $1 AND reference_id = $2`, [u.id, referenceId]);
    await expectStable(u, referenceId, await mintForRow(db, "refund", u.id, referenceId), "already_expired");
  });

  it("already_captured", async () => {
    const u = await fundedUser();
    const { referenceId, captureToken, refundToken } = await reserve(u);
    expect((await post("/capture", { referenceId, [CAPABILITY_FIELD]: captureToken })).status).toBe(200);
    await expectStable(u, referenceId, refundToken, "already_captured");
    expect(await debits(u, referenceId)).toHaveLength(1);
  });

  it("capture_failed", async () => {
    const u = await fundedUser(5);
    const { referenceId, captureToken, refundToken } = await reserve(u, "ARCH_RENDER_STD");
    await db.query(`SELECT post_credit_transaction($1, -5, 'ADMIN_ADJUSTMENT', 'drain')`, [u.id]);
    expect((await post("/capture", { referenceId, [CAPABILITY_FIELD]: captureToken })).body.code).toBe("CAPTURE_FAILED");
    await expectStable(u, referenceId, refundToken, "capture_failed");
  });
});

describe("a capability past its own expiry is refused whatever the hold's state: a late retry learns nothing and changes nothing", () => {
  it.each<[string, Route, "capture" | "refund"]>([
    ["capture", "/capture", "capture"],
    ["refund", "/refund", "refund"],
  ])("%s of a hold that was already settled", async (_label, route, purpose) => {
    const u = await fundedUser();
    const r = await reserve(u);
    expect((await post("/capture", { referenceId: r.referenceId, [CAPABILITY_FIELD]: r.captureToken })).status).toBe(200);
    await ageHold(u, r.referenceId, 3600);
    const late = await mintForRow(db, purpose, u.id, r.referenceId);
    const before = await holdOf(u, r.referenceId);

    const res = await post(route, { referenceId: r.referenceId, [CAPABILITY_FIELD]: late });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(NOT_AUTHORIZED);
    expect(await holdOf(u, r.referenceId)).toEqual(before);
    expect(await debits(u, r.referenceId)).toHaveLength(1);
    expect(everythingLogged()).toMatch(/SETTLEMENT_AUTH_REJECTED.*reason: 'expired'/);
  });
});
