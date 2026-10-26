/**
 * Webhook stages 1 (signature gate) and 2 (store, then acknowledge — R19).
 * Stage 3 (fulfilment) lives in webhook.fulfilment.test.ts.
 */
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser, waitFor } from "../support/db";
import { newOrderId, orderCreatedEvent, sign, signedBody } from "../support/lemon";
import { spyOnPostgres } from "../support/pg-spy";

const WEBHOOK = "/api/billing/webhooks/lemonsqueezy";
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

function post(raw: string | Buffer, signature?: string, contentType = "application/json") {
  const req = request(app).post(WEBHOOK).set("Content-Type", contentType);
  if (signature !== undefined) req.set("X-Signature", signature);
  return req.send(raw);
}

describe("stage 1 — signature gate (no database I/O on rejection)", () => {
  const { raw, signature } = signedBody(orderCreatedEvent({ eventName: "subscription_created" }));

  const rejected: Array<[string, () => ReturnType<typeof post>]> = [
    ["missing X-Signature", () => post(raw)],
    ["empty X-Signature", () => post(raw, "   ")],
    ["malformed (non-hex) signature", () => post(raw, "zz-not-hex")],
    ["truncated signature", () => post(raw, signature.slice(0, 32))],
    ["signature with sha256= prefix", () => post(raw, `sha256=${signature}`)],
    ["signature made with the wrong secret", () => post(raw, sign(raw, "some-other-secret"))],
    ["body tampered after signing", () => post(raw.replace('"paid"', '"PAID"'), signature)],
    ["uppercase hex of the right digest", () => post(raw, signature.toUpperCase())],
  ];

  it.each(rejected)("%s → 401 and zero DB calls", async (_label, send) => {
    const pgSpy = spyOnPostgres();
    const res = await send();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid signature" });
    // Give any (incorrectly) scheduled background work a chance to run before asserting.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(pgSpy.total()).toBe(0);
  });

  it("verifies the RAW bytes: the same JSON re-serialised differently is rejected", async () => {
    const event = orderCreatedEvent({ eventName: "subscription_created" });
    const compact = JSON.stringify(event);
    const pretty = JSON.stringify(event, null, 2);
    const pgSpy = spyOnPostgres();

    // Signed compact, sent pretty: semantically equal JSON, different bytes.
    expect((await post(pretty, sign(compact))).status).toBe(401);
    expect(pgSpy.total()).toBe(0);
    // Signed pretty, sent pretty: accepted — proves the digest is over raw bytes, not a re-serialisation.
    expect((await post(pretty, sign(pretty))).status).toBe(200);
    // Accepted deliveries are stored, then processed in the background (R19): let that finish so its
    // queries are not counted by the next test.
    await waitFor(async () => (await db.query(`SELECT status FROM lemon_webhook_events WHERE payload = $1`, [pretty])).rows[0]?.status === "processed");
  });

  it("non-JSON content type → 400 (raw body not captured) and zero DB calls", async () => {
    const pgSpy = spyOnPostgres();
    const res = await post(raw, signature, "text/plain");
    expect(res.status).toBe(400);
    expect(pgSpy.total()).toBe(0);
  });

  it("valid signature over invalid JSON → 400 'Invalid webhook body' (not 'Invalid signature'), zero DB calls (FINDING-14)", async () => {
    const pgSpy = spyOnPostgres();
    const body = "{not json";
    const res = await post(body, sign(body));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid webhook body" });
    expect(pgSpy.total()).toBe(0);
  });

  it("valid signature over a JSON scalar → 400 'Invalid webhook body' (FINDING-14)", async () => {
    const body = "42";
    const res = await post(body, sign(body));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid webhook body" });
  });

  // FINDING-12 (Low): errorHandler ignores body-parser's `status`, so PayloadTooLargeError → 500.
  it("body over 256kb → 413 before verification (FINDING-12)", async () => {
    const big = JSON.stringify({ meta: { event_name: "x" }, pad: "a".repeat(300 * 1024) });
    const res = await post(big, sign(big));
    expect(res.status).toBe(413);
  });

  it("body over 256kb is rejected before verification and without DB I/O (currently as 500)", async () => {
    const pgSpy = spyOnPostgres();
    const big = JSON.stringify({ meta: { event_name: "x" }, pad: "a".repeat(300 * 1024) });
    const res = await post(big, sign(big));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toHaveProperty("received");
    expect(pgSpy.total()).toBe(0);
  });

  it("webhook secret not configured → 503 'Webhook not configured', zero DB calls", async () => {
    const saved = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "";
    try {
      const pgSpy = spyOnPostgres();
      const res = await post(raw, signature);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "Webhook not configured" });
      expect(pgSpy.total()).toBe(0);
    } finally {
      process.env.LEMONSQUEEZY_WEBHOOK_SECRET = saved;
    }
  });

  it("never leaks internals (stack, secret, expected digest) in the 401 body or headers", async () => {
    const res = await post(raw, "0".repeat(64));
    const everything = JSON.stringify(res.body) + JSON.stringify(res.headers);
    expect(everything).not.toMatch(/stack|test_webhook_secret|at .*\.ts/i);
    expect(everything).not.toContain(signature);
  });
});

describe("stage 2 — store the delivery, then acknowledge (R19)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns exactly 200 {received:true} for a valid signature", async () => {
    const { raw, signature } = signedBody(orderCreatedEvent({ eventName: "order_refunded" }));
    const res = await post(raw, signature);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("the 200 is sent only after the delivery is stored", async () => {
    const orderId = newOrderId();
    const { raw, signature } = signedBody(orderCreatedEvent({ orderId, eventName: "subscription_created" }));
    const res = await post(raw, signature);
    expect(res.status).toBe(200);
    // Already in the inbox at the moment the response arrived (no waiting).
    const { rows } = await db.query(`SELECT event_name, payload FROM lemon_webhook_events WHERE provider_order_id = $1`, [orderId]);
    expect(rows).toEqual([{ event_name: "subscription_created", payload: raw }]);
  });

  it("a stalled database: 503 within WEBHOOK_STORE_TIMEOUT_MS (never held open), Lemon's retry after recovery is credited once", async () => {
    vi.stubEnv("WEBHOOK_STORE_TIMEOUT_MS", "300");
    // Every pool query hangs until released.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realQuery = pg.Pool.prototype.query;
    vi.spyOn(pg.Pool.prototype, "query").mockImplementation(function (this: pg.Pool, ...args: unknown[]) {
      return gate.then(() => (realQuery as (...a: unknown[]) => unknown).apply(this, args)) as never;
    });

    const user = await (async () => {
      // created on a client that bypasses the stalled Pool.prototype.query
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      try {
        return await createUser(c as unknown as pg.PoolClient, { balance: 0 });
      } finally {
        await c.end();
      }
    })();
    const orderId = newOrderId();
    const { raw, signature } = signedBody(
      orderCreatedEvent({ orderId, customData: { user_id: user.id, package_id: "starter" }, email: user.email }),
    );

    const started = Date.now();
    const res = await post(raw, signature).timeout({ response: 1_500 });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "Webhook temporarily unavailable" });
    expect(res.headers["retry-after"]).toBe("5");
    expect(Date.now() - started).toBeLessThan(1_200);
    expect(logs.lines().some((l) => l.includes("[Webhook] NOT STORED — answered 503 so Lemon retries the delivery"))).toBe(true);
    expect(logs.lines().some((l) => l.includes("[Webhook] Acknowledged 200 OK"))).toBe(false);

    // The database recovers (the stalled INSERT may now land); Lemon retries the identical delivery.
    release();
    vi.mocked(pg.Pool.prototype.query).mockRestore();
    const retry = await post(raw, signature);
    expect(retry.status).toBe(200);
    await logs.waitForLine(new RegExp(`Credited user .*"orderId":"${orderId}"`));
    await waitFor(async () => {
      const { rows } = await db.query(`SELECT status FROM lemon_webhook_events WHERE provider_order_id = $1`, [orderId]);
      return rows.length === 1 && rows[0].status === "processed";
    });
    const { rows } = await db.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [user.id]);
    expect(rows[0].balance).toBe(50);
  });

  it("the database is down: 503 (not acknowledged, so Lemon retries), logged as NOT STORED, the process survives", async () => {
    vi.spyOn(pg.Pool.prototype, "query").mockImplementation((() =>
      Promise.reject(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }))) as never);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { raw, signature } = signedBody(
        orderCreatedEvent({ customData: { user_id: "6f1c1c3e-1111-4a4a-8b8b-000000000001", package_id: "starter" } }),
      );
      const res = await post(raw, signature);
      expect(res.status).toBe(503);

      const line = await logs.waitForLine("[Webhook] NOT STORED");
      expect(line).toContain("ECONNREFUSED");
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      vi.mocked(pg.Pool.prototype.query).mockRestore();
    }

    // Still serving.
    const again = await post("{}", sign("{}"));
    expect(again.status).toBe(200);
  });
});
