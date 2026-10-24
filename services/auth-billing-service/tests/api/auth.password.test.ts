import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { bearer, freshIp } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, ledgerOf, uniqueEmail } from "../support/db";

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

const PASSWORD = "Correct-horse-9";
const profile = { firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10" };

function register(body: Record<string, unknown>, ip = freshIp()) {
  return request(app).post("/api/auth/register").set("X-Forwarded-For", ip).send(body);
}
function login(email: string, password: string, ip = freshIp()) {
  return request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email, password });
}
async function registered(email = uniqueEmail()) {
  const res = await register({ email, password: PASSWORD, ...profile });
  expect(res.status).toBe(201);
  return { email: email.trim().toLowerCase(), res };
}

/** The dev mailer logs the email body when RESEND_API_KEY is unset — the raw token is in the link. */
async function tokenFromLoggedEmail(kind: "verify-email" | "reset-password", email: string) {
  const line = await logs.waitForLine(new RegExp(`"to":"${email.replace(/[.+]/g, "\\$&")}".*${kind}\\?token=`));
  return decodeURIComponent(line.match(new RegExp(`${kind}\\?token=([^\\s"\\\\]+)`))![1]!);
}

describe("POST /api/auth/register", () => {
  it("creates an unverified user with a bcrypt hash (never plaintext), zero balance, and a session token", async () => {
    const email = uniqueEmail("Reg");
    const ip = freshIp();
    const res = await register({ email: `  ${email.toUpperCase()} `, password: PASSWORD, ...profile }, ip);

    expect(res.status).toBe(201);
    expect(res.body.data.user).toEqual({
      id: expect.any(String),
      email: email.toLowerCase(),
      firstName: "Ada",
      lastName: "Lovelace",
      dateOfBirth: "1990-12-10",
      isAdmin: false,
      isVerified: false,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain("password");

    const { rows } = await db.query(`SELECT password_hash, signup_ip::text AS ip, is_admin FROM users WHERE id = $1`, [res.body.data.user.id]);
    expect(rows[0].password_hash).not.toContain(PASSWORD);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$04\$/); // BCRYPT_ROUNDS from env
    expect(await bcrypt.compare(PASSWORD, rows[0].password_hash)).toBe(true);
    expect(rows[0].ip).toBe(`${ip}/32`);
    expect(rows[0].is_admin).toBe(false);

    expect(await balanceOf(db, res.body.data.user.id)).toBe(0);
    expect(await ledgerOf(db, res.body.data.user.id)).toEqual([]);
  });

  it("cannot self-assign admin or verified flags", async () => {
    const res = await register({ email: uniqueEmail(), password: PASSWORD, ...profile, isAdmin: true, is_admin: true, isVerified: true });
    expect(res.body.data.user).toMatchObject({ isAdmin: false, isVerified: false });
  });

  it.each([
    [{ email: undefined }, "Email is required."],
    [{ email: "not-an-email" }, "Email format is invalid."],
    [{ email: `${"a".repeat(316)}@x.io` }, "Email is invalid."],
    [{ password: "short1" }, "Password must be at least 8 characters"],
    [{ password: "a".repeat(129) + "1" }, "at most 128"],
    [{ password: "allletters" }, "letter and a number"],
    [{ password: "12345678" }, "letter and a number"],
    [{ password: 12345678 }, "Password is required."],
    [{ firstName: "" }, "First name must be between"],
    [{ firstName: "<script>" }, "First name contains invalid characters."],
    [{ lastName: "Robert'); DROP" }, "Last name contains invalid characters."],
    [{ dateOfBirth: "10/12/1990" }, "YYYY-MM-DD"],
    [{ dateOfBirth: "1990-02-30" }, "not a valid calendar date"],
    [{ dateOfBirth: `${new Date().getUTCFullYear() - 5}-01-01` }, "at least 13"],
    [{ dateOfBirth: "1850-01-01" }, "out of allowed range"],
  ])("rejects %j → 400 VALIDATION_ERROR", async (override, message) => {
    const body = { email: uniqueEmail(), password: PASSWORD, ...profile, ...override };
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.error).toContain(message);
  });

  it("duplicate email (any case) → 200 generic message, no token, no second account, original password untouched", async () => {
    const { email } = await registered();
    const res = await register({ email: email.toUpperCase(), password: "Different-pass-1", ...profile });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { message: "If this email address is new, your account has been created. Check your inbox to verify your email." },
    });
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE lower(email) = $1`, [email]);
    expect(rows[0].n).toBe(1);
    expect((await login(email, PASSWORD)).status).toBe(200);
  });

  // FINDING-09 (Medium): new accounts get 201 + token + user, existing ones 200 + message — the
  // "ambiguous" message does not hide account existence.
  it.fails("existing and new emails are indistinguishable to the caller (FINDING-09)", async () => {
    const { email } = await registered();
    const existing = await register({ email, password: PASSWORD, ...profile });
    const fresh = await register({ email: uniqueEmail(), password: PASSWORD, ...profile });
    expect(existing.status).toBe(fresh.status);
    expect(Object.keys(existing.body.data).sort()).toEqual(Object.keys(fresh.body.data).sort());
  });

  it("is rate limited to 3 registrations per hour per client IP", async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) {
      expect((await register({ email: uniqueEmail(), password: PASSWORD, ...profile }, ip)).status).toBe(201);
    }
    const blocked = await register({ email: uniqueEmail(), password: PASSWORD, ...profile }, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, error: "TOO_MANY_REGISTRATIONS" });
  });

  // FINDING-12: body-parser errors are not mapped — malformed JSON is a client error, not a 500.
  it.fails("malformed JSON → 400 (FINDING-12)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("X-Forwarded-For", freshIp())
      .set("Content-Type", "application/json")
      .send('{"email": ');
    expect(res.status).toBe(400);
  });
});

describe("date of birth round-trip (FINDING-06)", () => {
  async function roundTrip(tz: string) {
    const saved = process.env.TZ;
    process.env.TZ = tz;
    try {
      const res = await register({ email: uniqueEmail(), password: PASSWORD, ...profile });
      return res.body.data.user.dateOfBirth as string;
    } finally {
      process.env.TZ = saved;
    }
  }

  it("is correct when the server runs in UTC or west of it", async () => {
    expect(await roundTrip("UTC")).toBe("1990-12-10");
    expect(await roundTrip("America/New_York")).toBe("1990-12-10");
  });

  // FINDING-06 (Medium): pg parses DATE as local midnight and toPublicUserProfile() uses
  // toISOString(), so any server TZ east of UTC returns the previous day. The profile form
  // re-submits that value, shifting the stored DOB back one more day on every save.
  it.fails("is correct when the server runs east of UTC (FINDING-06)", async () => {
    expect(await roundTrip("Asia/Tokyo")).toBe("1990-12-10");
  });
});

describe("POST /api/auth/login", () => {
  it("returns a JWT with the documented claims and the public profile (no hash)", async () => {
    const { email } = await registered();
    const res = await login(email, PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Login successful.");
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2b\$/);

    const claims = jwt.decode(res.body.data.token, { complete: true })!;
    expect(claims.header.alg).toBe("HS256");
    expect(claims.payload).toMatchObject({
      sub: res.body.data.user.id,
      email,
      iss: "moleculestudio-auth-billing",
      aud: "moleculestudio-api",
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    const p = claims.payload as jwt.JwtPayload;
    expect(p.exp! - p.iat!).toBe(3600); // JWT_EXPIRES_IN=1h in tests
  });

  it("each login issues a distinct jti", async () => {
    const { email } = await registered();
    const a = jwt.decode((await login(email, PASSWORD)).body.data.token) as jwt.JwtPayload;
    const b = jwt.decode((await login(email, PASSWORD)).body.data.token) as jwt.JwtPayload;
    expect(a.jti).not.toBe(b.jti);
  });

  it("is case-insensitive on email", async () => {
    const { email } = await registered();
    expect((await login(`  ${email.toUpperCase()}  `, PASSWORD)).status).toBe(200);
  });

  it("wrong password and unknown user return the identical 401 body (no enumeration)", async () => {
    const { email } = await registered();
    const wrong = await login(email, "Wrong-pass-123");
    const unknown = await login(uniqueEmail("ghost"), "Wrong-pass-123");

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ success: false, error: "Invalid email or password.", code: "INVALID_CREDENTIALS" });
    expect(unknown.body).toEqual(wrong.body);
  });

  it("runs a bcrypt comparison even for unknown users (timing equalisation)", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    await login(uniqueEmail("ghost"), "Wrong-pass-123");
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it("a Google-only account (random password hash) cannot log in with any password", async () => {
    const email = uniqueEmail("goog");
    const hash = await bcrypt.hash("random-unknowable-" + Math.random(), 4);
    await db.query(`INSERT INTO users (email, password_hash, is_verified) VALUES ($1, $2, true)`, [email, hash]);
    expect((await login(email, PASSWORD)).status).toBe(401);
  });

  it("limits to 5 attempts per IP+email per 15 min, without locking other emails from that IP", async () => {
    const { email } = await registered();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await login(email, "Wrong-pass-123", ip)).status).toBe(401);
    const sixth = await login(email, PASSWORD, ip);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe("TOO_MANY_ATTEMPTS");
    expect((await login(uniqueEmail(), "Wrong-pass-123", ip)).status).toBe(401);
  });
});

describe("email verification", () => {
  it("verifying grants the 10-credit signup bonus once, marks the user verified, and burns the token", async () => {
    const { email, res } = await registered();
    const userId = res.body.data.user.id;
    const token = await tokenFromLoggedEmail("verify-email", email);

    const verified = await request(app).post("/api/auth/verify-email").set("X-Forwarded-For", freshIp()).send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.isVerified).toBe(true);
    expect(await balanceOf(db, userId)).toBe(10);
    expect(await ledgerOf(db, userId)).toEqual([
      expect.objectContaining({ amount: 10, transaction_type: "SIGNUP_BONUS", reference_id: "signup" }),
    ]);

    const reused = await request(app).post("/api/auth/verify-email").set("X-Forwarded-For", freshIp()).send({ token });
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe("INVALID_TOKEN");
    expect(await balanceOf(db, userId)).toBe(10);
  });

  it("concurrent verification with the same token grants the bonus exactly once", async () => {
    const { email, res } = await registered();
    const token = await tokenFromLoggedEmail("verify-email", email);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post("/api/auth/verify-email").set("X-Forwarded-For", freshIp()).send({ token })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balanceOf(db, res.body.data.user.id)).toBe(10);
  });

  it("an expired token → 400 TOKEN_EXPIRED and no bonus", async () => {
    const { email, res } = await registered();
    const token = await tokenFromLoggedEmail("verify-email", email);
    await db.query(`UPDATE verification_tokens SET expires_at = NOW() - interval '1 minute' WHERE user_id = $1`, [res.body.data.user.id]);
    const out = await request(app).post("/api/auth/verify-email").set("X-Forwarded-For", freshIp()).send({ token });
    expect(out.status).toBe(400);
    expect(out.body.code).toBe("TOKEN_EXPIRED");
    expect(await balanceOf(db, res.body.data.user.id)).toBe(0);
  });

  it("stores only the SHA-256 hash of the token", async () => {
    const { email, res } = await registered();
    const token = await tokenFromLoggedEmail("verify-email", email);
    const { rows } = await db.query(`SELECT token_hash FROM verification_tokens WHERE user_id = $1`, [res.body.data.user.id]);
    expect(rows[0].token_hash).toHaveLength(64);
    expect(rows[0].token_hash).not.toBe(token);
  });

  it("resend-verification replaces the previous token and answers generically for unknown emails", async () => {
    const { email } = await registered();
    const first = await tokenFromLoggedEmail("verify-email", email);
    const resent = await request(app).post("/api/auth/resend-verification").set("X-Forwarded-For", freshIp()).send({ email });
    const unknown = await request(app).post("/api/auth/resend-verification").set("X-Forwarded-For", freshIp()).send({ email: uniqueEmail() });
    expect(resent.body).toEqual(unknown.body);

    const old = await request(app).post("/api/auth/verify-email").set("X-Forwarded-For", freshIp()).send({ token: first });
    expect(old.status).toBe(400);
  });

  it.each([[{}], [{ token: "" }], [{ token: "garbage" }]])("bad token %j → 400", async (body) => {
    const res = await request(app).post("/api/auth/verify-email").set("X-Forwarded-For", freshIp()).send(body);
    expect(res.status).toBe(400);
  });
});

describe("password reset", () => {
  async function requestReset(email: string) {
    const res = await request(app).post("/api/auth/forgot-password").set("X-Forwarded-For", freshIp()).send({ email });
    expect(res.status).toBe(200);
    return res;
  }

  it("forgot-password answers identically for known and unknown emails", async () => {
    const { email } = await registered();
    const known = await requestReset(email);
    const unknown = await requestReset(uniqueEmail());
    expect(known.body).toEqual(unknown.body);
  });

  it("reset changes the password (old fails, new works) and the token is single-use", async () => {
    const { email } = await registered();
    await requestReset(email);
    const token = await tokenFromLoggedEmail("reset-password", email);

    const reset = await request(app).post("/api/auth/reset-password").set("X-Forwarded-For", freshIp()).send({ token, password: "Brand-new-pass-2" });
    expect(reset.status).toBe(200);
    expect((await login(email, PASSWORD)).status).toBe(401);
    expect((await login(email, "Brand-new-pass-2")).status).toBe(200);

    const again = await request(app).post("/api/auth/reset-password").set("X-Forwarded-For", freshIp()).send({ token, password: "Another-pass-3" });
    expect(again.status).toBe(400);
  });

  it("an expired reset token → 400 TOKEN_EXPIRED, password unchanged", async () => {
    const { email, res } = await registered();
    await requestReset(email);
    const token = await tokenFromLoggedEmail("reset-password", email);
    await db.query(`UPDATE password_reset_tokens SET expires_at = NOW() - interval '1 second' WHERE user_id = $1`, [res.body.data.user.id]);
    const out = await request(app).post("/api/auth/reset-password").set("X-Forwarded-For", freshIp()).send({ token, password: "Brand-new-pass-2" });
    expect(out.body.code).toBe("TOKEN_EXPIRED");
    expect((await login(email, PASSWORD)).status).toBe(200);
  });

  it("the new password must satisfy the policy", async () => {
    const { email } = await registered();
    await requestReset(email);
    const token = await tokenFromLoggedEmail("reset-password", email);
    const out = await request(app).post("/api/auth/reset-password").set("X-Forwarded-For", freshIp()).send({ token, password: "weak" });
    expect(out.status).toBe(400);
    expect(out.body.code).toBe("VALIDATION_ERROR");
  });

  // FINDING-18 (Medium): a password reset does not revoke JWTs issued before it — a stolen
  // session keeps working for up to JWT_EXPIRES_IN (7d by default) after the owner resets.
  it.fails("sessions issued before a password reset stop working (FINDING-18)", async () => {
    const { email } = await registered();
    const before = (await login(email, PASSWORD)).body.data.token;
    await requestReset(email);
    const token = await tokenFromLoggedEmail("reset-password", email);
    await request(app).post("/api/auth/reset-password").set("X-Forwarded-For", freshIp()).send({ token, password: "Brand-new-pass-2" });

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${before}`);
    expect(me.status).toBe(401);
  });
});

describe("profile (GET/PUT /api/users/profile)", () => {
  it("reads and updates only the caller's own profile", async () => {
    const { res } = await registered();
    const user = { id: res.body.data.user.id, email: res.body.data.user.email };
    const other = (await registered()).res.body.data.user;

    const put = await request(app)
      .put("/api/users/profile")
      .set("Authorization", bearer(user))
      .send({ firstName: "Grace", id: other.id, email: "hijack@example.test", isAdmin: true });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ id: user.id, firstName: "Grace", email: user.email, isAdmin: false });

    const otherRow = await db.query(`SELECT first_name FROM users WHERE id = $1`, [other.id]);
    expect(otherRow.rows[0].first_name).toBe("Ada");
  });

  it("rejects an empty update and invalid fields", async () => {
    const { res } = await registered();
    const user = { id: res.body.data.user.id, email: res.body.data.user.email };
    expect((await request(app).put("/api/users/profile").set("Authorization", bearer(user)).send({})).status).toBe(400);
    expect((await request(app).put("/api/users/profile").set("Authorization", bearer(user)).send({ dateOfBirth: "2999-01-01" })).status).toBe(400);
  });

  it("requires auth", async () => {
    expect((await request(app).get("/api/users/profile")).status).toBe(401);
  });
});
