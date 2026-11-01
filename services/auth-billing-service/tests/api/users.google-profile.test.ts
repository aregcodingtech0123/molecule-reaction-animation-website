/**
 * Google sign-up stores no invented personal data (docs/seo/GOOGLE_PROFILE_DESIGN.md): the name and date of birth stay NULL
 * until the user enters them, the API keeps its string shape ("" = not provided), and the user can clear a stored value.
 * Everything else about Google sign-in (bonus, verification, link, session, takeover rules) is asserted unchanged.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { bearer, freshIp } from "../support/auth";
import { spyConsole } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, uniqueEmail, waitFor } from "../support/db";
import { googleIdToken, stubGoogleCerts } from "../support/google";
import { orderCreatedEvent, signedBody } from "../support/lemon";

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
  stubGoogleCerts(); // vitest restores spies after every test
});

const google = (idToken: string) => request(app).post("/api/auth/google").set("X-Forwarded-For", freshIp()).send({ idToken });
const row = async (id: string) =>
  (await db.query(`SELECT first_name, last_name, date_of_birth::text AS dob, is_verified, token_version FROM users WHERE id = $1`, [id])).rows[0];

async function newGoogleUser() {
  const email = uniqueEmail("gp");
  const res = await google(googleIdToken({ email }));
  expect(res.status).toBe(200);
  return { email, id: res.body.data.user.id as string, token: res.body.data.token as string, body: res.body };
}

describe("a brand-new Google user", () => {
  it("has NULL first name, last name and date of birth in the database, and the API still answers with strings", async () => {
    const u = await newGoogleUser();
    expect(await row(u.id)).toMatchObject({ first_name: null, last_name: null, dob: null });
    expect(u.body.data.user).toMatchObject({ email: u.email, firstName: "", lastName: "", dateOfBirth: "", isVerified: true, isAdmin: false });
    const profile = await request(app).get("/api/users/profile").set("Authorization", `Bearer ${u.token}`);
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ firstName: "", lastName: "", dateOfBirth: "" });
  });

  it("is otherwise exactly as before: verified, linked to Google, signup bonus of 10 credits, a working session", async () => {
    const u = await newGoogleUser();
    expect((await row(u.id)).is_verified).toBe(true);
    const link = await db.query(`SELECT provider FROM oauth_accounts WHERE user_id = $1`, [u.id]);
    expect(link.rows).toEqual([{ provider: "google" }]);
    expect(await balanceOf(db, u.id)).toBe(10);
    const ledger = await ledgerOf(db, u.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ amount: 10, transaction_type: "SIGNUP_BONUS" });
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${u.token}`)).status).toBe(200);
  });

  it("signing in with Google again changes nothing (still NULL, no second bonus)", async () => {
    const email = uniqueEmail("gp-again");
    const sub = `g-${randomUUID()}`;
    const first = await google(googleIdToken({ email, sub }));
    const second = await google(googleIdToken({ email, sub }));
    expect(second.status).toBe(200);
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
    expect(await row(first.body.data.user.id)).toMatchObject({ first_name: null, last_name: null, dob: null });
    expect(await ledgerOf(db, first.body.data.user.id)).toHaveLength(1);
  });

  it("no generated-looking values appear anywhere in the user's row", async () => {
    const u = await newGoogleUser();
    const all = (await db.query(`SELECT * FROM users WHERE id = $1`, [u.id])).rows[0];
    const stored = JSON.stringify(all);
    expect(stored).not.toMatch(/Emma|Liam|Smith|Yılmaz/);
  });
});

describe("linking Google to an existing account keeps the real profile", () => {
  it("a password account's name and date of birth survive a Google sign-in with the same verified email", async () => {
    const owner = await createUser(db);
    await db.query(`UPDATE users SET first_name = 'Grace', last_name = 'Hopper', date_of_birth = '1985-12-09' WHERE id = $1`, [owner.id]);
    const res = await google(googleIdToken({ email: owner.email }));
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: owner.id, firstName: "Grace", lastName: "Hopper", dateOfBirth: "1985-12-09" });
    expect(await row(owner.id)).toMatchObject({ first_name: "Grace", last_name: "Hopper", dob: "1985-12-09" });
  });
});

describe("PUT /api/users/profile", () => {
  const put = (token: string, body: unknown) => request(app).put("/api/users/profile").set("Authorization", `Bearer ${token}`).send(body as object);

  it("a Google user can save just a first name; the other two stay empty", async () => {
    const u = await newGoogleUser();
    const res = await put(u.token, { firstName: "Ada" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ firstName: "Ada", lastName: "", dateOfBirth: "" });
    expect(await row(u.id)).toMatchObject({ first_name: "Ada", last_name: null, dob: null });
  });

  it("a stored value can be cleared with null, one field or all three; other fields are untouched", async () => {
    const user = await createUser(db); // Test User, 1990-01-01
    const token = bearer(user).replace("Bearer ", "");
    const one = await put(token, { lastName: null });
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ firstName: "Test", lastName: "", dateOfBirth: "1990-01-01" });
    const rest = await put(token, { firstName: null, dateOfBirth: null });
    expect(rest.status).toBe(200);
    expect(rest.body.data).toMatchObject({ firstName: "", lastName: "", dateOfBirth: "" });
    expect(await row(user.id)).toMatchObject({ first_name: null, last_name: null, dob: null });
  });

  it("validation is unchanged: an empty string, a bad date or an unknown-only body is still rejected", async () => {
    const u = await newGoogleUser();
    expect((await put(u.token, { firstName: "" })).status).toBe(400);
    expect((await put(u.token, { dateOfBirth: "10/12/1990" })).status).toBe(400);
    expect((await put(u.token, { dateOfBirth: `${new Date().getUTCFullYear() - 5}-01-01` })).status).toBe(400);
    expect((await put(u.token, { nickname: "x" })).status).toBe(400);
    expect((await put(u.token, {})).status).toBe(400);
    expect(await row(u.id)).toMatchObject({ first_name: null, last_name: null, dob: null });
  });

  it("clearing needs the same authentication: no token → 401, someone else's token cannot touch the row", async () => {
    const u = await newGoogleUser();
    await put(u.token, { firstName: "Keep" });
    expect((await request(app).put("/api/users/profile").send({ firstName: null })).status).toBe(401);
    const other = await newGoogleUser();
    await put(other.token, { firstName: null });
    expect((await row(u.id)).first_name).toBe("Keep");
  });
});

describe("a user without a name is not a problem elsewhere", () => {
  it("a purchase for a Google user with no name is still credited and its receipt still attempted", async () => {
    const u = await newGoogleUser();
    const event = orderCreatedEvent({ customData: { user_id: u.id, package_id: "starter" } });
    const { raw, signature } = signedBody(event);
    const res = await request(app).post("/api/billing/webhooks/lemonsqueezy").set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
    expect(res.status).toBe(200);
    await waitFor(async () => (await balanceOf(db, u.id)) === 10 + 50);
    expect(await balanceOf(db, u.id)).toBe(60);
  });
});
