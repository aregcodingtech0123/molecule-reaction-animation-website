/**
 * SEC-19: production logs carry no full email address (or token / link). Purchase webhooks and receipts used to
 * log the buyer's address on every order. The dev-only mail stand-in (which prints whole mails when RESEND_API_KEY
 * is unset, refused in production since SEC-08) is the one deliberate exception and is excluded here.
 */
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { maskEmail } from "../../src/utils/logRedaction.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser, uniqueEmail } from "../support/db";
import { newOrderId, orderCreatedEvent, signedBody } from "../support/lemon";

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

async function deliver(event: unknown) {
  const { raw, signature } = signedBody(event);
  const res = await request(app).post("/api/billing/webhooks/lemonsqueezy").set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
  expect(res.status).toBe(200);
}
/** Every captured line except the dev-only mail stand-in. */
const productionLines = () => logs.lines().filter((l) => !l.includes("(dev only)"));

describe("no full email addresses in logs (SEC-19)", () => {
  it("a purchase matched by the order email: processing, crediting and receipt logs carry only a masked address", async () => {
    const email = uniqueEmail("buyer");
    const buyer = await createUser(db, { email });
    const orderId = newOrderId();
    await deliver(orderCreatedEvent({ orderId, email, customData: { package_id: "starter" } }));
    await logs.waitForLine(new RegExp(`Credited user ${buyer.id}`));
    await logs.waitForLine("Purchase receipt sent");
    const lines = productionLines().join("\n");
    expect(lines).not.toContain(email);
    expect(lines).toContain(maskEmail(email));
  });

  it("an order email that matches nobody is logged masked", async () => {
    const email = uniqueEmail("stranger");
    const orderId = newOrderId();
    await deliver(orderCreatedEvent({ orderId, email, customData: { package_id: "starter" } }));
    await logs.waitForLine(new RegExp(`Missing user identity.*${orderId}`));
    expect(productionLines().join("\n")).not.toContain(email);
  });
});

describe("maskEmail", () => {
  it.each([
    ["ada.lovelace@example.com", "a***@example.com"],
    ["  Bob@Example.COM ", "b***@example.com"],
    ["x@y.z", "x***@y.z"],
    ["not-an-email", "***"],
    ["", "***"],
  ])("%j → %j", (input, masked) => {
    expect(maskEmail(input)).toBe(masked);
  });
  it("null / undefined → null", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
  });
});
