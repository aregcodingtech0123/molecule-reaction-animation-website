/**
 * Phase 2C step 4.1, findings D and E: what reaches the log when mail fails. Provider responses here are synthetic (the network
 * guard stops any real call to Resend) and carry a marker and the recipient in every field. Only the provider's status and its
 * error code may survive. Mail stays best effort: no response, credit or account state depends on it.
 */
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { externalCalls, jsonResponse, stubExternal } from "../../../../scripts/test/network-guard.mjs";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { freshIp } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, uniqueEmail, waitFor } from "../support/db";
import { newOrderId, orderCreatedEvent, signedBody } from "../support/lemon";
import { everythingLogged, payloadOf, raiseOnPoolQuery } from "../support/marked-errors";

const MARKER = "SENSITIVE-MAIL-MARKER-3b6f";
const RESEND = "api.resend.com";
const API_KEY = "re_test_APIKEYMARKER_not_a_real_key";

const app = createApp();
let db: pg.Pool;
let logs: ConsoleSpies;
const savedKey = process.env.RESEND_API_KEY;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await closePool();
});
beforeEach(() => {
  logs = spyConsole();
  process.env.RESEND_API_KEY = API_KEY;
});
afterEach(() => {
  process.env.RESEND_API_KEY = savedKey;
});

/** Resend's error shape, with the marker and the recipient everywhere a provider could echo them. */
const providerRefusal = (status = 422, name = "validation_error") => () =>
  jsonResponse(
    {
      statusCode: status,
      name,
      message: `${MARKER} message about ${MARKER}@recipient.example`,
      response: { data: { to: [`${MARKER}@recipient.example`], subject: MARKER }, headers: { authorization: `Bearer ${MARKER}` } },
    },
    status,
  );

function expectNothingSensitive(extra: string[] = []) {
  const logged = everythingLogged(logs);
  expect(logged).not.toContain(MARKER);
  expect(logged).not.toContain("APIKEYMARKER");
  expect(logged).not.toContain("Bearer");
  for (const value of extra) expect(logged).not.toContain(value);
}

const post = (path: string, body: object) => request(app).post(path).set("X-Forwarded-For", freshIp()).send(body);
const profile = { firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10" };

describe("account mail: register, resend and password reset (auth.service, lib/email)", () => {
  it("register: the same answer as ever; the provider's status and code are logged, nothing else of its response", async () => {
    stubExternal(RESEND, providerRefusal());
    const email = uniqueEmail("mail-fail");
    const res = await post("/api/auth/register", { email, password: "Correct-horse-9", ...profile });
    expect(res.status).toBe(200);
    await logs.waitForLine("[auth] Failed to send verification email");

    expect(payloadOf(logs, "[auth] Failed to send verification email")).toMatchObject({ errorName: "EmailProviderError", providerStatus: 422, providerCode: "validation_error" });
    expect(payloadOf(logs, "[email] Resend API error")).toEqual({ providerStatus: 422, providerCode: "validation_error" });
    expectNothingSensitive([email]);
  });

  it("forgot-password: identical answers for known and unknown addresses even though the mail failed, and the reset link is not logged", async () => {
    stubExternal(RESEND, providerRefusal(500, "application_error"));
    const existing = await createUser(db);
    const known = await post("/api/auth/forgot-password", { email: existing.email });
    const unknown = await post("/api/auth/forgot-password", { email: uniqueEmail("none") });
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(known.body).toEqual(unknown.body);
    await logs.waitForLine("[auth] Failed to send password reset email");

    expect(payloadOf(logs, "[auth] Failed to send password reset email")).toMatchObject({ providerStatus: 500, providerCode: "application_error" });
    expectNothingSensitive([existing.email, "reset-password?", "token="]);
  });

  it.each<[string, () => Response, number]>([
    ["a body that is not JSON", () => new Response(`<html>${MARKER}</html>`, { status: 502 }), 502],
    ["an empty body", () => new Response("", { status: 503 }), 503],
    ["JSON that is not an object", () => jsonResponse(MARKER, 500), 500],
    ["an error code that is really free text", () => jsonResponse({ name: `${MARKER} free text` }, 400), 400],
    ["an error code with a marker in identifier shape", () => jsonResponse({ name: MARKER }, 400), 400],
    ["an error code that is not a string", () => jsonResponse({ name: { nested: MARKER } }, 400), 400],
  ])("%s: the status stays, the code is null", async (_label, respond, status) => {
    stubExternal(RESEND, respond);
    await post("/api/auth/register", { email: uniqueEmail("mail-odd"), password: "Correct-horse-9", ...profile });
    await logs.waitForLine("[auth] Failed to send verification email");
    expect(payloadOf(logs, "[email] Resend API error")).toEqual({ providerStatus: status, providerCode: null });
    expectNothingSensitive();
  });

  it("the provider out of reach: the kind of error, and no text from it", async () => {
    stubExternal(RESEND, () => {
      throw new TypeError(`fetch failed ${MARKER}`, { cause: new Error(`connect ECONNREFUSED ${MARKER}`) });
    });
    const res = await post("/api/auth/register", { email: uniqueEmail("mail-net"), password: "Correct-horse-9", ...profile });
    expect(res.status).toBe(200);
    await logs.waitForLine("[auth] Failed to send verification email");
    expect(payloadOf(logs, "[auth] Failed to send verification email")).toMatchObject({ errorName: "TypeError" });
    expectNothingSensitive();
  });

  it("delivery that works logs no failure", async () => {
    stubExternal(RESEND, () => jsonResponse({ id: "email_1" }, 200));
    await post("/api/auth/register", { email: uniqueEmail("mail-ok"), password: "Correct-horse-9", ...profile });
    await waitFor(async () => externalCalls.some((c: { url: string }) => c.url.includes(RESEND)));
    expect(everythingLogged(logs)).not.toContain("Failed to send");
  });
});

describe("the purchase receipt (webhook.service, email.service)", () => {
  async function purchase() {
    const buyer = await createUser(db);
    const orderId = newOrderId();
    const { raw, signature } = signedBody(orderCreatedEvent({ orderId, email: buyer.email, customData: { user_id: buyer.id, package_id: "starter" } }));
    const res = await request(app).post("/api/billing/webhooks/lemonsqueezy").set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
    return { buyer, orderId, res };
  }

  it("the provider refuses: still 200 and credited; status and code are logged, nothing else of its response", async () => {
    stubExternal(RESEND, providerRefusal());
    const { buyer, orderId, res } = await purchase();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    await logs.waitForLine("Purchase receipt failed (credits already allocated)");

    expect(await balanceOf(db, buyer.id)).toBe(50);
    expect(payloadOf(logs, "Purchase receipt failed (credits already allocated)")).toMatchObject({
      orderId,
      userId: buyer.id,
      errorName: "EmailProviderError",
      providerStatus: 422,
      providerCode: "validation_error",
    });
    expect(payloadOf(logs, "[email] Resend API error")).toEqual({ providerStatus: 422, providerCode: "validation_error" });
    expectNothingSensitive([buyer.email]);
  });

  it("the provider's whole response is not printed by anything, in a mode where the Resend SDK would have printed it", async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "development"; // Also what an unset NODE_ENV means to the SDK: its check is !== "production".
    try {
      stubExternal(RESEND, providerRefusal());
      const { buyer } = await purchase();
      await logs.waitForLine("Purchase receipt failed (credits already allocated)");
      expect(everythingLogged(logs)).not.toContain("[Resend API Error]");
      expectNothingSensitive([buyer.email]);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it("delivery that works: the same request as before, to the same endpoint, and it is logged as sent", async () => {
    let sent: { url: URL; init: RequestInit } | undefined;
    stubExternal(RESEND, (url: URL, init: RequestInit) => {
      sent = { url, init };
      return jsonResponse({ id: "email_1" }, 200);
    });
    const { buyer, orderId } = await purchase();
    await logs.waitForLine("Purchase receipt sent");

    expect(String(sent!.url)).toBe("https://api.resend.com/emails");
    expect(sent!.init.method).toBe("POST");
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(sent!.init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["from", "html", "subject", "text", "to"]);
    expect(body).toMatchObject({ from: process.env.SENDER_EMAIL, to: [buyer.email], subject: "MoleculeStudio receipt — +50 credits" });
    expect(body.text).toContain(orderId);
    expect(everythingLogged(logs)).not.toContain("Purchase receipt failed");
  });

  it("the provider out of reach: the same, with no status to report", async () => {
    stubExternal(RESEND, () => {
      throw new TypeError(`fetch failed ${MARKER}`);
    });
    const { buyer, res } = await purchase();
    expect(res.status).toBe(200);
    await logs.waitForLine("Purchase receipt failed (credits already allocated)");
    expect(await balanceOf(db, buyer.id)).toBe(50);
    expect(payloadOf(logs, "Purchase receipt failed (credits already allocated)")).toMatchObject({ providerStatus: null });
    expectNothingSensitive([buyer.email]);
  });

  it("a real database error while loading the recipient: still 200 and credited; SQLSTATE logged, no text", async () => {
    stubExternal(RESEND, () => jsonResponse({ id: "email_1" }, 200));
    const broken = raiseOnPoolQuery(/FROM users u\s/, MARKER);
    try {
      const { buyer, orderId, res } = await purchase();
      expect(res.status).toBe(200);
      await logs.waitForLine("Purchase receipt failed (credits already allocated)");
      expect(await balanceOf(db, buyer.id)).toBe(50);
      expect(payloadOf(logs, "Purchase receipt failed (credits already allocated)")).toMatchObject({ orderId, sqlstate: "XX000", severity: "ERROR" });
    } finally {
      broken.mockRestore();
    }
    expectNothingSensitive();
  });
});
