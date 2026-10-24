/**
 * FINDING-34 (Google pre-account takeover) and session versioning (FINDING-18).
 */
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { craftToken, freshIp } from "../support/auth";
import { spyConsole } from "../support/console";
import { createTestPool, uniqueEmail } from "../support/db";
import { googleIdToken, stubGoogleCerts } from "../support/google";

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
  stubGoogleCerts();
});

const ATTACKER_PASSWORD = "Attacker-pass-1";
const profile = { firstName: "Mal", lastName: "Lory", dateOfBirth: "1990-01-01" };
const post = (path: string, body: object) => request(app).post(path).set("X-Forwarded-For", freshIp()).send(body);
const me = (token: string) => request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

/** The attack: register the victim's address before they ever arrive, and keep a session. */
async function attackerPreRegisters(victimEmail: string) {
  expect((await post("/api/auth/register", { email: victimEmail, password: ATTACKER_PASSWORD, ...profile })).status).toBe(200);
  const login = await post("/api/auth/login", { email: victimEmail, password: ATTACKER_PASSWORD });
  expect(login.status).toBe(200);
  await post("/api/auth/forgot-password", { email: victimEmail }); // leaves a reset token behind too
  return { attackerToken: login.body.data.token as string, userId: login.body.data.user.id as string };
}

describe("Google sign-in vs. an UNVERIFIED password account with the same email (FINDING-34)", () => {
  it("the Google user takes the account over: old password dead, old sessions revoked, pending tokens deleted", async () => {
    const email = uniqueEmail("victim");
    const { attackerToken, userId } = await attackerPreRegisters(email);
    expect((await me(attackerToken)).status).toBe(200);

    const victim = await post("/api/auth/google", { idToken: googleIdToken({ email }) });
    expect(victim.status).toBe(200);
    expect(victim.body.data.user).toMatchObject({ id: userId, isVerified: true });

    // The attacker's password no longer works…
    expect((await post("/api/auth/login", { email, password: ATTACKER_PASSWORD })).status).toBe(401);
    // …nor does the session they already held.
    const stale = await me(attackerToken);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe("TOKEN_REVOKED");
    // …and no verification / reset link they may have triggered can be used.
    const tokens = await db.query(
      `SELECT (SELECT count(*) FROM verification_tokens WHERE user_id = $1)::int AS v,
              (SELECT count(*) FROM password_reset_tokens WHERE user_id = $1)::int AS r`,
      [userId],
    );
    expect(tokens.rows[0]).toEqual({ v: 0, r: 0 });

    // The real owner's Google session works.
    expect((await me(victim.body.data.token)).status).toBe(200);
  });

  it("the takeover is logged (without secrets) for audit", async () => {
    const logs = spyConsole();
    const email = uniqueEmail("victim");
    const { userId } = await attackerPreRegisters(email);
    await post("/api/auth/google", { idToken: googleIdToken({ email }) });
    const line = logs.lines().find((l) => l.includes("took over an unverified password account"));
    expect(line).toContain(userId);
    expect(line).not.toMatch(/\$2[aby]\$|password_hash/);
  });

  it("a VERIFIED password account is linked without touching its password or sessions", async () => {
    const email = uniqueEmail("owner");
    await post("/api/auth/register", { email, password: ATTACKER_PASSWORD, ...profile });
    await db.query(`UPDATE users SET is_verified = true WHERE email = $1`, [email]);
    const login = await post("/api/auth/login", { email, password: ATTACKER_PASSWORD });

    const google = await post("/api/auth/google", { idToken: googleIdToken({ email }) });
    expect(google.body.data.message).toBe("Google account linked.");
    expect((await post("/api/auth/login", { email, password: ATTACKER_PASSWORD })).status).toBe(200);
    expect((await me(login.body.data.token)).status).toBe(200);
  });

  it("the takeover still grants the signup bonus exactly once", async () => {
    const email = uniqueEmail("victim");
    const { userId } = await attackerPreRegisters(email);
    await post("/api/auth/google", { idToken: googleIdToken({ email }) });
    await post("/api/auth/google", { idToken: googleIdToken({ email }) });
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM credit_ledger_transactions WHERE user_id = $1 AND transaction_type = 'SIGNUP_BONUS'`,
      [userId],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("session versioning (tv claim)", () => {
  it("issued tokens carry tv = users.token_version", async () => {
    const email = uniqueEmail();
    await post("/api/auth/register", { email, password: ATTACKER_PASSWORD, ...profile });
    const login = await post("/api/auth/login", { email, password: ATTACKER_PASSWORD });
    expect((jwt.decode(login.body.data.token) as jwt.JwtPayload).tv).toBe(0);
  });

  it("a token without tv (issued before this release) is rejected everywhere → one-time logout", async () => {
    const { rows } = await db.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id::text`, [uniqueEmail()]);
    const legacy = craftToken({ sub: rows[0].id, tv: undefined });
    for (const path of ["/api/auth/me", "/api/billing/balance", "/api/users/profile"]) {
      const res = await request(app).get(path).set("Authorization", `Bearer ${legacy}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_TOKEN");
    }
  });

  it.each([[-1], [1.5], ["0"]])("a malformed tv claim %j is rejected", async (tv) => {
    const res = await me(craftToken({ sub: randomUUID(), tv }));
    expect(res.status).toBe(401);
  });

  it("bumping token_version revokes older tokens; a fresh login works", async () => {
    const email = uniqueEmail();
    await post("/api/auth/register", { email, password: ATTACKER_PASSWORD, ...profile });
    const first = (await post("/api/auth/login", { email, password: ATTACKER_PASSWORD })).body.data.token;
    await db.query(`UPDATE users SET token_version = token_version + 1 WHERE email = $1`, [email]);
    expect((await me(first)).body.code).toBe("TOKEN_REVOKED");
    const second = (await post("/api/auth/login", { email, password: ATTACKER_PASSWORD })).body.data.token;
    expect((jwt.decode(second) as jwt.JwtPayload).tv).toBe(1);
    expect((await me(second)).status).toBe(200);
  });
});
