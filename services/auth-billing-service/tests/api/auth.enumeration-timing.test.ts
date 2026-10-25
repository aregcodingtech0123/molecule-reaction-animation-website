/**
 * SEC-07: register / forgot-password / resend-verification must not reveal whether an account
 * exists — neither by status nor by waiting for the mail provider only when one does.
 *
 * The mail provider (Resend) is stubbed at the network boundary: "hang" never answers, "fail"
 * answers 500. Before the fix, the account-dependent branches awaited the send, so their response
 * time (or status) differed from the no-account branch.
 */
import bcrypt from "bcrypt";
import request from "supertest";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { externalCalls, jsonResponse, stubExternal } from "../../../../scripts/test/network-guard.mjs";
import { createApp } from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { closePool } from "../../src/db/index.js";
import { dummyPasswordHash } from "../../src/services/auth.service.js";
import { freshIp } from "../support/auth";
import { spyConsole } from "../support/console";
import { createTestPool, createUser, uniqueEmail, waitFor } from "../support/db";

const app = createApp();
let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await closePool();
});

const RESEND = "api.resend.com";
const savedKey = process.env.RESEND_API_KEY;
beforeEach(() => {
  spyConsole();
  process.env.RESEND_API_KEY = "re_test_not_a_real_key";
});
afterEach(() => {
  process.env.RESEND_API_KEY = savedKey;
});

const hangMail = () => stubExternal(RESEND, () => new Promise<Response>(() => undefined));
const failMail = () => stubExternal(RESEND, () => jsonResponse({ message: "provider down" }, 500));
const okMail = () => stubExternal(RESEND, () => jsonResponse({ id: "email_1" }, 200));
const resendCalls = () => externalCalls.filter((c: { url: string }) => c.url.includes(RESEND));

/** Fail fast (instead of the 20 s test timeout) when a response waits for the mail provider. */
async function within<T>(ms: number, p: PromiseLike<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no response within ${ms} ms — waiting on the mail provider`)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(p), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const post = (path: string, body: object) => request(app).post(path).set("X-Forwarded-For", freshIp()).send(body);
const profile = { firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10" };

describe("no account-existence signal from mail delivery (SEC-07)", () => {
  it("register answers without waiting for the mail provider, for new and existing emails alike", async () => {
    hangMail();
    const existing = await createUser(db);
    const fresh = await within(3_000, post("/api/auth/register", { email: uniqueEmail("enum-new"), password: "Correct-horse-9", ...profile }));
    const dup = await within(3_000, post("/api/auth/register", { email: existing.email, password: "Correct-horse-9", ...profile }));
    expect([fresh.status, dup.status]).toEqual([200, 200]);
    expect(fresh.body).toEqual(dup.body);
  });

  it("forgot-password answers without waiting for the mail provider, for existing and unknown emails alike", async () => {
    hangMail();
    const existing = await createUser(db);
    const known = await within(3_000, post("/api/auth/forgot-password", { email: existing.email }));
    const unknown = await within(3_000, post("/api/auth/forgot-password", { email: uniqueEmail("enum-none") }));
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(known.body).toEqual(unknown.body);
  });

  it("resend-verification answers without waiting, and identically, for unverified / verified / unknown emails", async () => {
    hangMail();
    const unverified = await createUser(db, { verified: false });
    const verified = await createUser(db, { verified: true });
    const answers = [];
    for (const email of [unverified.email, verified.email, uniqueEmail("enum-none")]) {
      answers.push(await within(3_000, post("/api/auth/resend-verification", { email })));
    }
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(answers.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it("a failing mail provider does not change the answer (resend used to return 502 only for unverified accounts)", async () => {
    failMail();
    const unverified = await createUser(db, { verified: false });
    const res = await post("/api/auth/resend-verification", { email: unverified.email });
    const unknown = await post("/api/auth/resend-verification", { email: uniqueEmail("enum-none") });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(unknown.body);
    await waitFor(async () => (resendCalls().length > 0 ? true : null));
  });

  it("mails are still sent (in the background) when the provider answers", async () => {
    okMail();
    const existing = await createUser(db);
    const res = await post("/api/auth/forgot-password", { email: existing.email });
    expect(res.status).toBe(200);
    await waitFor(async () => (resendCalls().length === 1 ? true : null));
    expect(JSON.parse(String(resendCalls()[0]!.body)).to).toEqual([existing.email]);
  });

  it("the unknown-email login path hashes at the configured bcrypt cost (equal timing to a real check)", async () => {
    const hash = await dummyPasswordHash();
    expect(bcrypt.getRounds(hash)).toBe(env.bcryptRounds);
  });
});
