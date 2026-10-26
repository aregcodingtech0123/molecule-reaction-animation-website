/**
 * SEC-12: database/roles/app-role.sql, applied verbatim (role name made unique per run) to a database
 * migrated by the real runner. The app role must be refused every direct write to the money tables and
 * every way around the 008 guard, and the service must still run its real flows connected as that role.
 */
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { externalCalls, jsonResponse, stubExternal } from "../../../../scripts/test/network-guard.mjs";
import { migrate } from "../../scripts/lib/migrator.mjs";
import { createApp } from "../../src/app.js";
import { closePool, verifyDatabaseConnection } from "../../src/db/index.js";
import { releaseExpiredHolds } from "../../src/services/aiCredits.service.js";
import { TEST_ENV } from "../setup/env";
import { bearer, freshIp } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { uniqueEmail, waitFor } from "../support/db";
import { googleIdToken, stubGoogleCerts } from "../support/google";
import { newOrderId, orderCreatedEvent, signedBody } from "../support/lemon";
import { expectPgError } from "../support/pg-error";
import { ScratchDb } from "../support/scratch-db";

const ROLE_SQL = fs.readFileSync(new URL("../../../../database/roles/app-role.sql", import.meta.url), "utf8");
const role = `ms_app_${randomBytes(4).toString("hex")}_test`;

let scratch: ScratchDb;
let owner: pg.Pool;
let asApp: pg.Pool;
const originalUrl = process.env.DATABASE_URL;

beforeAll(async () => {
  scratch = await ScratchDb.create();
  owner = scratch.pool;
  await migrate({ connectionString: scratch.url });
  await owner.query(`CREATE ROLE ${role} LOGIN`);
  await owner.query(ROLE_SQL.replaceAll("moleculestudio_app", role));

  const appUrl = new URL(scratch.url);
  appUrl.username = role;
  appUrl.password = "";
  asApp = new pg.Pool({ connectionString: appUrl.toString(), max: 5 });
  // The service's own pool now connects as the app role.
  process.env.DATABASE_URL = appUrl.toString();
  expect(await verifyDatabaseConnection()).toBe(true);
}, 60_000);

afterAll(async () => {
  await closePool();
  process.env.DATABASE_URL = originalUrl;
  await asApp.end();
  await scratch.destroy();
  const admin = new pg.Client({ connectionString: originalUrl });
  await admin.connect();
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
});

let logs: ConsoleSpies;
beforeEach(() => {
  logs = spyConsole();
});

async function ownerUser(balance: number) {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, is_verified) VALUES ($1, 'x', true) RETURNING id::text`,
    [uniqueEmail("role")],
  );
  const id = rows[0]!.id;
  await owner.query(`INSERT INTO user_balances (user_id, balance) VALUES ($1, 0)`, [id]);
  if (balance) await owner.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [id, balance]);
  return id;
}

const balance = async (id: string) =>
  (await owner.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [id])).rows[0]?.balance as number;

describe("app role is refused every write around the ledger (SEC-12)", () => {
  it.each([
    ["UPDATE the balance cache", `UPDATE user_balances SET balance = 999 WHERE user_id = $1`],
    ["DELETE a balance row", `DELETE FROM user_balances WHERE user_id = $1`],
    ["UPDATE a ledger row", `UPDATE credit_ledger_transactions SET amount = 999 WHERE user_id = $1`],
    ["DELETE ledger rows", `DELETE FROM credit_ledger_transactions WHERE user_id = $1`],
    [
      "INSERT a ledger row directly",
      `INSERT INTO credit_ledger_transactions (user_id, amount, transaction_type) VALUES ($1, 999, 'ADMIN_ADJUSTMENT')`,
    ],
    ["DELETE a user", `DELETE FROM users WHERE id = $1`],
    ["mark a refund reviewed (owner-only, SEC-14)", `UPDATE lemon_order_refunds SET reviewed_at = NOW() WHERE provider_order_id = $1::text`],
    ["delete refund records", `DELETE FROM lemon_order_refunds WHERE provider_order_id = $1::text`],
    ["delete stored webhook events (owner-only, R19)", `DELETE FROM lemon_webhook_events WHERE provider_order_id = $1::text`],
  ])("%s → 42501", async (_label, sql) => {
    const id = await ownerUser(5);
    await expectPgError(asApp.query(sql, [id]), "42501");
    expect(await balance(id)).toBe(5);
  });

  it("the 008 guard flag does not help: set_config + UPDATE in one transaction → 42501", async () => {
    const id = await ownerUser(5);
    const c = await asApp.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('moleculestudio.ledger_write', 'on', true)`);
      await expectPgError(c.query(`UPDATE user_balances SET balance = 999 WHERE user_id = $1`, [id]), "42501");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    expect(await balance(id)).toBe(5);
  });

  it.each([
    ["TRUNCATE the ledger", `TRUNCATE credit_ledger_transactions`],
    ["TRUNCATE balances", `TRUNCATE user_balances`],
    ["disable the balance guard", `ALTER TABLE user_balances DISABLE TRIGGER trg_user_balances_write_guard`],
    ["disable ledger immutability", `ALTER TABLE credit_ledger_transactions DISABLE TRIGGER ALL`],
    ["replace the ledger writer", `CREATE OR REPLACE FUNCTION post_credit_transaction(uuid, integer, credit_transaction_type, varchar, varchar) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint'`],
    ["create objects in public", `CREATE TABLE public.sneaky (id int)`],
    ["read schema_migrations", `SELECT * FROM schema_migrations`],
    ["forge a migration record", `INSERT INTO schema_migrations (filename, checksum) VALUES ('999_x.sql', repeat('0', 64))`],
  ])("%s → 42501", async (_label, sql) => {
    await expectPgError(asApp.query(sql), "42501");
  });

  it("credits still move through post_credit_transaction() (SECURITY DEFINER), with the guard in force", async () => {
    const id = await ownerUser(0);
    await asApp.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [id]);
    await asApp.query(`SELECT post_credit_transaction($1, -3, 'CREDIT_CONSUMPTION', $2)`, [id, randomUUID()]);
    expect(await balance(id)).toBe(7);
    // Overdraft is still refused inside the function.
    await expectPgError(asApp.query(`SELECT post_credit_transaction($1, -100, 'CREDIT_CONSUMPTION', $2)`, [id, randomUUID()]), "P0001");
  });

  it("a role that was not granted EXECUTE cannot mint credits", async () => {
    const other = `ms_noexec_${randomBytes(4).toString("hex")}_test`;
    const id = await ownerUser(0);
    await owner.query(`CREATE ROLE ${other} LOGIN`);
    const url = new URL(scratch.url);
    url.username = other;
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await expectPgError(c.query(`SELECT post_credit_transaction($1, 1000, 'ADMIN_ADJUSTMENT', 'x')`, [id]), "42501");
    } finally {
      await c.end();
      await owner.query(`DROP ROLE ${other}`);
    }
    expect(await balance(id)).toBe(0);
  });
});

describe("the service runs its real flows connected as the app role", () => {
  const app = createApp();
  const PASSWORD = "Correct-horse-9";

  async function tokenFromLoggedEmail(kind: "verify-email" | "reset-password", email: string) {
    const line = await logs.waitForLine(new RegExp(`"to":"${email.replace(/[.+]/g, "\\$&")}".*${kind}\\?token=`));
    return decodeURIComponent(line.match(new RegExp(`${kind}\\?token=([^\\s"\\\\]+)`))![1]!);
  }
  const post = (path: string) => request(app).post(path).set("X-Forwarded-For", freshIp());

  it("register → verify email → login → profile → reset password → logout", async () => {
    const email = uniqueEmail("approle");
    const reg = await post("/api/auth/register").send({
      email, password: PASSWORD, firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10",
    });
    expect(reg.status).toBe(200);
    const verify = await post("/api/auth/verify-email").send({ token: await tokenFromLoggedEmail("verify-email", email) });
    expect(verify.status).toBe(200);

    const login = await post("/api/auth/login").send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    const profile = await request(app)
      .put("/api/users/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Augusta", lastName: "King", dateOfBirth: "1990-12-10" });
    expect(profile.status).toBe(200);

    expect((await post("/api/auth/forgot-password").send({ email })).status).toBe(200);
    const reset = await post("/api/auth/reset-password").send({
      token: await tokenFromLoggedEmail("reset-password", email),
      password: "Brand-new-pass-2",
    });
    expect(reset.status).toBe(200);
    const relogin = await post("/api/auth/login").send({ email, password: "Brand-new-pass-2" });
    expect(relogin.status).toBe(200);
    const logout = await post("/api/auth/logout").set("Authorization", `Bearer ${relogin.body.data.token}`);
    expect(logout.status).toBe(200);
    const after = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${relogin.body.data.token}`);
    expect(after.status).toBe(401);
  });

  it("Google sign-in creates and links an account", async () => {
    stubGoogleCerts();
    const res = await post("/api/auth/google").send({ idToken: googleIdToken({ email: uniqueEmail("g") }) });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
  });

  it("checkout → signed webhook → credits posted", async () => {
    stubExternal("api.lemonsqueezy.com", () =>
      jsonResponse({ data: { type: "checkouts", id: "chk_1", attributes: { url: "https://x.lemonsqueezy.com/checkout/buy/1" } } }, 201),
    );
    const id = await ownerUser(0);
    const user = { id, email: (await owner.query(`SELECT email FROM users WHERE id = $1`, [id])).rows[0].email };
    const checkout = await request(app).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
    expect(checkout.status).toBe(200);
    expect(externalCalls.some((c: { url: string }) => c.url.includes("api.lemonsqueezy.com"))).toBe(true);

    const orderId = newOrderId();
    const event = orderCreatedEvent({ orderId, customData: { user_id: id }, email: user.email });
    const { raw, signature } = signedBody(event);
    const hook = await request(app)
      .post("/api/billing/webhooks/lemonsqueezy")
      .set("Content-Type", "application/json")
      .set("X-Signature", signature)
      .send(raw);
    expect(hook.status).toBe(200);
    await logs.waitForLine(new RegExp(`Credited user .*"orderId":"${orderId}"`));
    expect(await balance(id)).toBe(50);
    // R19: stored before the 200 and marked processed afterwards — both as the app role.
    await waitFor(async () => {
      const { rows } = await owner.query(`SELECT status, outcome FROM lemon_webhook_events WHERE provider_order_id = $1`, [orderId]);
      return rows[0]?.status === "processed" && rows[0]?.outcome === "credited";
    });
    const history = await request(app).get("/api/billing/history").set("Authorization", bearer(user));
    expect(history.status).toBe(200);
  });

  it("a signed order_refunded is recorded (credits untouched) and listed for the owner's review", async () => {
    const id = await ownerUser(0);
    const orderId = newOrderId();
    await owner.query(`SELECT post_credit_transaction($1, 50, 'CREDIT_PURCHASE', $2, 'lemonsqueezy')`, [id, `ls_order_${orderId}`]);
    const base = orderCreatedEvent({ orderId, eventName: "order_refunded", status: "refunded", refunded: true });
    const event = { ...base, data: { ...base.data, attributes: { ...base.data.attributes, refunded_amount: 500 } } };
    const { raw, signature } = signedBody(event);
    const hook = await request(app)
      .post("/api/billing/webhooks/lemonsqueezy")
      .set("Content-Type", "application/json")
      .set("X-Signature", signature)
      .send(raw);
    expect(hook.status).toBe(200);
    await logs.waitForLine(new RegExp(`Recorded refund .*"orderId":"${orderId}"`));
    expect(await balance(id)).toBe(50);
    const { rows } = await owner.query(`SELECT user_id::text FROM refunded_orders_to_review() WHERE provider_order_id = $1`, [orderId]);
    expect(rows).toEqual([{ user_id: id }]);
  });

  it("AI reservation: consume → capture, consume → refund, and the expiry sweep", async () => {
    const id = await ownerUser(5);
    const user = { id, email: (await owner.query(`SELECT email FROM users WHERE id = $1`, [id])).rows[0].email };
    const internal = (path: string, body: Record<string, unknown>) =>
      request(app)
        .post(path)
        .set("Authorization", bearer(user))
        .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
        .send(body);

    const a = randomUUID();
    expect((await internal("/api/billing/consume", { operationType: "AI_CHAT_QUERY", referenceId: a })).status).toBe(200);
    expect((await internal("/api/billing/capture", { referenceId: a })).status).toBe(200);
    const b = randomUUID();
    expect((await internal("/api/billing/consume", { operationType: "AI_CHAT_QUERY", referenceId: b })).status).toBe(200);
    expect((await internal("/api/billing/refund", { referenceId: b, reason: "test" })).status).toBe(200);
    expect(await balance(id)).toBe(4);

    await expect(releaseExpiredHolds()).resolves.toEqual(expect.any(Number));
  });
});
