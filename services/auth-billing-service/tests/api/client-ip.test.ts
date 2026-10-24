/**
 * Client IP resolution (FINDING-04 + X-Forwarded-For spoofing). Own file: the rate limiters keep
 * module-level state, and this suite needs the DEFAULT TRUST_PROXY_HOPS (0) while the other suites
 * emulate one proxy hop.
 */
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { spyConsole } from "../support/console";
import { createTestPool, uniqueEmail } from "../support/db";
import { googleIdToken, stubGoogleCerts } from "../support/google";

let app: ReturnType<typeof import("../../src/app.js").createApp>;
let db: pg.Pool;
beforeAll(async () => {
  process.env.TRUST_PROXY_HOPS = "0"; // production default: the service is publicly reachable
  const { createApp } = await import("../../src/app.js");
  app = createApp();
  db = createTestPool();
});
afterAll(async () => {
  process.env.TRUST_PROXY_HOPS = TEST_ENV.TRUST_PROXY_HOPS;
  await db.end();
  await closePool();
});
beforeEach(() => {
  spyConsole();
});

const body = () => ({ email: uniqueEmail("ip"), password: "Client-ip-pass-1", firstName: "I", lastName: "P", dateOfBirth: "1990-01-01" });
const signupIp = async (email: string) =>
  (await db.query(`SELECT host(signup_ip) AS ip FROM users WHERE email = $1`, [email])).rows[0]?.ip ?? null;

describe("direct callers cannot choose their own rate-limit bucket (TRUST_PROXY_HOPS=0)", () => {
  it("a forged X-Forwarded-For is ignored: 4 sign-ups with 4 different forged addresses → the 4th is throttled", async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 4; i++) {
      statuses.push((await request(app).post("/api/auth/register").set("X-Forwarded-For", `198.18.0.${i}`).send(body())).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("X-Client-IP without the internal key is ignored too", async () => {
    // Same socket address as above → the bucket is already exhausted.
    const res = await request(app).post("/api/auth/register").set("X-Client-IP", "198.18.1.1").send(body());
    expect(res.status).toBe(429);
  });

  it("X-Client-IP with a WRONG internal key is ignored", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Client-IP", "198.18.1.2")
      .set("X-Internal-Service-Key", "wrong-key-0123456789-abcdefghijklmnopqrstuv")
      .send(body());
    expect(res.status).toBe(429);
  });
});

describe("the BFF's X-Client-IP is honoured only with the internal key", () => {
  const fromBff = (ip: string) =>
    request(app).post("/api/auth/register").set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET).set("X-Client-IP", ip);

  it("each end user gets their own bucket (FINDING-04)", async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 4; i++) statuses.push((await fromBff(`203.0.113.${i}`).send(body())).status);
    expect(statuses).toEqual([200, 200, 200, 200]);
  });

  it("…and the per-user limit still applies to the same end user", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await fromBff("203.0.113.77").send(body())).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("signup_ip records the end user's address from the BFF", async () => {
    const b = body();
    await fromBff("203.0.113.88").send(b);
    expect(await signupIp(b.email)).toBe("203.0.113.88");
  });

  it("an invalid X-Client-IP value is ignored even with the key (falls back to the socket address)", async () => {
    const b = body();
    await request(app)
      .post("/api/auth/register")
      .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
      .set("X-Client-IP", "not-an-ip; DROP TABLE users")
      .send(b);
    const recorded = await signupIp(b.email);
    expect(recorded === null || /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(recorded)).toBe(true);
  });

  it("signup_ip of a direct caller is the socket address, never a forged header value", async () => {
    // Google sign-in creates users too and has its own limiter bucket, so this request is not throttled.
    stubGoogleCerts();
    const email = uniqueEmail("direct");
    const res = await request(app).post("/api/auth/google").set("X-Forwarded-For", "6.6.6.6").send({ idToken: googleIdToken({ email }) });
    expect(res.status).toBe(200);
    const recorded = await signupIp(email);
    expect(recorded).not.toBe("6.6.6.6");
    expect(recorded).toMatch(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/);
  });
});
