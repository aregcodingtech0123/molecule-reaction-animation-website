import { randomUUID } from "node:crypto";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { externalCalls, jsonResponse, stubExternal } from "../../../../scripts/test/network-guard.mjs";
import { bearer, craftToken } from "../support/auth";
import { spyConsole } from "../support/console";
import { createTestPool, createUser } from "../support/db";

const app = createApp();
let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await closePool();
});
beforeEach(() => {
  spyConsole();
});

const LEMON = "api.lemonsqueezy.com";
const CHECKOUT_URL = "https://moleculestudio.lemonsqueezy.com/checkout/buy/test-123";

function stubLemonOk(url = CHECKOUT_URL) {
  stubExternal(LEMON, () => jsonResponse({ data: { type: "checkouts", id: "chk_1", attributes: { url } } }, 201));
}

const lemonCalls = () => externalCalls.filter((c: { url: string }) => c.url.includes(LEMON));

async function pendingOrdersFor(userId: string) {
  const { rows } = await db.query(
    `SELECT id::text, package_id, provider, currency, amount_minor, credits, status
     FROM pending_checkout_orders WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows;
}

describe("POST /api/billing/checkout — auth and validation", () => {
  it("requires a bearer token", async () => {
    stubLemonOk();
    const res = await request(app).post("/api/billing/checkout").send({ packageId: "starter" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
    expect(lemonCalls()).toHaveLength(0);
  });

  it("rejects a token signed with another secret", async () => {
    const res = await request(app)
      .post("/api/billing/checkout")
      .set("Authorization", `Bearer ${craftToken({}, { secret: "x".repeat(40) })}`)
      .send({ packageId: "starter" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it.each([[undefined], ["free"], ["STARTER"], [""], [123], [{ id: "starter" }], [["starter"]]])(
    "packageId=%j → 400 INVALID_PACKAGE, no Lemon call, no pending order",
    async (packageId) => {
      stubLemonOk();
      const user = await createUser(db);
      const res = await request(app)
        .post("/api/billing/checkout")
        .set("Authorization", bearer(user))
        .send(packageId === undefined ? {} : { packageId });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: "INVALID_PACKAGE" });
      expect(lemonCalls()).toHaveLength(0);
      expect(await pendingOrdersFor(user.id)).toHaveLength(0);
    },
  );

  // FINDING-16 (Low): resolveCreditPackage indexes a plain object, so inherited keys such as
  // "__proto__" / "constructor" / "toString" are treated as packages and crash later (500).
  it.fails.each([["__proto__"], ["constructor"], ["toString"]])(
    "inherited object key packageId=%j → 400 INVALID_PACKAGE (FINDING-16)",
    async (packageId) => {
      stubLemonOk();
      const user = await createUser(db);
      const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId });
      expect(res.status).toBe(400);
    },
  );

  it.each([["__proto__"], ["constructor"]])("inherited key packageId=%j never reaches Lemon or creates an order", async (packageId) => {
    stubLemonOk();
    const user = await createUser(db);
    await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId });
    expect(lemonCalls()).toHaveLength(0);
    expect(await pendingOrdersFor(user.id)).toHaveLength(0);
  });

  it("a token whose subject is not a UUID cannot start a checkout (401 CHECKOUT_MISSING_USER)", async () => {
    stubLemonOk();
    const token = craftToken({ sub: "user-123", email: "x@example.test" });
    const res = await request(app).post("/api/billing/checkout").set("Authorization", `Bearer ${token}`).send({ packageId: "starter" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("CHECKOUT_MISSING_USER");
    expect(lemonCalls()).toHaveLength(0);
  });
});

describe("POST /api/billing/checkout — Lemon request", () => {
  it.each([
    ["starter", "900001", 500, 50, "Starter Pack — 50 Credits"],
    ["pro", "900002", 2000, 250, "Pro Pack — 250 Credits"],
    ["enterprise", "900003", 5000, 700, "Studio Pack — 700 Credits"],
  ])("%s → correct variant, store, custom_data and a pending order", async (packageId, variant, cents, credits, name) => {
    stubLemonOk();
    const user = await createUser(db);
    const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { provider: "lemonsqueezy", currency: "USD", mode: "redirect", checkoutUrl: CHECKOUT_URL, orderId: expect.any(String) },
    });

    const [call] = lemonCalls();
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    expect(call.headers.authorization).toBe("Bearer test_lemon_api_key");
    expect(call.headers["content-type"]).toBe("application/vnd.api+json");

    const body = JSON.parse(call.body!);
    expect(body.data.relationships).toEqual({
      store: { data: { type: "stores", id: "11111" } },
      variant: { data: { type: "variants", id: variant } },
    });
    expect(body.data.attributes.checkout_data).toEqual({
      email: user.email,
      custom: { user_id: user.id, package_id: packageId, pending_order_id: res.body.data.orderId },
    });
    expect(body.data.attributes.product_options).toEqual({
      redirect_url: `http://localhost:3000/dashboard?payment=success&credits=${credits}`,
      name,
    });

    expect(await pendingOrdersFor(user.id)).toEqual([
      { id: res.body.data.orderId, package_id: packageId, provider: "lemonsqueezy", currency: "USD", amount_minor: cents, credits, status: "pending" },
    ]);
  });

  it.each([
    ["/pricing", "/pricing"],
    ["/ai-lab?x=1#frag", "/ai-lab"],
    ["//evil.example", "/dashboard"],
    ["https://evil.example/x", "/dashboard"],
    ["pricing", "/dashboard"],
    [`/${"a".repeat(250)}`, "/dashboard"],
    [42, "/dashboard"],
  ])("returnPath %j → redirect back to %s on our origin only", async (returnPath, expected) => {
    stubLemonOk();
    const user = await createUser(db);
    await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter", returnPath });
    const body = JSON.parse(lemonCalls()[0].body!);
    expect(body.data.attributes.product_options.redirect_url).toBe(`http://localhost:3000${expected}?payment=success&credits=50`);
  });

  it("the client cannot influence price, credits, user or email through the body", async () => {
    stubLemonOk();
    const user = await createUser(db);
    const victim = await createUser(db);
    await request(app)
      .post("/api/billing/checkout")
      .set("Authorization", bearer(user))
      .send({ packageId: "starter", userId: victim.id, email: victim.email, credits: 99999, priceUsdCents: 1, custom: { user_id: victim.id } });
    const body = JSON.parse(lemonCalls()[0].body!);
    expect(body.data.attributes.checkout_data.email).toBe(user.email);
    expect(body.data.attributes.checkout_data.custom.user_id).toBe(user.id);
    expect(body.data.attributes.product_options.redirect_url).toContain("credits=50");
  });
});

describe("POST /api/billing/checkout — Lemon failures", () => {
  it("Lemon 4xx/5xx → 502 LEMONSQUEEZY_CHECKOUT_FAILED without leaking provider detail", async () => {
    stubExternal(LEMON, () => jsonResponse({ errors: [{ detail: "The variant 900001 is secret-internal-detail" }] }, 422));
    const user = await createUser(db);
    const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ success: false, error: "Unable to create Lemon Squeezy checkout.", code: "LEMONSQUEEZY_CHECKOUT_FAILED" });
    expect(JSON.stringify(res.body)).not.toContain("secret-internal-detail");
  });

  it("Lemon 200 without a URL → 502", async () => {
    stubExternal(LEMON, () => jsonResponse({ data: { attributes: {} } }));
    const user = await createUser(db);
    const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "pro" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("LEMONSQUEEZY_CHECKOUT_FAILED");
  });

  it("Lemon unreachable (network error) → 5xx with a generic body", async () => {
    stubExternal(LEMON, () => {
      throw new TypeError("fetch failed");
    });
    const user = await createUser(db);
    const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toMatch(/lemonsqueezy\.com|stack/i);
  });

  it("Lemon returns an HTML error page → 5xx, no crash", async () => {
    stubExternal(LEMON, () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    const user = await createUser(db);
    const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it("Lemon not configured → 503 LEMONSQUEEZY_NOT_CONFIGURED", async () => {
    const saved = process.env.LEMONSQUEEZY_API_KEY;
    process.env.LEMONSQUEEZY_API_KEY = "";
    try {
      const user = await createUser(db);
      const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("LEMONSQUEEZY_NOT_CONFIGURED");
      expect(lemonCalls()).toHaveLength(0);
    } finally {
      process.env.LEMONSQUEEZY_API_KEY = saved;
    }
  });

  it("variant for the pack not configured → 503 LEMONSQUEEZY_VARIANT_MISSING", async () => {
    const saved = process.env.LEMONSQUEEZY_VARIANT_PRO;
    process.env.LEMONSQUEEZY_VARIANT_PRO = "";
    try {
      const user = await createUser(db);
      const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "pro" });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("LEMONSQUEEZY_VARIANT_MISSING");
    } finally {
      process.env.LEMONSQUEEZY_VARIANT_PRO = saved;
    }
  });

  // FINDING-15 (Low): the pending order row is inserted before Lemon is called, so every failed
  // checkout leaves an orphan 'pending' row that nothing ever expires.
  it.fails("a failed checkout does not leave an orphan pending order (FINDING-15)", async () => {
    stubExternal(LEMON, () => jsonResponse({ errors: [{ detail: "nope" }] }, 500));
    const user = await createUser(db);
    await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
    expect(await pendingOrdersFor(user.id)).toHaveLength(0);
  });

  it("a token for a user id that no longer exists fails without calling Lemon", async () => {
    stubLemonOk();
    const token = craftToken({ sub: randomUUID(), email: "deleted@example.test" });
    const res = await request(app).post("/api/billing/checkout").set("Authorization", `Bearer ${token}`).send({ packageId: "starter" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(lemonCalls()).toHaveLength(0);
  });
});
