/**
 * Account deletion by anonymisation (docs/seo/ACCOUNT_DELETION_IMPLEMENTATION.md): the request/cancel endpoints, what an anonymised
 * account can no longer do, the re-registration guard on the signup bonus, and late webhooks. PostgreSQL 18, real HTTP.
 * The ledger is immutable; every flow here ends with the ledger and balance exactly as they were.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { loadReceiptRecipient } from "../../src/services/webhook.service.js";
import { emailTombstoneKey } from "../../src/utils/emailTombstone.js";
import { generateSecureToken } from "../../src/utils/secureToken.js";
import { bearer, freshIp, tokenFor } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, uniqueEmail, waitFor } from "../support/db";
import { googleIdToken, stubGoogleCerts } from "../support/google";
import { newOrderId, orderCreatedEvent, signedBody } from "../support/lemon";

const app = createApp();
const PASSWORD = "Delete-me-1-please";
const HASH = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
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
  stubGoogleCerts();
});

const post = (path: string, body: object, token?: string) => {
  const r = request(app).post(path).set("X-Forwarded-For", freshIp());
  return (token ? r.set("Authorization", `Bearer ${token}`) : r).send(body);
};
const authed = (method: "get" | "delete" | "put", path: string, token: string) =>
  request(app)[method](path).set("X-Forwarded-For", freshIp()).set("Authorization", `Bearer ${token}`);
const tokenOf = (u: { id: string; email: string }) => bearer(u).replace("Bearer ", "");

async function passwordUser(opts: { balance?: boolean; admin?: boolean } = {}) {
  const u = await createUser(db, { passwordHash: await bcrypt.hash(PASSWORD, 4) });
  if (opts.admin) await db.query(`UPDATE users SET is_admin = true WHERE id = $1`, [u.id]);
  if (opts.balance) {
    await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    await db.query(`SELECT post_credit_transaction($1, -3, 'CREDIT_CONSUMPTION', $2)`, [u.id, `turn-${randomUUID()}`]);
  }
  return u;
}
const userRow = async (id: string) => (await db.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
const money = async (id: string) => ({
  ledger: await ledgerOf(db, id),
  balance: await balanceOf(db, id),
  orders: (await db.query(`SELECT * FROM pending_checkout_orders WHERE user_id = $1`, [id])).rows,
});

/** What the daily job does for one account, using the same keyed hash the app would look up. */
async function runJobFor(u: { id: string; email: string }, daysAgo = 15) {
  await db.query(`UPDATE users SET deletion_requested_at = NOW() - make_interval(days => $2::int) WHERE id = $1`, [u.id, daysAgo]);
  const outcome = (await db.query(`SELECT anonymise_user($1::uuid, $2, $3::bytea) AS r`, [u.id, HASH, emailTombstoneKey(u.email)])).rows[0].r;
  expect(outcome).toBe("anonymised");
}

async function tokenFromLoggedEmail(kind: "verify-email" | "reset-password", email: string) {
  const line = await logs.waitForLine(new RegExp(`"to":"${email.replace(/[.+]/g, "\\$&")}".*${kind}\\?token=`));
  return decodeURIComponent(line.match(new RegExp(`${kind}\\?token=([^\\s"\\\\]+)`))![1]!);
}

describe("requesting deletion (POST /api/users/deletion)", () => {
  it("needs a session and the right password; a refusal records nothing", async () => {
    const u = await passwordUser();
    expect((await post("/api/users/deletion", { password: PASSWORD })).status).toBe(401);
    const wrong = await post("/api/users/deletion", { password: "Wrong-password-1" }, tokenOf(u));
    expect(wrong.status).toBe(403); // never 401: the browser would sign the user out as if the session had expired
    expect(wrong.body.code).toBe("REAUTH_FAILED");
    expect((await userRow(u.id)).deletion_requested_at).toBeNull();
    expect((await post("/api/users/deletion", {}, tokenOf(u))).status).toBe(400);
  });

  it("records the request, answers with the date 14 days later, signs out every session at once, and a new sign-in shows the date", async () => {
    const u = await passwordUser();
    const oldToken = tokenOf(u);
    const before = await userRow(u.id);
    const res = await post("/api/users/deletion", { password: PASSWORD }, oldToken);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");

    const after = await userRow(u.id);
    expect(after.deletion_requested_at).toBeInstanceOf(Date);
    expect(after.anonymised_at).toBeNull();
    expect(after.token_version).toBe(before.token_version + 1);
    const due = new Date(after.deletion_requested_at.getTime() + 14 * 86_400_000).toISOString();
    expect(res.body).toEqual({ success: true, data: { scheduledFor: due } });

    expect((await authed("get", "/api/auth/me", oldToken)).status).toBe(401); // the session that asked is gone too
    const login = await post("/api/auth/login", { email: u.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.deletionScheduledFor).toBe(due);
    const profile = await authed("get", "/api/users/profile", login.body.data.token);
    expect(profile.body.data.deletionScheduledFor).toBe(due);
  });

  it("asking again cannot push the date back", async () => {
    const u = await passwordUser();
    const first = await post("/api/users/deletion", { password: PASSWORD }, tokenOf(u));
    await db.query(`UPDATE users SET deletion_requested_at = deletion_requested_at - INTERVAL '5 days' WHERE id = $1`, [u.id]);
    const again = await post("/api/users/deletion", { password: PASSWORD }, tokenFor({ id: u.id, email: u.email }, (await userRow(u.id)).token_version));
    expect(again.status).toBe(200);
    const stored = (await userRow(u.id)).deletion_requested_at as Date;
    expect(again.body.data.scheduledFor).toBe(new Date(stored.getTime() + 14 * 86_400_000).toISOString());
    expect(new Date(again.body.data.scheduledFor).getTime()).toBeLessThan(new Date(first.body.data.scheduledFor).getTime());
  });

  it("the request writes nothing to the ledger, the balance or the orders", async () => {
    const u = await passwordUser({ balance: true });
    const before = await money(u.id);
    expect((await post("/api/users/deletion", { password: PASSWORD }, tokenOf(u))).status).toBe(200);
    expect(await money(u.id)).toEqual(before);
    expect((await db.query(`SELECT count(*)::int AS n FROM ledger_reconciliation() WHERE user_id = $1`, [u.id])).rows[0].n).toBe(0);
  });

  it("e-mails a confirmation that names the date, the lost credits and how to cancel (best effort)", async () => {
    const u = await passwordUser();
    const res = await post("/api/users/deletion", { password: PASSWORD }, tokenOf(u));
    const line = await logs.waitForLine(new RegExp(`"to":"${u.email.replace(/[.+]/g, "\\$&")}".*scheduled for deletion`));
    expect(line).toContain(res.body.data.scheduledFor.slice(0, 10));
    expect(line).toMatch(/permanently lost/);
    expect(line).toMatch(/Cancel deletion/);
  });

  it("an administrator cannot delete their account from here", async () => {
    const admin = await passwordUser({ admin: true });
    const res = await post("/api/users/deletion", { password: PASSWORD }, tokenOf(admin));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_CANNOT_SELF_DELETE");
    expect((await userRow(admin.id)).deletion_requested_at).toBeNull();
  });

  it("is rate-limited to 5 attempts per hour per account (wrong passwords count), not per address", async () => {
    const u = await passwordUser();
    for (let i = 0; i < 5; i++) expect((await post("/api/users/deletion", { password: "Wrong-password-1" }, tokenOf(u))).status).toBe(403);
    const sixth = await post("/api/users/deletion", { password: PASSWORD }, tokenOf(u));
    expect(sixth.status).toBe(429);
    expect((await userRow(u.id)).deletion_requested_at).toBeNull();
  });

  it("an account created with Google confirms with a fresh Google sign-in; a stale one is refused", async () => {
    const email = uniqueEmail("gdel");
    const sub = `g-${randomUUID()}`;
    const signIn = await post("/api/auth/google", { idToken: googleIdToken({ email, sub }) });
    const token = signIn.body.data.token as string;
    const id = signIn.body.data.user.id as string;
    const stale = await post("/api/users/deletion", { idToken: googleIdToken({ email, sub, issuedSecondsAgo: 900 }) }, token);
    expect(stale.status).toBe(403);
    expect((await userRow(id)).deletion_requested_at).toBeNull();
    const ok = await post("/api/users/deletion", { idToken: googleIdToken({ email, sub }) }, token);
    expect(ok.status).toBe(200);
    expect((await userRow(id)).deletion_requested_at).toBeInstanceOf(Date);
  });
});

describe("cancelling (DELETE /api/users/deletion)", () => {
  it("during the grace period, after signing in again: clears the request; cancelling twice is harmless", async () => {
    const u = await passwordUser();
    await post("/api/users/deletion", { password: PASSWORD }, tokenOf(u));
    const login = await post("/api/auth/login", { email: u.email, password: PASSWORD });
    const token = login.body.data.token as string;
    const cancel = await authed("delete", "/api/users/deletion", token);
    expect(cancel.status).toBe(200);
    expect(cancel.body).toEqual({ success: true, data: { cancelled: true } });
    expect((await userRow(u.id)).deletion_requested_at).toBeNull();
    expect((await authed("get", "/api/users/profile", token)).body.data.deletionScheduledFor).toBeNull();
    expect((await authed("delete", "/api/users/deletion", token)).body.data).toEqual({ cancelled: false });
  });

  it("needs a session; a cancelled account is no longer picked up by the job", async () => {
    const u = await passwordUser();
    expect((await request(app).delete("/api/users/deletion")).status).toBe(401);
    await post("/api/users/deletion", { password: PASSWORD }, tokenOf(u));
    await db.query(`UPDATE users SET deletion_requested_at = NOW() - INTERVAL '20 days' WHERE id = $1`, [u.id]);
    const token = tokenFor({ id: u.id, email: u.email }, (await userRow(u.id)).token_version);
    await authed("delete", "/api/users/deletion", token);
    const outcome = (await db.query(`SELECT anonymise_user($1::uuid, $2) AS r`, [u.id, HASH])).rows[0].r;
    expect(outcome).toBe("not_due");
  });
});

describe("after the daily job anonymised the account", () => {
  it("the old credentials and sessions are dead, and the ledger, balance and reconciliation are exactly as before", async () => {
    const u = await passwordUser({ balance: true });
    const token = tokenOf(u);
    const before = await money(u.id);
    await runJobFor(u);

    expect((await post("/api/auth/login", { email: u.email, password: PASSWORD })).status).toBe(401);
    const deletedEmail = `deleted-${u.id}@invalid`;
    expect([400, 401]).toContain((await post("/api/auth/login", { email: deletedEmail, password: PASSWORD })).status); // not even a valid address, and never a session
    expect((await authed("get", "/api/auth/me", token)).status).toBe(401);
    expect((await post("/api/users/export", { password: PASSWORD }, token)).status).toBe(401);
    expect(await money(u.id)).toEqual(before);
    expect((await db.query(`SELECT count(*)::int AS n FROM ledger_reconciliation() WHERE user_id = $1`, [u.id])).rows[0].n).toBe(0);
  });

  it("'forgot password' for the old address answers like any unknown address and sends nothing", async () => {
    const u = await passwordUser();
    await runJobFor(u);
    const fresh = await post("/api/auth/forgot-password", { email: uniqueEmail("never-registered") });
    const old = await post("/api/auth/forgot-password", { email: u.email });
    expect(old.status).toBe(fresh.status);
    expect(old.body).toEqual(fresh.body);
    expect(logs.lines().some((l) => l.includes(u.email))).toBe(false);
  });

  it("a reset link issued before the deletion cannot bring the account back", async () => {
    const u = await passwordUser();
    const { rawToken, tokenHash } = generateSecureToken();
    await db.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [u.id, tokenHash]);
    await runJobFor(u);
    const res = await post("/api/auth/reset-password", { token: rawToken, password: "Brand-new-pass-2" });
    expect(res.status).toBe(400);
    expect((await userRow(u.id)).password_hash).toBe(HASH);
  });

  it("the old address can register again; it is a different account", async () => {
    const u = await passwordUser();
    await runJobFor(u);
    const reg = await post("/api/auth/register", { email: u.email, password: PASSWORD, firstName: "New", lastName: "Person", dateOfBirth: "1990-01-01" });
    expect(reg.status).toBe(200);
    const created = (await db.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [u.email])).rows;
    expect(created).toHaveLength(1);
    expect(created[0].id).not.toBe(u.id);
  });
});

describe("re-registration guard on the signup bonus", () => {
  /** `typedAs` is how the person types the address on the form; the mail goes to the normalised (lower-case) one. */
  async function registerAndVerify(email: string, typedAs = email) {
    const reg = await post("/api/auth/register", { email: typedAs, password: PASSWORD, firstName: "Re", lastName: "Gister", dateOfBirth: "1990-01-01" });
    expect(reg.status).toBe(200);
    const verify = await post("/api/auth/verify-email", { token: await tokenFromLoggedEmail("verify-email", email.trim().toLowerCase()) });
    expect(verify.status).toBe(200);
    const id = verify.body.data.user.id as string;
    return { id, regBody: reg.body, message: verify.body.data.message as string, balance: await balanceOf(db, id), ledger: await ledgerOf(db, id) };
  }
  const deletedAddress = async () => {
    const u = await passwordUser();
    await runJobFor(u);
    return u.email;
  };

  it("a new address gets the signup bonus as before (10 credits, one ledger row)", async () => {
    const r = await registerAndVerify(uniqueEmail("fresh"));
    expect(r.balance).toBe(10);
    expect(r.ledger).toHaveLength(1);
    expect(r.ledger[0]).toMatchObject({ amount: 10, transaction_type: "SIGNUP_BONUS" });
    expect(r.message).toBe("Email verified. Starter credits have been added to your balance.");
  });

  it("the address of a deleted account registers and verifies normally but gets NO signup bonus: no ledger row, balance 0", async () => {
    const email = await deletedAddress();
    const r = await registerAndVerify(email);
    expect(r.balance).toBe(0);
    expect(r.ledger).toEqual([]);
    expect(r.message).toBe("Email verified.");
    expect(logs.lines().some((l) => l.includes("Signup bonus skipped"))).toBe(true);
    expect((await db.query(`SELECT count(*)::int AS n FROM ledger_reconciliation() WHERE user_id = $1`, [r.id])).rows[0].n).toBe(0);
  });

  it("the registration answer is identical for a tombstoned and for a fresh address (no enumeration through the sign-up form)", async () => {
    const tombstoned = await deletedAddress();
    const a = await post("/api/auth/register", { email: tombstoned, password: PASSWORD, firstName: "A", lastName: "B", dateOfBirth: "1990-01-01" });
    const b = await post("/api/auth/register", { email: uniqueEmail("fresh2"), password: PASSWORD, firstName: "A", lastName: "B", dateOfBirth: "1990-01-01" });
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });

  it("is not case- or whitespace-sensitive", async () => {
    const email = await deletedAddress();
    const r = await registerAndVerify(email, `  ${email.toUpperCase()} `);
    expect(r.balance).toBe(0);
  });

  it("an expired tombstone (older than 12 months) no longer blocks the bonus, even before the purge job removes it", async () => {
    const email = await deletedAddress();
    await db.query(`UPDATE deleted_email_tombstones SET created_at = NOW() - INTERVAL '13 months' WHERE email_hmac = $1`, [emailTombstoneKey(email)]);
    expect((await registerAndVerify(email)).balance).toBe(10);
  });

  it("EMAIL_TOMBSTONE_GUARD=false disables the guard completely (the legal-review switch)", async () => {
    const email = await deletedAddress();
    process.env.EMAIL_TOMBSTONE_GUARD = "false";
    try {
      expect((await registerAndVerify(email)).balance).toBe(10);
    } finally {
      delete process.env.EMAIL_TOMBSTONE_GUARD;
    }
  });

  it("without a secret (non-production only; production refuses to start) the guard has no key and does nothing", async () => {
    const email = await deletedAddress();
    const saved = process.env.EMAIL_TOMBSTONE_SECRET;
    process.env.EMAIL_TOMBSTONE_SECRET = "";
    try {
      expect(emailTombstoneKey(email)).toBeNull();
      expect((await registerAndVerify(email)).balance).toBe(10);
    } finally {
      process.env.EMAIL_TOMBSTONE_SECRET = saved;
    }
  });

  it("a different address is unaffected", async () => {
    await deletedAddress();
    expect((await registerAndVerify(uniqueEmail("other"))).balance).toBe(10);
  });

  it("the Google route cannot be used to get around it: a new Google account on a deleted address gets no bonus, any other address does", async () => {
    const email = await deletedAddress();
    const blocked = await post("/api/auth/google", { idToken: googleIdToken({ email }) });
    expect(blocked.status).toBe(200);
    const blockedId = blocked.body.data.user.id as string;
    expect(await balanceOf(db, blockedId)).toBe(0);
    expect(await ledgerOf(db, blockedId)).toEqual([]);

    const open = await post("/api/auth/google", { idToken: googleIdToken({ email: uniqueEmail("gok") }) });
    expect(await balanceOf(db, open.body.data.user.id)).toBe(10);
  });
});

describe("late webhooks for an anonymised account", () => {
  const WEBHOOK = "/api/billing/webhooks/lemonsqueezy";
  const deliver = async (event: unknown) => {
    const { raw, signature } = signedBody(event);
    const res = await request(app).post(WEBHOOK).set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
    expect(res.status).toBe(200);
  };
  const stored = async (orderId: string) =>
    (await db.query(`SELECT status, outcome FROM lemon_webhook_events WHERE provider_order_id = $1 ORDER BY id`, [orderId])).rows;
  const settled = (orderId: string) => waitFor(async () => ((await stored(orderId))[0]?.status === "processed" ? stored(orderId) : null));

  it("a purchase for the anonymised user is NOT credited (no ledger row, no balance change); it ends as 'missing_user' and is logged", async () => {
    const u = await passwordUser({ balance: true });
    await runJobFor(u);
    const before = await money(u.id);
    const orderId = newOrderId();
    await deliver(orderCreatedEvent({ orderId, customData: { user_id: u.id, package_id: "starter" }, email: u.email }));
    expect(await settled(orderId)).toEqual([{ status: "processed", outcome: "missing_user" }]);
    expect(await money(u.id)).toEqual(before);
    expect(logs.lines().some((l) => l.includes("Missing user identity"))).toBe(true);
    expect(logs.lines().some((l) => l.includes("Credited user") && l.includes(orderId))).toBe(false);

    // db:reconcile lists it (section webhook_missing_user) until the owner has refunded the buyer and marked it reviewed.
    const listed = async () => (await db.query(`SELECT provider_order_id FROM webhook_missing_user_to_review()`)).rows.map((r) => r.provider_order_id);
    expect(await listed()).toContain(orderId);
    await db.query(`UPDATE lemon_webhook_events SET reviewed_at = NOW() WHERE provider_order_id = $1 AND outcome = 'missing_user' AND reviewed_at IS NULL`, [orderId]);
    expect(await listed()).not.toContain(orderId);
    expect(await money(u.id)).toEqual(before);
  });

  it("the same order for a normal account is credited exactly as before (regression)", async () => {
    const u = await passwordUser();
    const orderId = newOrderId();
    await deliver(orderCreatedEvent({ orderId, customData: { user_id: u.id, package_id: "starter" } }));
    await logs.waitForLine(new RegExp(`Credited user .*"orderId":"${orderId}"`));
    expect(await balanceOf(db, u.id)).toBe(50);
  });

  it("without custom_data the old buyer e-mail no longer finds the anonymised account; if someone registered the address again, that new account is the match (unchanged rule)", async () => {
    const u = await passwordUser();
    await runJobFor(u);
    const orderId = newOrderId();
    await deliver(orderCreatedEvent({ orderId, email: u.email }));
    expect(await settled(orderId)).toEqual([{ status: "processed", outcome: "missing_user" }]);

    const successor = await createUser(db, { email: u.email });
    const orderId2 = newOrderId();
    await deliver(orderCreatedEvent({ orderId: orderId2, email: u.email }));
    await logs.waitForLine(new RegExp(`Credited user .*"orderId":"${orderId2}"`));
    expect(await balanceOf(db, successor.id)).toBe(50);
    expect(await ledgerOf(db, u.id)).toEqual([]);
  });

  it("a late refund of an old order is recorded and listed for review, and changes no credits", async () => {
    const u = await passwordUser();
    const orderId = newOrderId();
    await deliver(orderCreatedEvent({ orderId, customData: { user_id: u.id, package_id: "starter" } }));
    await logs.waitForLine(new RegExp(`Credited user .*"orderId":"${orderId}"`));
    await runJobFor(u);
    const before = await money(u.id);

    const refund = orderCreatedEvent({ orderId, eventName: "order_refunded", status: "refunded", refunded: true });
    await deliver({
      ...refund,
      data: { ...refund.data, attributes: { ...refund.data.attributes, refunded_amount: 500, refunded_amount_usd: 500, refunded_at: "2026-10-20T10:00:00.000000Z", test_mode: false } },
    });
    await logs.waitForLine(new RegExp(`Recorded refund .*"orderId":"${orderId}"`));
    expect(await money(u.id)).toEqual(before);
    expect((await db.query(`SELECT user_id, credits FROM refunded_orders_to_review() WHERE provider_order_id = $1`, [orderId])).rows).toEqual([{ user_id: u.id, credits: 50 }]);
  });

  it("no receipt is addressed to an anonymised account: the recipient lookup returns nothing; a normal account still gets one", async () => {
    const normal = await passwordUser();
    expect(await loadReceiptRecipient(normal.id)).toMatchObject({ email: normal.email });
    const gone = await passwordUser();
    await runJobFor(gone);
    expect(await loadReceiptRecipient(gone.id)).toBeNull();
  });
});
