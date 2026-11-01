/**
 * POST /api/users/export (docs/seo/ACCOUNT_DELETION_DESIGN.md, Phase A): the signed-in user's own data as JSON, after
 * re-entering the password or a fresh Google sign-in; rate-limited; no secret, hash or other user's data in the output;
 * strictly read-only (the immutable ledger is only SELECTed).
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { bearer, craftToken, freshIp } from "../support/auth";
import { spyConsole } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, uniqueEmail } from "../support/db";
import { googleIdToken, stubGoogleCerts } from "../support/google";

const app = createApp();
const PASSWORD = "Export-me-1-please";
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

const post = (token: string | null, body: unknown, ip = freshIp()) => {
  const r = request(app).post("/api/users/export").set("X-Forwarded-For", ip);
  return (token ? r.set("Authorization", `Bearer ${token}`) : r).send(body as object);
};
const tokenOf = (u: { id: string; email: string }) => bearer(u).replace("Bearer ", "");

/** A user with a known password, a name, a signup address, a bonus, an adjustment, an AI charge, a checkout order and a hold. */
async function richUser() {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const u = await createUser(db, { passwordHash: hash, balance: 0 });
  await db.query(`UPDATE users SET signup_ip = '203.0.113.9' WHERE id = $1`, [u.id]);
  await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
  await db.query(`SELECT post_credit_transaction($1, 50, 'ADMIN_ADJUSTMENT', $2)`, [u.id, `adjust-${randomUUID()}`]);
  await db.query(`SELECT post_credit_transaction($1, -2, 'CREDIT_CONSUMPTION', $2)`, [u.id, `turn-${randomUUID()}`]);
  await db.query(
    `INSERT INTO pending_checkout_orders (user_id, package_id, provider, currency, amount_minor, credits, status)
     VALUES ($1, 'starter', 'lemonsqueezy', 'USD', 499, 50, 'completed')`,
    [u.id],
  );
  await db.query(
    `INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, status, expires_at)
     VALUES ($1, $2, 'chat', 1, 'held', NOW() + INTERVAL '5 minutes')`,
    [u.id, `hold-${randomUUID()}`],
  );
  return u;
}

describe("re-authentication", () => {
  it("no token → 401; a wrong password → 403 REAUTH_FAILED (never 401, which would sign the browser out)", async () => {
    const u = await richUser();
    expect((await post(null, { password: PASSWORD })).status).toBe(401);
    const wrong = await post(tokenOf(u), { password: "Wrong-password-1" });
    expect(wrong.status).toBe(403);
    expect(wrong.body).toMatchObject({ success: false, code: "REAUTH_FAILED" });
    expect(JSON.stringify(wrong.body)).not.toContain(PASSWORD);
  });

  it.each([
    ["nothing", {}],
    ["both a password and a token", { password: "x", idToken: "y" }],
    ["a non-string password", { password: 12345 }],
    ["an oversized password", { password: "p".repeat(9000) }],
    ["a non-string token", { idToken: { a: 1 } }],
  ])("%s → 400", async (_label, body) => {
    const u = await richUser();
    const res = await post(tokenOf(u), body);
    expect(res.status).toBe(400);
  });

  it("a revoked-session token (older token_version) is refused before any data is read", async () => {
    const u = await richUser();
    await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [u.id]);
    expect((await post(tokenOf(u), { password: PASSWORD })).status).toBe(401);
  });

  it("an unknown user id in a valid-looking token → 401/403, never data", async () => {
    const res = await post(craftToken({ sub: randomUUID() }), { password: PASSWORD });
    expect([401, 403, 404]).toContain(res.status);
    expect(res.body.data).toBeUndefined();
  });
});

describe("the export of a password account", () => {
  it("contains the user's own data and states what it does not contain", async () => {
    const u = await richUser();
    const res = await post(tokenOf(u), { password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const d = res.body.data;
    expect(d.account).toMatchObject({ id: u.id, email: u.email, firstName: "Test", lastName: "User", dateOfBirth: "1990-01-01", isVerified: true, signupIpAddress: "203.0.113.9" });
    expect(d.linkedSignIn).toEqual([]);
    expect(d.credits).toEqual({ balance: await balanceOf(db, u.id) });
    expect(d.creditLedger.map((r: { type: string; amount: number }) => [r.type, r.amount])).toEqual([["SIGNUP_BONUS", 10], ["ADMIN_ADJUSTMENT", 50], ["CREDIT_CONSUMPTION", -2]]);
    expect(d.checkoutOrders).toEqual([expect.objectContaining({ packageId: "starter", provider: "lemonsqueezy", currency: "USD", amountMinor: 499, credits: 50, status: "completed" })]);
    expect(d.aiCreditHolds).toEqual([expect.objectContaining({ operation: "chat", amount: 1, status: "held", settledAt: null })]);
    expect(d.notes.join(" ")).toMatch(/not stored/);
  });

  it("the ledger rows are exactly the database rows (ids, amounts, types, references, order)", async () => {
    const u = await richUser();
    const d = (await post(tokenOf(u), { password: PASSWORD })).body.data;
    const stored = await ledgerOf(db, u.id);
    expect(d.creditLedger).toHaveLength(stored.length);
    expect(d.creditLedger.map((r: { id: string }) => r.id)).toEqual(stored.map((r) => String(r.id)));
    expect(d.creditLedger.map((r: { referenceId: string | null }) => r.referenceId)).toEqual(
      (await db.query(`SELECT reference_id FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY id`, [u.id])).rows.map((r) => r.reference_id),
    );
  });

  it("no secret appears anywhere in the output: no hash, no password, no token, no token hash, no Google subject id, no other user", async () => {
    const u = await richUser();
    const other = await richUser();
    // Give the account every kind of secret the service stores.
    await db.query(`INSERT INTO oauth_accounts (user_id, provider, provider_account_id) VALUES ($1, 'google', 'google-sub-SECRET-123')`, [u.id]);
    const verificationHash = "a1".repeat(32);
    const resetHash = "b2".repeat(32);
    await db.query(`INSERT INTO verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [u.id, verificationHash]);
    await db.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [u.id, resetHash]);
    const hash = (await db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [u.id])).rows[0]!.password_hash;
    const token = tokenOf(u);

    const res = await post(token, { password: PASSWORD });
    expect(res.status).toBe(200);
    const text = res.text;
    for (const secret of [hash, PASSWORD, token, "google-sub-SECRET-123", verificationHash, resetHash, other.id, other.email]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/password_hash|passwordHash|token_hash|tokenVersion|token_version|"isAdmin"|payload/i);
    expect(res.body.data.linkedSignIn).toEqual([{ provider: "google", linkedAt: expect.any(String) }]);
  });

  it("is read-only: the ledger, balance, user row and token tables are identical afterwards", async () => {
    const u = await richUser();
    const snapshot = async () => ({
      ledger: await ledgerOf(db, u.id),
      balance: await balanceOf(db, u.id),
      user: (await db.query(`SELECT * FROM users WHERE id = $1`, [u.id])).rows[0],
      holds: (await db.query(`SELECT * FROM ai_credit_holds WHERE user_id = $1`, [u.id])).rows,
    });
    const before = await snapshot();
    expect((await post(tokenOf(u), { password: PASSWORD })).status).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect((await db.query(`SELECT count(*)::int AS n FROM ledger_reconciliation()`)).rows[0].n).toBe(0);
  });

  it("an account with no activity still exports (empty lists, balance 0)", async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const u = await createUser(db, { passwordHash: hash });
    const d = (await post(tokenOf(u), { password: PASSWORD })).body.data;
    expect(d).toMatchObject({ creditLedger: [], checkoutOrders: [], aiCreditHolds: [], linkedSignIn: [], credits: { balance: 0 } });
  });

  it("a user with no name or date of birth gets nulls, not generated values", async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const u = await createUser(db, { passwordHash: hash });
    await db.query(`UPDATE users SET first_name = NULL, last_name = NULL, date_of_birth = NULL WHERE id = $1`, [u.id]);
    const d = (await post(tokenOf(u), { password: PASSWORD })).body.data;
    expect(d.account).toMatchObject({ firstName: null, lastName: null, dateOfBirth: null, signupIpAddress: null });
  });
});

describe("an account created with Google", () => {
  async function googleUser() {
    const email = uniqueEmail("gx");
    const sub = `g-${randomUUID()}`;
    const res = await request(app).post("/api/auth/google").set("X-Forwarded-For", freshIp()).send({ idToken: googleIdToken({ email, sub }) });
    expect(res.status).toBe(200);
    return { email, sub, id: res.body.data.user.id as string, token: res.body.data.token as string };
  }

  it("exports after a fresh Google sign-in for the linked identity", async () => {
    const g = await googleUser();
    const res = await post(g.token, { idToken: googleIdToken({ email: g.email, sub: g.sub }) });
    expect(res.status).toBe(200);
    expect(res.body.data.account).toMatchObject({ id: g.id, email: g.email, firstName: null });
    expect(res.text).not.toContain(g.sub);
  });

  it("refuses: a stale Google sign-in (issued 10 minutes ago), another Google identity, an invalid token, and the unusable random password", async () => {
    const g = await googleUser();
    const stale = await post(g.token, { idToken: googleIdToken({ email: g.email, sub: g.sub, issuedSecondsAgo: 600 }) });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("REAUTH_FAILED");
    const stranger = await post(g.token, { idToken: googleIdToken({ email: g.email, sub: `g-${randomUUID()}` }) });
    expect(stranger.status).toBe(403);
    const forged = await post(g.token, { idToken: googleIdToken({ email: g.email, sub: g.sub, signWithAttackerKey: true }) });
    expect(forged.status).toBe(403); // never 401: the browser would sign the user out
    const pw = await post(g.token, { password: "Anything-1-at-all" });
    expect(pw.status).toBe(403);
  });

  it("someone else's valid fresh Google token cannot export this account", async () => {
    const victim = await googleUser();
    const attacker = await googleUser();
    const res = await post(victim.token, { idToken: googleIdToken({ email: attacker.email, sub: attacker.sub }) });
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });
});

describe("rate limit", () => {
  it("5 attempts per hour per account (wrong passwords count), the sixth is 429; another account is unaffected", async () => {
    const u = await richUser();
    const other = await richUser();
    for (let i = 0; i < 5; i++) expect((await post(tokenOf(u), { password: "Wrong-password-1" })).status).toBe(403);
    const sixth = await post(tokenOf(u), { password: PASSWORD });
    expect(sixth.status).toBe(429);
    expect(sixth.body).toMatchObject({ success: false, error: "TOO_MANY_ATTEMPTS" });
    expect(sixth.body.data).toBeUndefined();
    expect((await post(tokenOf(other), { password: PASSWORD })).status).toBe(200);
  });

  it("the limit follows the account, not the address: a different IP does not reset it", async () => {
    const u = await richUser();
    for (let i = 0; i < 5; i++) await post(tokenOf(u), { password: "Wrong-password-1" }, freshIp());
    expect((await post(tokenOf(u), { password: PASSWORD }, freshIp())).status).toBe(429);
  });
});
