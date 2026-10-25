/**
 * SEC-02 context (body-parser GHSA-27r3-jxmh-p828): compressed request bodies are parsed before
 * routing on the publicly reachable Express service. Resilience smoke check: a gzip body with
 * trailing bytes is answered on every parser path and the service keeps serving.
 *
 * Note: this payload did NOT reproduce the advisory's crash on body-parser 2.3.0, so it is not
 * the regression guard for SEC-02 — that is tests/unit/dependency-floors.test.ts (fails below
 * the patched versions).
 */
import { gzipSync } from "node:zlib";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { spyConsole } from "../support/console";

const app = createApp();
afterAll(async () => {
  await closePool();
});

const uncaught: unknown[] = [];
const onUncaught = (err: unknown) => uncaught.push(err);
beforeEach(() => {
  spyConsole();
  uncaught.length = 0;
  process.on("uncaughtException", onUncaught);
});
afterEach(() => {
  process.off("uncaughtException", onUncaught);
});

const poisoned = Buffer.concat([gzipSync(Buffer.from(JSON.stringify({ email: "a@example.test", password: "x" }))), Buffer.from("trailing-bytes")]);
/** Let the decoder see the trailing bytes and any stream error surface. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("compressed request bodies with trailing bytes (SEC-02)", () => {
  it.each([
    ["global JSON parser (login)", "/api/auth/login"],
    ["global JSON parser, unmatched route", "/api/definitely-not-a-route"],
    ["webhook raw-body parser", "/api/billing/webhooks/lemonsqueezy"],
  ])("%s: answered without an uncaught exception; the service keeps serving", async (_label, path) => {
    const res = await request(app)
      .post(path)
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .set("X-Signature", "0".repeat(64))
      .send(poisoned);
    await settle();

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
    expect(uncaught).toEqual([]);
    expect((await request(app).get("/health")).status).toBeLessThan(600);
  });
});
