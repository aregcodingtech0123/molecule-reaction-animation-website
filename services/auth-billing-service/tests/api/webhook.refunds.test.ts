/**
 * SEC-14: Lemon `order_refunded` events (full or partial — the only refund signal Lemon documents) are
 * signature-checked like `order_created`, recorded once per refund state, and NEVER change credits.
 * `refunded_orders_to_review()` (printed by db:reconcile) lists refunded orders whose credits are in
 * the ledger until the owner marks them reviewed. Through the real HTTP endpoint and database.
 */
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf } from "../support/db";
import { newOrderId, orderCreatedEvent, sign, signedBody } from "../support/lemon";

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
afterEach(() => {
  vi.unstubAllEnvs();
});

async function post(event: unknown) {
  const { raw, signature } = signedBody(event);
  const res = await request(app).post(WEBHOOK).set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
  expect(res.status).toBe(200);
}

/** A buyer whose starter order (50 credits) was credited through the real webhook. */
async function creditedOrder() {
  const buyer = await createUser(db);
  const orderId = newOrderId();
  await post(orderCreatedEvent({ orderId, customData: { user_id: buyer.id, package_id: "starter" } }));
  await logs.waitForLine(new RegExp(`Credited user .*"orderId":"${orderId}"`));
  return { buyer, orderId };
}

/** The Order object Lemon sends with order_refunded (docs: help/webhooks/event-types, api/orders/the-order-object). */
function refundEvent(orderId: string, attrs: Record<string, unknown> = {}, userId?: string) {
  const base = orderCreatedEvent({ orderId, eventName: "order_refunded", status: "refunded", refunded: true, ...(userId ? { customData: { user_id: userId } } : {}) });
  return {
    ...base,
    data: {
      ...base.data,
      attributes: {
        ...base.data.attributes,
        refunded_amount: 500,
        refunded_amount_usd: 500,
        refunded_at: "2026-10-20T10:00:00.000000Z",
        test_mode: false,
        ...attrs,
      },
    },
  };
}

const refundRows = async (orderId: string) =>
  (await db.query(
    `SELECT order_status, fully_refunded, refunded_amount, refunded_amount_usd, currency, test_mode, reviewed_at
     FROM lemon_order_refunds WHERE provider_order_id = $1 ORDER BY id`,
    [orderId],
  )).rows;
const toReview = async (orderId: string) =>
  (await db.query(`SELECT * FROM refunded_orders_to_review() WHERE provider_order_id = $1`, [orderId])).rows;
const recorded = (orderId: string) => logs.waitForLine(new RegExp(`Recorded refund .*"orderId":"${orderId}"`));

describe("order_refunded is recorded, never clawed back (SEC-14)", () => {
  it("a full refund of a credited order: stored once, credits untouched, listed for review", async () => {
    const { buyer, orderId } = await creditedOrder();
    const ledgerBefore = await ledgerOf(db, buyer.id);
    await post(refundEvent(orderId));
    await recorded(orderId);

    expect(await refundRows(orderId)).toEqual([
      { order_status: "refunded", fully_refunded: true, refunded_amount: 500, refunded_amount_usd: 500, currency: "USD", test_mode: false, reviewed_at: null },
    ]);
    expect(await ledgerOf(db, buyer.id)).toEqual(ledgerBefore);
    expect(await balanceOf(db, buyer.id)).toBe(50);
    expect(await toReview(orderId)).toEqual([
      expect.objectContaining({ user_id: buyer.id, credits: 50, current_balance: 50, order_status: "refunded", refunded_amount: 500 }),
    ]);
  });

  it("retries and replays of the same refund are no-ops (one row)", async () => {
    const { orderId } = await creditedOrder();
    for (let i = 0; i < 3; i++) await post(refundEvent(orderId));
    await logs.waitForLine(new RegExp(`Refund already recorded .*"orderId":"${orderId}"`));
    await new Promise((r) => setTimeout(r, 100));
    expect(await refundRows(orderId)).toHaveLength(1);
  });

  it("a partial refund, then the rest: two rows; the review lists the latest state", async () => {
    const { orderId } = await creditedOrder();
    await post(refundEvent(orderId, { status: "partial_refund", refunded: false, refunded_amount: 200, refunded_amount_usd: 200, refunded_at: null }));
    await recorded(orderId);
    expect(await toReview(orderId)).toEqual([expect.objectContaining({ order_status: "partial_refund", refunded_amount: 200 })]);
    await post(refundEvent(orderId));
    await logs.waitForLine(new RegExp(`Recorded refund .*"orderId":"${orderId}".*"refundedAmount":500`));
    expect((await refundRows(orderId)).map((r) => [r.order_status, r.refunded_amount])).toEqual([
      ["partial_refund", 200],
      ["refunded", 500],
    ]);
    expect(await toReview(orderId)).toEqual([expect.objectContaining({ order_status: "refunded", refunded_amount: 500 })]);
  });

  it("once the owner marks it reviewed it is no longer listed", async () => {
    const { orderId } = await creditedOrder();
    await post(refundEvent(orderId));
    await recorded(orderId);
    await db.query(`UPDATE lemon_order_refunds SET reviewed_at = NOW(), review_note = 'kept: goodwill' WHERE provider_order_id = $1`, [orderId]);
    expect(await toReview(orderId)).toEqual([]);
  });

  it("a refund for an order that was never credited is stored but not listed", async () => {
    const orderId = newOrderId();
    await post(refundEvent(orderId));
    await recorded(orderId);
    expect(await refundRows(orderId)).toHaveLength(1);
    expect(await toReview(orderId)).toEqual([]);
  });
});

describe("order_refunded gate (SEC-14)", () => {
  it("a bad signature → 401, nothing stored", async () => {
    const orderId = newOrderId();
    const raw = JSON.stringify(refundEvent(orderId));
    const res = await request(app).post(WEBHOOK).set("Content-Type", "application/json").set("X-Signature", sign(raw, "wrong-secret-wrong-secret-wrong-secret")).send(raw);
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 100));
    expect(await refundRows(orderId)).toEqual([]);
  });

  it.each([
    ["another store", { store_id: 99999 }, "Order from another store"],
    ["an unexpected status", { status: "paid" }, "Ignoring refund event with unexpected status"],
    ["a missing refunded_amount", { refunded_amount: undefined }, "Malformed refund payload"],
    ["a negative refunded_amount", { refunded_amount: -5 }, "Malformed refund payload"],
  ])("%s → logged, nothing stored", async (_label, attrs, line) => {
    const orderId = newOrderId();
    const event = refundEvent(orderId, attrs);
    for (const [k, v] of Object.entries(attrs)) if (v === undefined) delete (event.data.attributes as Record<string, unknown>)[k];
    await post(event);
    await logs.waitForLine(new RegExp(`${line}.*${orderId}`));
    expect(await refundRows(orderId)).toEqual([]);
  });

  it("production: a test-mode refund is ignored (test-mode orders are never credited there)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const orderId = newOrderId();
    await post(refundEvent(orderId, { test_mode: true }));
    await logs.waitForLine(new RegExp(`Ignoring test-mode order.*${orderId}`));
    expect(await refundRows(orderId)).toEqual([]);
  });

  it("development / test: a test-mode refund is recorded with test_mode = true", async () => {
    const orderId = newOrderId();
    await post(refundEvent(orderId, { test_mode: true }));
    await recorded(orderId);
    expect(await refundRows(orderId)).toEqual([expect.objectContaining({ test_mode: true })]);
  });

  it("logs carry the order id and amount, never the buyer's email", async () => {
    const orderId = newOrderId();
    const event = refundEvent(orderId, { user_email: "private.buyer@example.test" });
    await post(event);
    await recorded(orderId);
    expect(logs.lines().join("\n")).not.toContain("private.buyer@example.test");
  });
});
