/**
 * F-1 / G-R1 (owner decisions): in WEBHOOK_INGEST_MODE=external the main service's legacy webhook route answers 503 and stores,
 * parses and processes nothing; in legacy mode (the default) it behaves as before. Also /health in external mode (F-4). Real HTTP
 * app over mocks: the inbox functions are spies and the database is scripted, so this proves what the route calls, not database
 * behaviour.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spyConsole } from "../support/console";
import { orderCreatedEvent, sign, signedBody } from "../support/lemon";

const db = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("../../src/db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/index.js")>()),
  pool: {
    query: async (sql: string) => {
      db.calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
  },
}));

const inbox = vi.hoisted(() => ({
  store: vi.fn(async () => ({ id: "7", status: "pending", inserted: true })),
  process: vi.fn(async () => "processed"),
}));

vi.mock("../../src/services/webhookInbox.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/webhookInbox.service.js")>()),
  storeWebhookEvent: inbox.store,
  processStoredWebhookEvent: inbox.process,
}));

const { createApp } = await import("../../src/app.js");
const { resetConsumerReadiness } = await import("../../src/services/v8Consumer.service.js");

const PATH = "/api/billing/webhooks/lemonsqueezy";
const REFUSED = { error: "Webhook endpoint not available here" };

beforeEach(() => {
  db.calls = [];
  inbox.store.mockClear();
  inbox.process.mockClear();
  resetConsumerReadiness();
  spyConsole();
});
afterEach(() => vi.unstubAllEnvs());

const external = () => vi.stubEnv("WEBHOOK_INGEST_MODE", "external");
const post = (raw: string | Buffer, signature?: string, type = "application/json") => {
  const req = request(createApp()).post(PATH).set("Content-Type", type);
  if (signature !== undefined) req.set("X-Signature", signature);
  return req.send(raw);
};

describe("legacy mode (the default) keeps the route", () => {
  it.each([[undefined], [""], ["legacy"], ["true"], ["1"], ["externalx"]])("WEBHOOK_INGEST_MODE=%s: a valid delivery is stored, acknowledged and processed", async (mode) => {
    if (mode !== undefined) vi.stubEnv("WEBHOOK_INGEST_MODE", mode);
    const { raw, signature } = signedBody(orderCreatedEvent());
    const res = await post(raw, signature);
    expect(res.status).toBe(200);
    expect(inbox.store).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(inbox.process).toHaveBeenCalledWith("7"));
  });

  it("legacy mode still rejects a bad signature with 401 and stores nothing", async () => {
    const { raw } = signedBody(orderCreatedEvent());
    expect((await post(raw, sign(raw, "another-secret"))).status).toBe(401);
    expect(inbox.store).not.toHaveBeenCalled();
  });
});

describe("external mode: 503, nothing stored, nothing processed", () => {
  it.each(["external", "EXTERNAL", "  External  "])("mode %j refuses a valid, signed delivery", async (mode) => {
    vi.stubEnv("WEBHOOK_INGEST_MODE", mode);
    const { raw, signature } = signedBody(orderCreatedEvent());
    const res = await post(raw, signature);
    expect(res.status).toBe(503);
    expect(res.body).toEqual(REFUSED);
    expect(res.headers["retry-after"]).toBe("5");
  });

  it("the storage function and the legacy fulfilment are never called, and the database is not touched", async () => {
    external();
    const { raw, signature } = signedBody(orderCreatedEvent());
    await post(raw, signature);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(inbox.store).not.toHaveBeenCalled();
    expect(inbox.process).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it.each<[string, () => { raw: string | Buffer; signature?: string; type?: string }]>([
    ["no signature", () => ({ raw: signedBody(orderCreatedEvent()).raw })],
    ["a wrong signature", () => ({ raw: "{}", signature: sign("{}", "another-secret") })],
    ["a body that is not JSON", () => ({ raw: "{", signature: sign("{") })],
    ["a JSON array", () => ({ raw: "[]", signature: sign("[]") })],
    ["an empty body", () => ({ raw: "", signature: sign("") })],
    ["a body of another content type", () => ({ raw: "a=b", signature: sign("a=b"), type: "application/x-www-form-urlencoded" })],
    ["a body over the 256 kB limit", () => ({ raw: JSON.stringify({ pad: "x".repeat(300_000) }), signature: "zz" })],
  ])("%s does not bypass the refusal", async (_label, make) => {
    external();
    const { raw, signature, type } = make();
    const res = await post(raw, signature, type);
    expect(res.status).toBe(503);
    expect(res.body).toEqual(REFUSED);
    expect(inbox.store).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it("the answer exposes no payload, order id, e-mail, secret or error detail", async () => {
    external();
    const event = orderCreatedEvent({ email: "secret.buyer@example.test" });
    const { raw, signature } = signedBody(event);
    const res = await post(raw, signature);
    const everything = JSON.stringify({ body: res.body, headers: res.headers, text: res.text });
    for (const leak of [event.data.id, "secret.buyer@example.test", signature, "stack", "Error", "database"]) {
      expect(everything).not.toContain(leak);
    }
  });

  it("the refusal is logged without the payload", async () => {
    external();
    const logs = spyConsole();
    const { raw, signature } = signedBody(orderCreatedEvent({ email: "secret.buyer@example.test" }));
    await post(raw, signature);
    const text = logs.lines().join("\n");
    expect(text).toMatch(/Refused \(503\)/);
    expect(text).not.toContain("secret.buyer@example.test");
  });

  it("other routes are unaffected by the mode", async () => {
    external();
    const res = await request(createApp()).get("/health");
    expect([200, 503]).toContain(res.status);
  });
});

describe("/health reports the webhook consumer in external mode only (F-4)", () => {
  it("legacy mode: no consumer field", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.body).not.toHaveProperty("webhookConsumer");
  });

  it("external mode, schema not checked or not ready: not_ready and degraded, with fixed sentences", async () => {
    external();
    const res = await request(createApp()).get("/health");
    expect(res.body.webhookConsumer).toBe("not_ready");
    expect(res.body.status).toBe("degraded");
    expect(res.body.webhookConsumerProblems).toEqual(["not checked yet"]);
  });
});
