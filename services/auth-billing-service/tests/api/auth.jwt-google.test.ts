import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { craftToken, freshIp, tokenFor, unsignedToken } from "../support/auth";
import { spyConsole } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, uniqueEmail } from "../support/db";
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
});

const me = (authorization?: string) => {
  const r = request(app).get("/api/auth/me");
  return authorization === undefined ? r : r.set("Authorization", authorization);
};

describe("JWT validation (requireAuth)", () => {
  it("accepts a valid token and /me reports the verification status", async () => {
    const u = await createUser(db, { verified: false });
    const res = await me(`Bearer ${tokenFor(u)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ userId: u.id, email: u.email, isVerified: false });
  });

  it.each([
    ["missing header", undefined, "UNAUTHORIZED"],
    ["empty bearer", "Bearer ", "UNAUTHORIZED"],
    ["wrong scheme", "Basic dXNlcjpwYXNz", "UNAUTHORIZED"],
    ["garbage token", "Bearer not.a.jwt", "INVALID_TOKEN"],
  ])("%s → 401 %s", async (_l, header, code) => {
    const res = await me(header);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(code);
  });

  it.each([
    ["expired", () => craftToken({}, { expiresIn: -10 })],
    ["wrong secret", () => craftToken({}, { secret: "another-secret-that-is-long-enough-123" })],
    ["wrong issuer", () => craftToken({}, { issuer: "evil-issuer" })],
    ["wrong audience", () => craftToken({}, { audience: "other-api" })],
    ["HS512 instead of HS256", () => craftToken({}, { algorithm: "HS512" })],
    ["alg: none", () => unsignedToken({ sub: randomUUID(), email: "x@example.test" })],
    ["missing jti", () => craftToken({}, { jwtid: null })],
    ["missing email", () => jwt.sign({ sub: randomUUID() }, "test-only-jwt-secret-7f3c9a1e5b2d4c6e8a0b", { issuer: "moleculestudio-auth-billing", audience: "moleculestudio-api", jwtid: randomUUID(), expiresIn: 60 })],
  ])("%s → 401 INVALID_TOKEN", async (_l, make) => {
    const res = await me(`Bearer ${make()}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("a payload tampered after signing (sub swapped) is rejected", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    const [h, p, s] = tokenFor(a).split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    payload.sub = b.id;
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
    const res = await me(`Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("a valid token for a user that no longer exists → 404 on /me", async () => {
    const res = await me(`Bearer ${craftToken({ sub: randomUUID(), email: "gone@example.test" })}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("USER_NOT_FOUND");
  });

  it("errors never echo the token or a stack trace", async () => {
    const t = craftToken({}, { secret: "another-secret-that-is-long-enough-123" });
    const res = await me(`Bearer ${t}`);
    expect(JSON.stringify(res.body)).not.toContain(t);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules/);
  });
});

describe("logout / revocation", () => {
  it("revokes exactly the presented token until its natural expiry; other sessions survive", async () => {
    const u = await createUser(db);
    const t1 = tokenFor(u);
    const t2 = tokenFor(u);

    const out = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${t1}`);
    expect(out.status).toBe(200);
    expect(out.body.data).toEqual({ message: "Logged out." });

    const revoked = await me(`Bearer ${t1}`);
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe("TOKEN_REVOKED");
    expect((await me(`Bearer ${t2}`)).status).toBe(200);

    const { jti, exp } = jwt.decode(t1) as jwt.JwtPayload;
    const { rows } = await db.query(`SELECT expires_at FROM revoked_tokens WHERE jti = $1`, [jti]);
    expect(rows[0].expires_at.getTime()).toBe(exp! * 1000);
  });

  it("revocation is enforced from the database, not only the in-process cache", async () => {
    const u = await createUser(db);
    const t = tokenFor(u);
    const { jti, exp } = jwt.decode(t) as jwt.JwtPayload;
    // Revoked by "another instance": row exists, this process's cache never saw it.
    await db.query(`INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, to_timestamp($2))`, [jti, exp]);
    expect((await me(`Bearer ${t}`)).body.code).toBe("TOKEN_REVOKED");
  });

  it("revocation applies to billing routes too", async () => {
    const u = await createUser(db, { balance: 5 });
    const t = tokenFor(u);
    await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${t}`);
    expect((await request(app).get("/api/billing/balance").set("Authorization", `Bearer ${t}`)).status).toBe(401);
  });

  it("double logout is idempotent", async () => {
    const u = await createUser(db);
    const t = tokenFor(u);
    expect((await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${t}`)).status).toBe(200);
    expect((await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${t}`)).status).toBe(200);
  });

  it.each([
    ["no token", undefined, 401],
    ["expired token", `Bearer ${craftToken({}, { expiresIn: -5 })}`, 401],
    ["forged token", `Bearer ${craftToken({}, { secret: "x".repeat(40) })}`, 401],
  ])("logout with %s → %i", async (_l, header, status) => {
    const r = request(app).post("/api/auth/logout");
    const res = await (header ? r.set("Authorization", header) : r);
    expect(res.status).toBe(status);
  });
});

describe("POST /api/auth/google", () => {
  const google = (idToken: unknown, ip = freshIp()) =>
    request(app).post("/api/auth/google").set("X-Forwarded-For", ip).send({ idToken });

  beforeEach(() => {
    stubGoogleCerts();
  });

  it("first sign-in creates a verified user, links the Google subject, and grants the bonus once", async () => {
    const email = uniqueEmail("g");
    const sub = `g-${randomUUID()}`;
    const res = await google(googleIdToken({ sub, email }));

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Google account registered.");
    expect(res.body.data.user).toMatchObject({ email, isVerified: true });
    const userId = res.body.data.user.id;
    const link = await db.query(`SELECT provider, provider_account_id FROM oauth_accounts WHERE user_id = $1`, [userId]);
    expect(link.rows).toEqual([{ provider: "google", provider_account_id: sub }]);
    expect(await balanceOf(db, userId)).toBe(10);

    const again = await google(googleIdToken({ sub, email }));
    expect(again.body.data.message).toBe("Google sign-in successful.");
    expect(again.body.data.user.id).toBe(userId);
    expect(await ledgerOf(db, userId)).toHaveLength(1);
  });

  it("identity is the Google subject, not the email: a changed Google email still maps to the same user", async () => {
    const sub = `g-${randomUUID()}`;
    const first = await google(googleIdToken({ sub, email: uniqueEmail() }));
    const second = await google(googleIdToken({ sub, email: uniqueEmail("renamed") }));
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
  });

  it("links to an existing unverified local account with the same email, verifying it and granting the bonus", async () => {
    const local = await createUser(db, { verified: false, balance: 0 });
    const res = await google(googleIdToken({ email: local.email.toUpperCase() }));
    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Google account linked.");
    expect(res.body.data.user).toMatchObject({ id: local.id, isVerified: true });
    expect(await balanceOf(db, local.id)).toBe(10);
  });

  it("concurrent first sign-ins with the same Google account create exactly one user", async () => {
    const sub = `g-${randomUUID()}`;
    const email = uniqueEmail("race");
    const results = await Promise.all(Array.from({ length: 5 }, () => google(googleIdToken({ sub, email }))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.user.id)).size).toBe(1);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email]);
    expect(rows[0].n).toBe(1);
    expect(await balanceOf(db, results[0]!.body.data.user.id)).toBe(10);
  });

  it.each([
    ["wrong audience (another app's client id)", { aud: "other-app.apps.googleusercontent.com" }, "GOOGLE_TOKEN_INVALID"],
    ["wrong issuer", { iss: "https://evil.example" }, "GOOGLE_TOKEN_INVALID"],
    ["expired", { expiresInSec: -3600 }, "GOOGLE_TOKEN_INVALID"],
    ["signed by an unknown key", { signWithAttackerKey: true }, "GOOGLE_TOKEN_INVALID"],
    ["unverified Google email", { email_verified: false }, "GOOGLE_EMAIL_UNVERIFIED"],
    ["no email claim", { email: undefined }, "GOOGLE_TOKEN_INVALID"],
  ])("%s → 401 %s and no account created", async (_l, claims, code) => {
    const email = uniqueEmail("rejected");
    const withEmail = "email" in claims ? claims : { ...claims, email };
    const res = await google(googleIdToken(withEmail as never));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(code);
    const after = await db.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email]);
    expect(after.rows[0].n).toBe(0);
  });

  it.each([[undefined], [""], [42], ["x".repeat(8193)]])("malformed idToken %# → 400 VALIDATION_ERROR", async (idToken) => {
    const res = await google(idToken);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts the GSI `credential` field name as well as `idToken`", async () => {
    const res = await request(app).post("/api/auth/google").set("X-Forwarded-For", freshIp()).send({ credential: googleIdToken() });
    expect(res.status).toBe(200);
  });

  // FINDING-19 (Low): getGoogleClient()'s 503 is thrown inside verifyGoogleIdToken's try/catch,
  // which rewrites every error to 401 GOOGLE_TOKEN_INVALID — misconfiguration looks like a bad token.
  it.fails("Google sign-in disabled (no GOOGLE_CLIENT_ID) → 503 GOOGLE_AUTH_DISABLED (FINDING-19)", async () => {
    const saved = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = "";
    try {
      const res = await google(googleIdToken());
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("GOOGLE_AUTH_DISABLED");
    } finally {
      process.env.GOOGLE_CLIENT_ID = saved;
    }
  });
});

describe("database unavailable", () => {
  it("auth/billing routes answer 503 DATABASE_UNAVAILABLE without leaking connection details", async () => {
    const { createApp: freshApp } = await import("../../src/app.js");
    const db0 = await import("../../src/db/index.js");
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://postgres@127.0.0.1:1/moleculestudio_unreachable_test";
    await db0.closePool();
    const { resetDatabaseEnvCache } = await import("../../src/config/database.js");
    resetDatabaseEnvCache();
    try {
      const res = await request(freshApp()).post("/api/auth/login").set("X-Forwarded-For", freshIp()).send({ email: "a@b.co", password: "Password1" });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" });
      const health = await request(freshApp()).get("/health");
      expect(health.status).toBe(503);
      expect(health.body).toMatchObject({ status: "degraded", database: "unavailable" });
    } finally {
      process.env.DATABASE_URL = saved;
      resetDatabaseEnvCache();
      await db0.closePool();
      await db0.verifyDatabaseConnection();
    }
  });
});
