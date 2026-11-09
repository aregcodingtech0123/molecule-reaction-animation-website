/**
 * Phase 2C step 4: the logging paths the Step 3 security review listed, each with a REAL PostgreSQL error whose message, DETAIL
 * and HINT carry a marker. A path passes when the marker is nowhere in the console output and the operator still gets what is
 * needed to act: the fixed label, the SQLSTATE and the path's own identifiers.
 *
 * Output is checked with util.inspect over the raw console arguments: JSON.stringify drops an Error's message and stack.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stubExternal, jsonResponse } from "../../../../scripts/test/network-guard.mjs";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { isJtiRevoked } from "../../src/services/tokenRevocation.service.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser } from "../support/db";
import { newOrderId, orderCreatedEvent, sign, signedBody } from "../support/lemon";

const MARKER = "SENSITIVE-DB-MARKER-41c9";
const WEBHOOK = "/api/billing/webhooks/lemonsqueezy";
const LEMON = "api.lemonsqueezy.com";

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

const everythingLogged = () => inspect([logs.log.mock.calls, logs.warn.mock.calls, logs.error.mock.calls], { depth: 10, breakLength: Infinity, maxStringLength: null, maxArrayLength: null });

/** The structured payload of the first console call whose text includes `label`. */
function payloadOf(label: string): Record<string, unknown> {
  const call = [...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].find((args) => typeof args[0] === "string" && args[0].includes(label));
  expect(call, `no log line with "${label}"`).toBeDefined();
  return call![1] as Record<string, unknown>;
}

const markedRaise = (sqlState: string, messagePrefix = "") =>
  `DO $$ BEGIN RAISE EXCEPTION '${messagePrefix}${MARKER} in message' USING ERRCODE = '${sqlState}', DETAIL = '${MARKER} in detail', HINT = '${MARKER} in hint'; END $$`;

/** Pool queries matching `pattern` are replaced by a statement that makes the server raise the marked error. */
function raiseOn(pattern: RegExp, sqlState = "XX000") {
  const real = pg.Pool.prototype.query;
  return vi.spyOn(pg.Pool.prototype, "query").mockImplementation(function (this: pg.Pool, ...args: unknown[]) {
    const sql = typeof args[0] === "string" ? args[0] : "";
    const sent = pattern.test(sql) ? [markedRaise(sqlState)] : args;
    return (real as (...a: unknown[]) => unknown).apply(this, sent) as never;
  });
}

function deliver(event: unknown) {
  const { raw, signature } = signedBody(event);
  return request(app).post(WEBHOOK).set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
}

describe("the check itself", () => {
  it("a raw console.warn(label, err) of the same real error WOULD be caught", async () => {
    const err = await db.query(markedRaise("XX000")).catch((e: unknown) => e);
    console.warn("raw", err);
    expect(everythingLogged()).toContain(`${MARKER} in message`);
    expect(everythingLogged()).toContain(`${MARKER} in detail`);
  });
});

describe("billing.controller: [Webhook] NOT STORED", () => {
  it("a real server error: 503, the identifiers stay, the server's text does not", async () => {
    const broken = raiseOn(/INSERT INTO lemon_webhook_events/);
    const orderId = newOrderId();
    try {
      const res = await deliver(orderCreatedEvent({ orderId }));
      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.text).not.toContain(MARKER);
    } finally {
      broken.mockRestore();
    }
    expect(payloadOf("[Webhook] NOT STORED")).toMatchObject({ event: "order_created", orderId, sqlstate: "XX000", severity: "ERROR" });
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("a connection failure, whose message names the host: the code and the reason stay, the message does not", async () => {
    const broken = vi.spyOn(pg.Pool.prototype, "query").mockImplementation((() =>
      Promise.reject(Object.assign(new Error(`connect ECONNREFUSED ${MARKER}:5432`), { code: "ECONNREFUSED", syscall: "connect" }))) as never);
    try {
      expect((await deliver(orderCreatedEvent())).status).toBe(503);
    } finally {
      broken.mockRestore();
    }
    expect(payloadOf("[Webhook] NOT STORED")).toMatchObject({ sqlstate: "ECONNREFUSED", syscall: "connect", reason: "connect_socket_error" });
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("the store deadline passing stays recognisable: it says what happened, as the message used to", async () => {
    const saved = process.env.WEBHOOK_STORE_TIMEOUT_MS;
    process.env.WEBHOOK_STORE_TIMEOUT_MS = "50";
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = pg.Pool.prototype.query;
    const stalled = vi.spyOn(pg.Pool.prototype, "query").mockImplementation(function (this: pg.Pool, ...args: unknown[]) {
      const sql = typeof args[0] === "string" ? args[0] : "";
      if (/INSERT INTO lemon_webhook_events/.test(sql)) return gate.then(() => ({ rows: [{ id: "0", status: "pending", inserted: true }] })) as never;
      return (real as (...a: unknown[]) => unknown).apply(this, args) as never;
    });
    try {
      expect((await deliver(orderCreatedEvent())).status).toBe(503);
    } finally {
      release();
      stalled.mockRestore();
      if (saved === undefined) delete process.env.WEBHOOK_STORE_TIMEOUT_MS;
      else process.env.WEBHOOK_STORE_TIMEOUT_MS = saved;
    }
    expect(payloadOf("[Webhook] NOT STORED")).toMatchObject({ errorName: "WebhookStoreTimeoutError", sqlstate: null });
  });
});

describe("billing.controller: [Webhook] Processing deferred", () => {
  it("a real server error on the claim: still 200, the stored event's identifiers stay, the server's text does not", async () => {
    const broken = raiseOn(/SET status = 'processing'/);
    const orderId = newOrderId();
    try {
      expect((await deliver(orderCreatedEvent({ orderId }))).status).toBe(200);
      await logs.waitForLine("[Webhook] Processing deferred");
    } finally {
      broken.mockRestore();
    }
    expect(payloadOf("[Webhook] Processing deferred")).toMatchObject({ orderId, storedEventId: expect.any(String), sqlstate: "XX000" });
    expect(everythingLogged()).not.toContain(MARKER);
  });
});

describe("billing.controller: [Webhook] Rejected is safe as it is: every message is a fixed string, never the request's content", () => {
  it.each<[string, () => { body: string; signature?: string }, number]>([
    ["a correctly signed body that is not JSON (JSON.parse quotes its input in its own message)", () => ({ body: `not json ${MARKER}`, signature: sign(`not json ${MARKER}`) }), 400],
    ["a correctly signed JSON value that is not an object", () => ({ body: `"${MARKER}"`, signature: sign(`"${MARKER}"`) }), 400],
    ["a wrong signature", () => ({ body: `{"x":"${MARKER}"}`, signature: `${MARKER}0000` }), 401],
    ["no signature", () => ({ body: `{"x":"${MARKER}"}` }), 401],
  ])("%s", async (_label, make, status) => {
    const { body, signature } = make();
    let req = request(app).post(WEBHOOK).set("Content-Type", "application/json");
    if (signature) req = req.set("X-Signature", signature);
    const res = await req.send(body);
    expect(res.status).toBe(status);
    expect(everythingLogged()).toContain("[Webhook] Rejected");
    expect(everythingLogged()).not.toContain(MARKER);
    expect(everythingLogged()).not.toContain(TEST_ENV.LEMONSQUEEZY_WEBHOOK_SECRET);
  });
});

describe("checkout.service: could not mark the order failed", () => {
  it("a real server error while recording a failed checkout: the checkout's own answer is unchanged, the order id stays, the server's text does not", async () => {
    stubExternal(LEMON, () => jsonResponse({ errors: [{ detail: "nope" }] }, 500));
    const user = await createUser(db);
    const broken = raiseOn(/UPDATE pending_checkout_orders SET status = 'failed'/);
    let status: number;
    try {
      status = (await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" })).status;
    } finally {
      broken.mockRestore();
    }
    expect(status).toBe(502);
    expect(payloadOf("[billing] Could not mark checkout order failed")).toMatchObject({ orderId: expect.any(String), sqlstate: "XX000", severity: "ERROR" });
    expect(everythingLogged()).not.toContain(MARKER);
  });
});

describe("tokenRevocation.service: the periodic purge", () => {
  it("a real server error: the raw error object, with its message, DETAIL and HINT, is not logged", async () => {
    const broken = raiseOn(/DELETE FROM revoked_tokens/);
    try {
      for (let i = 0; i < 256; i++) await isJtiRevoked(randomUUID());
      await logs.waitForLine("[tokenRevocation] purge failed");
    } finally {
      broken.mockRestore();
    }
    expect(payloadOf("[tokenRevocation] purge failed")).toMatchObject({ sqlstate: "XX000", severity: "ERROR" });
    expect(everythingLogged()).not.toContain(MARKER);
  });
});

/** Known defects in step 4, fixed in step 4.1. The full coverage is in webhook-inbox-safe-errors and payment-error-classification. */
describe("raw database text on the paths found during step 4", () => {
  it("webhookInbox.service: a fulfilment failure logs no raw message", async () => {
    const buyer = await createUser(db);
    const broken = raiseOn(/FROM users WHERE id/);
    try {
      await deliver(orderCreatedEvent({ customData: { user_id: buyer.id, package_id: "starter" } }));
      await logs.waitForLine(/Processing failed — the event is stored/);
    } finally {
      broken.mockRestore();
    }
    expect(everythingLogged()).not.toContain(MARKER);
  });

  it("errorHandler: a database error whose message contains \"Lemon\" does not take the payment path, and no raw message is logged", async () => {
    const u = await createUser(db, { balance: 10, verified: true });
    const real = pg.Client.prototype.query;
    const broken = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const sql = typeof args[0] === "string" ? args[0] : "";
      const sent = /SELECT status, amount, operation_type/.test(sql) ? [markedRaise("XX000", "Lemon "), ...args.slice(2)] : args;
      return (real as (...a: unknown[]) => unknown).apply(this, sent) as never;
    });
    try {
      await request(app)
        .post("/api/billing/refund")
        .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
        .set("Authorization", bearer(u))
        .send({ referenceId: randomUUID() });
    } finally {
      broken.mockRestore();
    }
    expect(everythingLogged()).not.toContain("Payment provider error");
    expect(everythingLogged()).not.toContain(MARKER);
  });
});
