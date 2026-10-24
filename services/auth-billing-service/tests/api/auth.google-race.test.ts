/**
 * FINDING-35: a first Google sign-in whose Google subject gets linked by a
 * competing request between "look up by sub" (step 1) and "look up by email"
 * (step 2) used to answer 500 — the duplicate link aborted the transaction and
 * the follow-up read failed with 25P02.
 *
 * Deterministic, no sleeps: the service's own pool is intercepted at the
 * prototype; right after its step-1 lookup returns "not linked", the competing
 * request is run to completion before step 2 starts.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { freshIp } from "../support/auth";
import { spyConsole } from "../support/console";
import { balanceOf, createTestPool, createUser, uniqueEmail } from "../support/db";
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

const originalQuery = pg.Pool.prototype.query;
afterEach(() => {
  pg.Pool.prototype.query = originalQuery;
});

const google = (idToken: string) => request(app).post("/api/auth/google").set("X-Forwarded-For", freshIp()).send({ idToken });

/**
 * Run `competitor` exactly once, right after the service's first "user by Google subject" lookup
 * has returned (i.e. after step 1 of loginWithGoogle missed). Queries from the test's own pool and
 * from the competitor itself pass through untouched.
 */
function afterFirstSubjectLookup(competitor: () => Promise<unknown>) {
  const state = { fired: false };
  pg.Pool.prototype.query = async function (this: pg.Pool, ...args: unknown[]) {
    const result = await (originalQuery as (...a: unknown[]) => Promise<unknown>).apply(this, args);
    const first = args[0] as string | { text?: string } | undefined;
    const text = typeof first === "string" ? first : first?.text;
    if (!state.fired && this !== db && /FROM oauth_accounts oa/.test(String(text))) {
      state.fired = true;
      await competitor();
    }
    return result;
  } as typeof pg.Pool.prototype.query;
  return state;
}

async function counts(email: string, sub: string) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM users WHERE lower(email) = lower($1))::int AS users,
            (SELECT count(*) FROM oauth_accounts WHERE provider = 'google' AND provider_account_id = $2)::int AS links,
            (SELECT count(*) FROM credit_ledger_transactions l JOIN users u ON u.id = l.user_id
              WHERE lower(u.email) = lower($1) AND l.transaction_type = 'SIGNUP_BONUS')::int AS bonuses`,
    [email, sub],
  );
  return rows[0];
}

describe("concurrent first Google sign-in (FINDING-35)", () => {
  it("the competing request creates and links the account between step 1 and step 2 → both 200, one user, one link, one bonus", async () => {
    const sub = `g-${randomUUID()}`;
    const email = uniqueEmail("race35");
    const token = googleIdToken({ sub, email });
    let competing: request.Response | undefined;
    const hook = afterFirstSubjectLookup(async () => {
      competing = await google(token); // a complete first sign-in: creates user + link + bonus, commits
    });

    const res = await google(token);

    expect(hook.fired).toBe(true);
    expect(competing!.status).toBe(200);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(competing!.body.data.user.id);
    expect(await counts(email, sub)).toEqual({ users: 1, links: 1, bonuses: 1 });
    expect(await balanceOf(db, res.body.data.user.id)).toBe(10);
  });

  it("the Google subject gets linked to a DIFFERENT user in that window → 409 OAUTH_ALREADY_LINKED; the email owner is not taken over", async () => {
    const sub = `g-${randomUUID()}`;
    const email = uniqueEmail("race35-other");
    // An unverified password account owns the email: the FINDING-34 takeover would apply to it.
    const emailOwner = await createUser(db, { email, verified: false, balance: 0 });
    const other = await createUser(db);
    const before = await db.query(
      `SELECT password_hash, token_version, is_verified FROM users WHERE id = $1`,
      [emailOwner.id],
    );
    const hook = afterFirstSubjectLookup(() =>
      db.query(`INSERT INTO oauth_accounts (user_id, provider, provider_account_id) VALUES ($1, 'google', $2)`, [
        other.id,
        sub,
      ]),
    );

    const res = await google(googleIdToken({ sub, email }));

    expect(hook.fired).toBe(true);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, code: "OAUTH_ALREADY_LINKED" });
    // The link stays with its first owner, and the takeover transaction rolled back completely.
    const links = await db.query(
      `SELECT user_id::text FROM oauth_accounts WHERE provider = 'google' AND provider_account_id = $1`,
      [sub],
    );
    expect(links.rows).toEqual([{ user_id: other.id }]);
    const after = await db.query(`SELECT password_hash, token_version, is_verified FROM users WHERE id = $1`, [emailOwner.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const bonus = await db.query(
      `SELECT count(*)::int AS n FROM credit_ledger_transactions WHERE user_id = $1 AND transaction_type = 'SIGNUP_BONUS'`,
      [emailOwner.id],
    );
    expect(bonus.rows[0].n).toBe(0);
  });
});
