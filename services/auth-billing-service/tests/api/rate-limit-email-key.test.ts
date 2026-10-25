/**
 * SEC-06: the login and email-action limiters key on `ip + email`. The service trims and
 * lower-cases the email before looking the account up, so the limiter key must be built from the
 * same normalised value — otherwise " victim@x", "victim@x " … each get a fresh bucket for the same
 * account (unlimited password guesses / reset mails per IP).
 */
import request from "supertest";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { freshIp } from "../support/auth";
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

/** Same account, spelled differently: whitespace and case only. */
function spellings(email: string): string[] {
  const upper = email.toUpperCase();
  return [email, ` ${email}`, `${email} `, `\t${email}`, `${upper}`, ` ${upper} `, `${email}\n`, `  ${email}  `];
}

describe("email-keyed rate limits use the normalised email (SEC-06)", () => {
  it("login: the 6th attempt for one account from one IP is refused, whatever the spelling", async () => {
    const user = await createUser(db);
    const ip = freshIp();
    const statuses: number[] = [];
    for (const email of spellings(user.email)) {
      const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email, password: "Wrong-pass-1" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });

  it("forgot-password: the 6th request for one address from one IP is refused, whatever the spelling", async () => {
    const user = await createUser(db);
    const ip = freshIp();
    const statuses: number[] = [];
    for (const email of spellings(user.email)) {
      const res = await request(app).post("/api/auth/forgot-password").set("X-Forwarded-For", ip).send({ email });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });

  it("different accounts from the same IP still have separate buckets", async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) {
      const user = await createUser(db);
      for (let j = 0; j < 5; j++) {
        const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: user.email, password: "Wrong-pass-1" });
        expect(res.status).toBe(401);
      }
    }
  });

  it("a non-string email does not crash the key builder (400 from validation, not 500)", async () => {
    const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", freshIp()).send({ email: { $ne: "" }, password: "x" });
    expect(res.status).toBe(400);
  });
});
