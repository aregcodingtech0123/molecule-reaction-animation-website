/**
 * Phase 2C step 4.2: when Lemon refuses a checkout, the log gets the status, a fixed category and the name of the field at fault.
 * Lemon's own words never reach it: its `detail` and `title` are provider-controlled, and the request they answer carries the
 * customer's e-mail, the user id, the pending order id and the redirect URL. Responses here are synthetic: the network guard
 * stops any real call. The caller's contract (502, generic body, order marked failed) is what must stay as it was.
 *
 * Output is checked with util.inspect over the raw console arguments, not lines(): JSON.stringify drops an Error's text.
 */
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { externalCalls, jsonResponse, stubExternal } from "../../../../scripts/test/network-guard.mjs";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser } from "../support/db";
import { everythingLogged, payloadOf } from "../support/marked-errors";

const MARKER = "SENSITIVE-LEMON-MARKER-e92c";
const LEMON = "api.lemonsqueezy.com";
const LABEL = "[lemonsqueezy] checkout create failed";
const FAILED = { success: false, error: "Unable to create Lemon Squeezy checkout.", code: "LEMONSQUEEZY_CHECKOUT_FAILED" };

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

/** A JSON:API error with the marker everywhere a provider could put text. */
const markedError = (over: Record<string, unknown> = {}) => ({
  status: "422",
  code: MARKER,
  title: `${MARKER} in title`,
  detail: `${MARKER} in detail`,
  source: { pointer: "/data/attributes/checkout_data/email", parameter: MARKER },
  meta: { nested: { request: { email: `${MARKER}@customer.example`, authorization: `Bearer ${MARKER}` } } },
  ...over,
});

async function checkout(respond: () => Response) {
  stubExternal(LEMON, respond);
  const user = await createUser(db);
  const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
  return { user, res };
}

function expectNothingFromTheProvider(extra: string[] = []) {
  const logged = everythingLogged(logs);
  expect(logged).not.toContain(MARKER);
  expect(logged).not.toContain("in detail");
  expect(logged).not.toContain("Bearer");
  expect(logged).not.toContain(TEST_ENV.LEMONSQUEEZY_API_KEY);
  for (const value of extra) expect(logged).not.toContain(value);
}

describe("a refused checkout: what is logged", () => {
  it("the status, the category and the field; nothing of the provider's text or nested response", async () => {
    const { user, res } = await checkout(() => jsonResponse({ errors: [markedError()], meta: { echo: MARKER }, jsonapi: { version: MARKER } }, 422));
    expect(res.status).toBe(502);
    expect(payloadOf(logs, LABEL)).toEqual({ providerStatus: 422, category: "validation", providerErrorCount: 1, field: "/data/attributes/checkout_data/email" });
    expectNothingFromTheProvider([user.email]);
  });

  it("a detail echoing the customer's real e-mail and user id", async () => {
    const user = await createUser(db);
    stubExternal(LEMON, () => jsonResponse({ errors: [{ detail: `Invalid email ${user.email} for ${user.id}` }] }, 422));
    await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
    const logged = everythingLogged(logs);
    expect(logged).toContain(LABEL);
    expect(logged).not.toContain(user.email);
    expect(logged).not.toContain("Invalid email");
  });

  it("only a title, as the old fallback used it", async () => {
    await checkout(() => jsonResponse({ errors: [{ title: `${MARKER} in title` }] }, 400));
    expect(payloadOf(logs, LABEL)).toEqual({ providerStatus: 400, category: "validation", providerErrorCount: 1, field: null });
    expectNothingFromTheProvider();
  });

  it.each<[number, string]>([
    [400, "validation"],
    [422, "validation"],
    [401, "auth"],
    [403, "auth"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [503, "provider_error"],
    [418, "other"],
  ])("status %i is the category %s", async (status, category) => {
    await checkout(() => jsonResponse({ errors: [markedError()] }, status));
    expect(payloadOf(logs, LABEL)).toMatchObject({ providerStatus: status, category });
    expectNothingFromTheProvider();
  });

  it.each<[string, unknown]>([
    ["a marker in identifier shape", MARKER],
    ["free text", `/data/${MARKER} free text`],
    ["upper case", "/data/ATTRIBUTES/EMAIL"],
    ["an e-mail address", "/data/attributes/someone@customer.example"],
    ["no leading slash", "data/attributes/email"],
    ["a very long path", `/${"a".repeat(200)}`],
    ["too many segments", "/a/b/c/d/e/f/g/h/i"],
    ["not a string", { nested: MARKER }],
  ])("a pointer that is not a plain field path is dropped: %s", async (_label, pointer) => {
    await checkout(() => jsonResponse({ errors: [markedError({ source: { pointer } })] }, 422));
    expect(payloadOf(logs, LABEL)).toMatchObject({ field: null });
    expectNothingFromTheProvider(["customer.example", "ATTRIBUTES"]);
  });

  it.each<[string, unknown, number]>([
    ["no errors field", { message: MARKER }, 0],
    ["an empty list", { errors: [] }, 0],
    ["errors that are a string", { errors: MARKER }, 0],
    ["errors that are an object", { errors: { detail: MARKER } }, 0],
    ["a list of strings", { errors: [MARKER, MARKER] }, 2],
    ["a list holding null", { errors: [null] }, 1],
  ])("a body of another shape, %s: still a 502, and nothing of it logged", async (_label, body, count) => {
    const { res } = await checkout(() => jsonResponse(body, 500));
    expect(res.status).toBe(502);
    expect(payloadOf(logs, LABEL)).toEqual({ providerStatus: 500, category: "provider_error", providerErrorCount: count, field: null });
    expectNothingFromTheProvider();
  });
});

describe("the caller's contract is what it was", () => {
  const pendingStatus = async (userId: string) => (await db.query(`SELECT status FROM pending_checkout_orders WHERE user_id = $1`, [userId])).rows.map((r) => r.status);

  it("502 with the generic body, nothing of the provider's text, and the order marked failed", async () => {
    const { user, res } = await checkout(() => jsonResponse({ errors: [markedError()] }, 422));
    expect(res.status).toBe(502);
    expect(res.body).toEqual(FAILED);
    expect(res.text).not.toContain(MARKER);
    expect(await pendingStatus(user.id)).toEqual(["failed"]);
  });

  it("a response that is not JSON keeps its generic 500; the text it holds is logged by nothing", async () => {
    const { user, res } = await checkout(() => new Response(`<html>${MARKER}</html>`, { status: 502 }));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Internal server error.", code: "INTERNAL_ERROR" });
    expect(await pendingStatus(user.id)).toEqual(["failed"]);
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("the provider out of reach keeps its generic 500; the text it holds is logged by nothing", async () => {
    const { user, res } = await checkout(() => {
      throw new TypeError(`fetch failed ${MARKER}`);
    });
    expect(res.status).toBe(500);
    expect(await pendingStatus(user.id)).toEqual(["failed"]);
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("success is untouched: the same URL back, no failure logged, and the request is built and authenticated as before", async () => {
    const url = "https://moleculestudio.lemonsqueezy.com/checkout/buy/test-123";
    const { user, res } = await checkout(() => jsonResponse({ data: { type: "checkouts", id: "chk_1", attributes: { url } } }, 201));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ provider: "lemonsqueezy", checkoutUrl: url });
    expect(everythingLogged(logs)).not.toContain(LABEL);

    const call = externalCalls.at(-1) as { url: string; method: string; headers: Record<string, string>; body: string };
    expect(call.url).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe(`Bearer ${TEST_ENV.LEMONSQUEEZY_API_KEY}`);
    const attributes = JSON.parse(call.body).data.attributes;
    expect(attributes.checkout_data.email).toBe(user.email);
    expect(attributes.checkout_data.custom).toMatchObject({ user_id: user.id, package_id: "starter" });
  });
});
