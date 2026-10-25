/**
 * SEC-13: a correctly signed `order_created` must also come from the right place before credits are posted —
 * a live-mode order (Lemon test-mode orders are paid with test cards, i.e. free), from this store, in USD.
 * Through the real HTTP endpoint and database.
 */
import request from "supertest";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser } from "../support/db";
import { orderCreatedEvent, signedBody, type OrderOptions } from "../support/lemon";

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

/** Deliver a signed order for `buyer`, with attribute overrides applied after the fixture is built. */
async function deliver(buyerId: string, attrs: Record<string, unknown>, opts: OrderOptions = {}) {
  const event = orderCreatedEvent({ customData: { user_id: buyerId, package_id: "starter" }, ...opts });
  const merged = { ...event, data: { ...event.data, attributes: { ...event.data.attributes, ...attrs } } };
  for (const [k, v] of Object.entries(attrs)) if (v === undefined) delete (merged.data.attributes as Record<string, unknown>)[k];
  const { raw, signature } = signedBody(merged);
  const res = await request(app).post(WEBHOOK).set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
  expect(res.status).toBe(200);
  return event.data.id;
}
const credited = (orderId: string) => logs.waitForLine(new RegExp(`Credited user .*"orderId":"${orderId}"`));

describe("test-mode orders (SEC-13)", () => {
  it("production: a test-mode order is not credited", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const buyer = await createUser(db);
    const orderId = await deliver(buyer.id, { test_mode: true });
    await logs.waitForLine(new RegExp(`Ignoring test-mode order.*${orderId}`));
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("production with LEMONSQUEEZY_ALLOW_TEST_MODE=true: credited (explicit opt-in for staging)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LEMONSQUEEZY_ALLOW_TEST_MODE", "true");
    const buyer = await createUser(db);
    await credited(await deliver(buyer.id, { test_mode: true }));
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });

  it("production: a live-mode order is credited", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const buyer = await createUser(db);
    await credited(await deliver(buyer.id, { test_mode: false }));
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });

  it("development / test: test-mode orders are credited (local checkout testing)", async () => {
    const buyer = await createUser(db);
    await credited(await deliver(buyer.id, { test_mode: true }));
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });
});

describe("store and currency (SEC-13)", () => {
  it("an order from another store is not credited", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver(buyer.id, { store_id: 99999 });
    await logs.waitForLine(new RegExp(`Order from another store.*${orderId}`));
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("an order without store_id is not credited", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver(buyer.id, { store_id: undefined });
    await logs.waitForLine(new RegExp(`Order from another store.*${orderId}`));
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("an order without currency is not credited", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver(buyer.id, { currency: undefined });
    await logs.waitForLine(new RegExp(`Unexpected currency.*${orderId}`));
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("lower-case usd from this store is credited", async () => {
    const buyer = await createUser(db);
    await credited(await deliver(buyer.id, { currency: "usd", store_id: "11111" }));
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });
});
