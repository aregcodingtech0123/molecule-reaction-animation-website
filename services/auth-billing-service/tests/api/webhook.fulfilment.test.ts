/**
 * Webhook stage 3 — background fulfilment, through the real HTTP endpoint and
 * the real database. Each test waits for the specific log line / DB state of
 * its own order id instead of sleeping.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { processLemonSqueezyEvent } from "../../src/services/webhook.service.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, uniqueEmail, waitFor } from "../support/db";
import { CREDITS, PRICES, VARIANTS, newOrderId, orderCreatedEvent, signedBody, type OrderOptions } from "../support/lemon";

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

async function deliver(opts: OrderOptions) {
  const event = orderCreatedEvent(opts);
  const { raw, signature } = signedBody(event);
  const res = await request(app)
    .post(WEBHOOK)
    .set("Content-Type", "application/json")
    .set("X-Signature", signature)
    .send(raw);
  expect(res.status).toBe(200);
  return event.data.id;
}

const credited = (orderId: string) => logs.waitForLine(new RegExp(`Credited user .*"orderId":"${orderId}"`));

describe("user resolution", () => {
  it("credits custom_data.user_id when it is a valid, existing UUID (ignoring a different order email)", async () => {
    const buyer = await createUser(db);
    const other = await createUser(db);
    const orderId = await deliver({
      customData: { user_id: buyer.id, package_id: "starter" },
      email: other.email,
    });
    await credited(orderId);

    expect(await balanceOf(db, buyer.id)).toBe(CREDITS.starter);
    expect(await balanceOf(db, other.id)).toBe(0);
    expect(await ledgerOf(db, buyer.id)).toEqual([
      expect.objectContaining({
        amount: 50,
        transaction_type: "CREDIT_PURCHASE",
        reference_id: `ls_order_${orderId}`,
        provider: "lemonsqueezy",
      }),
    ]);
  });

  it("falls back to the order email when custom_data.user_id is not a UUID", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: "12345; DROP TABLE users", package_id: "starter" }, email: buyer.email });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(50);
    expect(logs.lines().some((l) => l.includes("custom_data.user_id is not a UUID"))).toBe(true);
  });

  it("falls back to the order email when custom_data.user_id is a UUID that does not exist", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: randomUUID(), package_id: "starter" }, email: buyer.email });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(50);
    expect(logs.lines().some((l) => l.includes("not found in users"))).toBe(true);
  });

  it("email fallback is case- and whitespace-insensitive", async () => {
    const buyer = await createUser(db, { email: uniqueEmail("Case") });
    const orderId = await deliver({ customData: { package_id: "starter" }, email: `  ${buyer.email.toUpperCase()} ` });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });

  it("purchases without any custom_data (raw store link) are attributed by email", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: undefined, email: buyer.email, variantId: VARIANTS.pro, total: PRICES.pro });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(CREDITS.pro);
  });

  it("no user_id and an unknown email → logged failure, nothing credited", async () => {
    const orderId = await deliver({ customData: { package_id: "starter" }, email: uniqueEmail("ghost") });
    await logs.waitForLine(new RegExp(`Missing user identity.*${orderId}`));
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM credit_ledger_transactions WHERE reference_id = $1`, [
      `ls_order_${orderId}`,
    ]);
    expect(rows[0].n).toBe(0);
  });
});

describe("package resolution", () => {
  it.each([
    ["starter", VARIANTS.starter, PRICES.starter, CREDITS.starter],
    ["pro", VARIANTS.pro, PRICES.pro, CREDITS.pro],
    ["enterprise", VARIANTS.enterprise, PRICES.enterprise, CREDITS.enterprise],
  ])("variant id → %s pack", async (_pkg, variantId, total, credits) => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id }, variantId, total });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(credits);
  });

  it("unknown variant → falls back to custom_data.package_id", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "pro" }, variantId: 424242, total: PRICES.pro });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(CREDITS.pro);
  });

  it("missing order item / variant → falls back to custom_data.package_id", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "starter" }, variantId: null });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(CREDITS.starter);
  });

  it("unknown variant and no custom package → unresolved_package logged, nothing credited", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id }, variantId: 424242 });
    await logs.waitForLine(new RegExp(`Unable to resolve package.*${orderId}`));
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("unknown custom package id → invalid_package_id logged, nothing credited", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "platinum" }, variantId: 424242 });
    await logs.waitForLine(new RegExp(`Invalid package_id.*${orderId}`));
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("custom_data.package_id cannot upgrade a cheaper purchase: the amount check rejects it", async () => {
    // Attacker buys Starter ($5) via a store link with ?checkout[custom][package_id]=enterprise.
    const buyer = await createUser(db);
    const orderId = await deliver({
      customData: { user_id: buyer.id, package_id: "enterprise" },
      variantId: VARIANTS.starter,
      total: PRICES.starter,
    });
    await logs.waitForLine(new RegExp(`Amount mismatch.*${orderId}`));
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("variant ids hard-coded in source map to packs even when the env uses different ids (FINDING-13)", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id }, variantId: 2154665, total: PRICES.enterprise });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(CREDITS.enterprise);
  });
});

describe("order validation", () => {
  it.each([
    ["non-paid status", { status: "pending" }, "Ignoring non-paid order"],
    ["refunded order", { refunded: true }, "Ignoring refunded order"],
    ["non-USD currency", { currency: "EUR" }, "Unexpected currency"],
    ["amount not matching the pack price", { total: 499, subtotal: 499, price: 499 }, "Amount mismatch"],
  ] as const)("%s → not credited", async (_label, overrides, logFragment) => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "starter" }, ...overrides });
    await logs.waitForLine(new RegExp(`${logFragment}.*${orderId}`));
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("tax-inclusive total is accepted when the subtotal matches the list price", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "starter" }, total: 595, subtotal: 500, price: 500 });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });

  it("malformed payload without data.attributes → logged, nothing credited, no crash", async () => {
    const event = { meta: { event_name: "order_created" }, data: { id: "1" } };
    const { raw, signature } = signedBody(event);
    const res = await request(app).post(WEBHOOK).set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
    expect(res.status).toBe(200);
    await logs.waitForLine("Malformed order payload");
  });
});

describe("pending checkout orders", () => {
  it("marks the referenced pending order completed when the purchase is credited", async () => {
    const buyer = await createUser(db);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO pending_checkout_orders (user_id, package_id, provider, currency, amount_minor, credits)
       VALUES ($1, 'starter', 'lemonsqueezy', 'USD', 500, 50) RETURNING id::text`,
      [buyer.id],
    );
    const pendingId = rows[0]!.id;
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "starter", pending_order_id: pendingId } });
    await credited(orderId);

    const after = await db.query(`SELECT status, completed_at FROM pending_checkout_orders WHERE id = $1`, [pendingId]);
    expect(after.rows[0].status).toBe("completed");
    expect(after.rows[0].completed_at).toBeInstanceOf(Date);
  });

  it("a malformed pending_order_id is ignored with a warning: the purchase is still credited (FINDING-10)", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "starter", pending_order_id: "not-a-uuid" } });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(CREDITS.starter);
    expect(logs.lines().some((l) => l.includes("pending_order_id is not a UUID") && l.includes(orderId))).toBe(true);
    expect(logs.lines().some((l) => l.includes("[Webhook] FAILED"))).toBe(false);
  });

  it.each([["expired"], ["failed"]])(
    "a paid order for a pending row already marked %s still credits and marks it completed (late payment, FINDING-15)",
    async (status) => {
      const buyer = await createUser(db);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO pending_checkout_orders (user_id, package_id, provider, currency, amount_minor, credits, status)
         VALUES ($1, 'starter', 'lemonsqueezy', 'USD', 500, 50, $2) RETURNING id::text`,
        [buyer.id, status],
      );
      const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "starter", pending_order_id: rows[0]!.id } });
      await credited(orderId);
      expect(await balanceOf(db, buyer.id)).toBe(CREDITS.starter);
      const after = await db.query(`SELECT status, completed_at FROM pending_checkout_orders WHERE id = $1`, [rows[0]!.id]);
      expect(after.rows[0]).toMatchObject({ status: "completed", completed_at: expect.any(Date) });
    },
  );

  it("a well-formed but unknown pending_order_id is harmless: credited, no pending row touched", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "starter", pending_order_id: randomUUID() } });
    await credited(orderId);
    expect(await balanceOf(db, buyer.id)).toBe(CREDITS.starter);
  });
});

describe("idempotency", () => {
  it("the same order delivered twice credits once; the replay is reported as already_processed", async () => {
    const buyer = await createUser(db);
    const orderId = newOrderId();
    await deliver({ orderId, customData: { user_id: buyer.id, package_id: "starter" } });
    await credited(orderId);
    await deliver({ orderId, customData: { user_id: buyer.id, package_id: "starter" } });
    await logs.waitForLine(/Not credited.*already_processed/);

    expect(await balanceOf(db, buyer.id)).toBe(50);
    expect(await ledgerOf(db, buyer.id)).toHaveLength(1);
  });

  it("a replay that resolves to a DIFFERENT user (via email) still cannot credit the order twice", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const orderId = newOrderId();
    await deliver({ orderId, customData: { user_id: a.id, package_id: "starter" } });
    await credited(orderId);
    await deliver({ orderId, customData: { package_id: "starter" }, email: b.email });
    await logs.waitForLine(/Not credited.*already_processed/);
    expect([await balanceOf(db, a.id), await balanceOf(db, b.id)]).toEqual([50, 0]);
  });

  it("two concurrent deliveries of the same order credit exactly once", async () => {
    const { user, outcomes } = await raceDuplicateDeliveries();
    expect(await balanceOf(db, user.id)).toBe(50);
    expect(await ledgerOf(db, user.id)).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "fulfilled" && o.value.processed)).toHaveLength(1);
  });

  // FINDING-11 (Low): the losing concurrent delivery throws 23505 out of fulfillVerifiedPurchase,
  // which the controller logs as "[Webhook] FAILED … replay this event manually" although the
  // order WAS credited — a false alarm that sends an operator to replay a completed order.
  it("the losing concurrent delivery reports already_processed instead of throwing (FINDING-11)", async () => {
    const { user, outcomes } = await raceDuplicateDeliveries();
    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
    const values = outcomes.map((o) => (o.status === "fulfilled" ? o.value : null));
    expect(values.filter((v) => v?.processed)).toHaveLength(1);
    const loser = values.find((v) => !v?.processed);
    expect(loser).toMatchObject({ processed: false, reason: "already_processed" });
    // The loser points at the winner's ledger row, exactly like a sequential replay.
    const ledger = await ledgerOf(db, user.id);
    expect(ledger).toHaveLength(1);
    expect(loser!.ledgerId).toBe(String(ledger[0]!.id));
  });
});

/**
 * Deterministic race: hold the per-user advisory lock from the test so both
 * fulfilments pass their "already processed?" SELECT and then queue on the
 * lock inside post_credit_transaction; release once both are waiting.
 */
async function raceDuplicateDeliveries() {
  const user = await createUser(db);
  const event = orderCreatedEvent({ customData: { user_id: user.id, package_id: "starter" } });
  const locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();
  try {
    await locker.query(`SELECT pg_advisory_lock(hashtext($1))`, [user.id]);
    const running = [processLemonSqueezyEvent(event), processLemonSqueezyEvent(event)];
    await waitFor(async () => {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`,
      );
      return rows[0].n >= 2;
    });
    await locker.query(`SELECT pg_advisory_unlock(hashtext($1))`, [user.id]);
    const outcomes = await Promise.allSettled(running);
    return { user, outcomes };
  } finally {
    await locker.end();
  }
}

describe("non-order events", () => {
  it.each(["order_refunded", "subscription_created", "license_key_created", ""])(
    "%s is acknowledged and ignored without touching the ledger",
    async (eventName) => {
      const buyer = await createUser(db);
      const orderId = await deliver({ eventName, customData: { user_id: buyer.id, package_id: "starter" } });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(logs.lines().some((l) => l.includes(`Credited user`) && l.includes(orderId))).toBe(false);
      expect(await balanceOf(db, buyer.id)).toBe(0);
    },
  );

  it("processLemonSqueezyEvent returns ignored_event_type for non-order events", async () => {
    await expect(
      processLemonSqueezyEvent(orderCreatedEvent({ eventName: "order_refunded" }) as never),
    ).resolves.toEqual({ processed: false, reason: "ignored_event_type" });
  });
});

describe("receipt email", () => {
  it("is attempted after crediting and never blocks or fails fulfilment (Resend unset → logged)", async () => {
    const buyer = await createUser(db);
    const orderId = await deliver({ customData: { user_id: buyer.id, package_id: "starter" } });
    await credited(orderId);
    await waitFor(async () =>
      logs.lines().some((l) => l.includes("logging purchase receipt") || l.includes("Purchase receipt")),
    );
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });
});
