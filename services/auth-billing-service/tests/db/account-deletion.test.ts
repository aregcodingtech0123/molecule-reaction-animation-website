/**
 * Migration 017: anonymise_user(), purge_email_tombstones() and `npm run db:process-deletions`
 * (docs/seo/ACCOUNT_DELETION_IMPLEMENTATION.md). PostgreSQL 18, throwaway databases.
 * The ledger is immutable: every test that anonymises also proves the ledger, the balance and the triggers are untouched.
 */
import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, ledgerSum } from "../support/db";
import { ScratchDb } from "../support/scratch-db";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HASH = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
const HMAC = Buffer.alloc(32, 7);
let db: ScratchDb;
beforeAll(async () => {
  db = await ScratchDb.create({ migrate: true });
});
afterAll(async () => {
  await db?.destroy();
});

const q = (sql: string, params: unknown[] = []) => db.pool.query(sql, params);

/** A user who asked for deletion `days` ago (null = never asked). */
async function userRequested(days: number | null, opts: { admin?: boolean; balance?: boolean } = {}) {
  const u = await createUser(db.pool);
  await q(
    `UPDATE users SET deletion_requested_at = CASE WHEN $2::int IS NULL THEN NULL ELSE NOW() - make_interval(days => $2::int) END,
                      is_admin = $3, signup_ip = '203.0.113.5', first_name = 'Ada', last_name = 'Lovelace', date_of_birth = '1990-01-01'
      WHERE id = $1`,
    [u.id, days, opts.admin ?? false],
  );
  if (opts.balance) {
    await q(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    await q(`SELECT post_credit_transaction($1, -3, 'CREDIT_CONSUMPTION', $2)`, [u.id, `turn-${randomUUID()}`]);
  }
  return u;
}
const anonymise = async (id: string, hmac: Buffer | null = null) =>
  (await q(`SELECT anonymise_user($1::uuid, $2, $3::bytea) AS r`, [id, HASH, hmac])).rows[0].r as string;
const row = async (id: string) => (await q(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];

describe("anonymise_user()", () => {
  it("returns not_found / not_due and changes nothing", async () => {
    expect(await anonymise(randomUUID())).toBe("not_found");
    const never = await userRequested(null);
    const recent = await userRequested(5);
    const almost = await userRequested(13);
    const before = [await row(never.id), await row(recent.id), await row(almost.id)];
    expect(await anonymise(never.id)).toBe("not_due");
    expect(await anonymise(recent.id)).toBe("not_due");
    expect(await anonymise(almost.id)).toBe("not_due");
    expect([await row(never.id), await row(recent.id), await row(almost.id)]).toEqual(before);
  });

  it("a due account: e-mail, credentials, profile and signup address are gone, sessions die, the row and its id stay", async () => {
    const u = await userRequested(15);
    await q(`INSERT INTO oauth_accounts (user_id, provider, provider_account_id) VALUES ($1, 'google', $2)`, [u.id, `g-${randomUUID()}`]);
    await q(`INSERT INTO verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [u.id, "a1".repeat(32)]);
    await q(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [u.id, "b2".repeat(32)]);
    const before = await row(u.id);

    expect(await anonymise(u.id)).toBe("anonymised");

    const after = await row(u.id);
    expect(after).toMatchObject({
      id: u.id,
      email: `deleted-${u.id}@invalid`,
      password_hash: HASH,
      first_name: null,
      last_name: null,
      date_of_birth: null,
      signup_ip: null,
      is_verified: false,
      token_version: before.token_version + 1,
      is_admin: false,
    });
    expect(after.anonymised_at).toBeInstanceOf(Date);
    expect(after.created_at).toEqual(before.created_at);
    expect(after.deletion_requested_at).toEqual(before.deletion_requested_at);
    for (const table of ["oauth_accounts", "verification_tokens", "password_reset_tokens"]) {
      expect((await q(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [u.id])).rows[0].n).toBe(0);
    }
    expect(u.email).not.toBe(after.email);
  });

  it("is idempotent: a second run says 'already' and changes nothing", async () => {
    const u = await userRequested(20);
    expect(await anonymise(u.id)).toBe("anonymised");
    const once = await row(u.id);
    expect(await anonymise(u.id)).toBe("already");
    expect(await row(u.id)).toEqual(once);
  });

  it("an administrator is never anonymised by the job", async () => {
    const admin = await userRequested(30, { admin: true });
    const before = await row(admin.id);
    expect(await anonymise(admin.id)).toBe("admin_skipped");
    expect(await row(admin.id)).toEqual(before);
  });

  it("is postponed ('busy') while an unexpired AI reservation or a recent pending checkout exists, and goes through once they are gone", async () => {
    const hold = await userRequested(20);
    await q(`INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, status, expires_at) VALUES ($1, 'h1', 'chat', 1, 'held', NOW() + INTERVAL '5 minutes')`, [hold.id]);
    expect(await anonymise(hold.id)).toBe("busy");
    expect((await row(hold.id)).anonymised_at).toBeNull();
    await q(`UPDATE ai_credit_holds SET status = 'released', settled_at = NOW() WHERE user_id = $1`, [hold.id]);
    expect(await anonymise(hold.id)).toBe("anonymised");

    const order = await userRequested(20);
    await q(`INSERT INTO pending_checkout_orders (user_id, package_id, provider, currency, amount_minor, credits, status) VALUES ($1, 'starter', 'lemonsqueezy', 'USD', 499, 50, 'pending')`, [order.id]);
    expect(await anonymise(order.id)).toBe("busy");
    await q(`UPDATE pending_checkout_orders SET status = 'completed', completed_at = NOW() WHERE user_id = $1`, [order.id]);
    expect(await anonymise(order.id)).toBe("anonymised");
  });

  it("an expired reservation or a stale (older than 24 h) pending order does not block forever", async () => {
    const u = await userRequested(20);
    await q(`INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, status, expires_at) VALUES ($1, 'h-old', 'chat', 1, 'held', NOW() - INTERVAL '1 hour')`, [u.id]);
    await q(`INSERT INTO pending_checkout_orders (user_id, package_id, provider, currency, amount_minor, credits, status, created_at) VALUES ($1, 'starter', 'lemonsqueezy', 'USD', 499, 50, 'pending', NOW() - INTERVAL '25 hours')`, [u.id]);
    expect(await anonymise(u.id)).toBe("anonymised");
  });

  it("LEDGER AND BALANCE UNTOUCHED: rows, sums, balance and reconciliation are identical before and after; pending orders and holds keep their rows", async () => {
    const u = await userRequested(40, { balance: true });
    await q(`INSERT INTO pending_checkout_orders (user_id, package_id, provider, currency, amount_minor, credits, status) VALUES ($1, 'starter', 'lemonsqueezy', 'USD', 499, 50, 'completed')`, [u.id]);
    const snapshot = async () => ({
      ledger: (await q(`SELECT * FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY id`, [u.id])).rows,
      balance: (await q(`SELECT * FROM user_balances WHERE user_id = $1`, [u.id])).rows,
      orders: (await q(`SELECT * FROM pending_checkout_orders WHERE user_id = $1`, [u.id])).rows,
      sum: await ledgerSum(db.pool, u.id),
    });
    const before = await snapshot();
    expect(before.sum).toBe(7);
    expect(await anonymise(u.id, HMAC)).toBe("anonymised");
    expect(await snapshot()).toEqual(before);
    expect((await q(`SELECT count(*)::int AS n FROM ledger_reconciliation() WHERE user_id = $1`, [u.id])).rows[0].n).toBe(0);
  });

  it("the ledger triggers and the balance guard are exactly as before, still refuse updates and deletes, and users has only its updated_at trigger", async () => {
    const trig = async (table: string) =>
      (await q(`SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY 1`, [table])).rows.map((r) => r.tgname);
    expect(await trig("credit_ledger_transactions")).toEqual(["trg_credit_ledger_no_delete", "trg_credit_ledger_no_truncate", "trg_credit_ledger_no_update"]);
    expect(await trig("user_balances")).toEqual(["trg_user_balances_no_truncate", "trg_user_balances_write_guard"]);
    expect(await trig("users")).toEqual(["trg_users_set_updated_at"]);
    const u = await userRequested(40, { balance: true });
    await anonymise(u.id);
    await expect(q(`UPDATE credit_ledger_transactions SET amount = 99 WHERE user_id = $1`, [u.id])).rejects.toThrow();
    await expect(q(`DELETE FROM credit_ledger_transactions WHERE user_id = $1`, [u.id])).rejects.toThrow();
    await expect(q(`DELETE FROM users WHERE id = $1`, [u.id])).rejects.toMatchObject({ code: "23001" }); // ON DELETE RESTRICT still holds
    expect(await ledgerSum(db.pool, u.id)).toBe(7);
  });

  it("with an HMAC it writes exactly one 32-byte tombstone and no e-mail anywhere; without one, none", async () => {
    const withKey = await userRequested(20);
    const hmac = createHmac("sha256", "k").update(withKey.email).digest();
    expect(await anonymise(withKey.id, hmac)).toBe("anonymised");
    const tomb = await q(`SELECT email_hmac FROM deleted_email_tombstones WHERE email_hmac = $1`, [hmac]);
    expect(tomb.rowCount).toBe(1);
    expect(tomb.rows[0].email_hmac).toHaveLength(32);
    const columns = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'deleted_email_tombstones' ORDER BY 1`)).rows.map((r) => r.column_name);
    expect(columns).toEqual(["created_at", "email_hmac"]);
    expect(JSON.stringify((await q(`SELECT * FROM deleted_email_tombstones`)).rows)).not.toContain(withKey.email);

    const before = (await q(`SELECT count(*)::int AS n FROM deleted_email_tombstones`)).rows[0].n;
    const noKey = await userRequested(20);
    expect(await anonymise(noKey.id, null)).toBe("anonymised");
    expect((await q(`SELECT count(*)::int AS n FROM deleted_email_tombstones`)).rows[0].n).toBe(before);
  });

  it("the same address anonymised twice (delete, re-register, delete) keeps one tombstone and refreshes its date", async () => {
    const key = Buffer.alloc(32, 9);
    const a = await userRequested(20);
    await anonymise(a.id, key);
    await q(`UPDATE deleted_email_tombstones SET created_at = NOW() - INTERVAL '6 months' WHERE email_hmac = $1`, [key]);
    const b = await userRequested(20);
    await anonymise(b.id, key);
    const rows = (await q(`SELECT created_at > NOW() - INTERVAL '1 minute' AS fresh FROM deleted_email_tombstones WHERE email_hmac = $1`, [key])).rows;
    expect(rows).toEqual([{ fresh: true }]);
  });

  it("refuses a grace period under one day, a missing/short hash and an HMAC that is not 32 bytes (22023) and changes nothing", async () => {
    const u = await userRequested(20);
    await expect(q(`SELECT anonymise_user($1::uuid, $2, NULL, INTERVAL '0 days')`, [u.id, HASH])).rejects.toMatchObject({ code: "22023" });
    await expect(q(`SELECT anonymise_user($1::uuid, $2, NULL, INTERVAL '23 hours')`, [u.id, HASH])).rejects.toMatchObject({ code: "22023" });
    await expect(q(`SELECT anonymise_user($1::uuid, NULL)`, [u.id])).rejects.toMatchObject({ code: "22023" });
    await expect(q(`SELECT anonymise_user($1::uuid, 'short')`, [u.id])).rejects.toMatchObject({ code: "22023" });
    await expect(q(`SELECT anonymise_user($1::uuid, $2, $3::bytea)`, [u.id, HASH, Buffer.alloc(31)])).rejects.toMatchObject({ code: "22023" });
    expect((await row(u.id)).anonymised_at).toBeNull();
  });

  it("is a SECURITY INVOKER function with a pinned search_path, not executable by PUBLIC", async () => {
    const { rows } = await q(
      `SELECT p.proname, p.prosecdef AS definer, p.proconfig AS config, has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
         FROM pg_proc p WHERE p.proname IN ('anonymise_user', 'purge_email_tombstones') ORDER BY 1`,
    );
    expect(rows).toEqual([
      { proname: "anonymise_user", definer: false, config: ["search_path=public, pg_temp"], public_exec: false },
      { proname: "purge_email_tombstones", definer: false, config: ["search_path=public, pg_temp"], public_exec: false },
    ]);
  });

  it("migration 017 can be re-applied by hand (idempotent) and keeps its data", async () => {
    const key = Buffer.alloc(32, 3);
    await q(`INSERT INTO deleted_email_tombstones (email_hmac) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
    const sql = fs.readFileSync(path.join(serviceRoot, "../../database/init/017_account_deletion.sql"), "utf8");
    await q(sql);
    await q(sql);
    expect((await q(`SELECT count(*)::int AS n FROM deleted_email_tombstones WHERE email_hmac = $1`, [key])).rows[0].n).toBe(1);
  });
});

describe("purge_email_tombstones()", () => {
  it("removes tombstones older than 12 months, keeps newer ones, returns the count and is idempotent", async () => {
    await q(`DELETE FROM deleted_email_tombstones`);
    await q(`INSERT INTO deleted_email_tombstones (email_hmac, created_at) VALUES ($1, NOW() - INTERVAL '13 months'), ($2, NOW() - INTERVAL '11 months'), ($3, NOW())`, [
      Buffer.alloc(32, 1),
      Buffer.alloc(32, 2),
      Buffer.alloc(32, 3),
    ]);
    expect((await q(`SELECT purge_email_tombstones() AS n`)).rows[0].n).toBe(1);
    expect((await q(`SELECT count(*)::int AS n FROM deleted_email_tombstones`)).rows[0].n).toBe(2);
    expect((await q(`SELECT purge_email_tombstones() AS n`)).rows[0].n).toBe(0);
    expect((await q(`SELECT purge_email_tombstones(INTERVAL '30 days') AS n`)).rows[0].n).toBe(1);
  });

  it.each(["29 days", "0 days", "-1 year"])("refuses a retention under 30 days (%s)", async (interval) => {
    await expect(q(`SELECT purge_email_tombstones($1::interval)`, [interval])).rejects.toMatchObject({ code: "22023" });
  });
  it("refuses NULL", async () => {
    await expect(q(`SELECT purge_email_tombstones(NULL)`)).rejects.toMatchObject({ code: "22023" });
  });
});

describe("npm run db:process-deletions", () => {
  const SECRET = "cli-tombstone-secret-0123456789abcdef-XYZ";
  function run(url: string, env: Record<string, string> = {}, args: string[] = []): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(serviceRoot, "scripts", "process-deletions.mjs"), ...args], {
        cwd: serviceRoot,
        env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", MOLECULESTUDIO_SKIP_DOTENV: "1", NODE_ENV: "development", DATABASE_URL: url, EMAIL_TOMBSTONE_SECRET: SECRET, ...env },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
    });
  }
  const tombstones = async (url: string) => {
    const pool = new (await import("pg")).default.Pool({ connectionString: url });
    try {
      return (await pool.query(`SELECT encode(email_hmac, 'hex') AS h FROM deleted_email_tombstones`)).rows.map((r) => r.h as string);
    } finally {
      await pool.end();
    }
  };

  it("anonymises the due accounts, stores HMAC-SHA256(secret, lower(trim(email))) and prints counts only", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const due = await createUser(scratch.pool, { email: "  Mixed.Case@Example.TEST " });
      const young = await createUser(scratch.pool);
      const admin = await createUser(scratch.pool);
      await scratch.pool.query(`UPDATE users SET deletion_requested_at = NOW() - INTERVAL '15 days' WHERE id = $1`, [due.id]);
      await scratch.pool.query(`UPDATE users SET deletion_requested_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [young.id]);
      await scratch.pool.query(`UPDATE users SET deletion_requested_at = NOW() - INTERVAL '30 days', is_admin = true WHERE id = $1`, [admin.id]);

      const res = await run(scratch.url);
      expect(res.code, res.out).toBe(0);
      expect(res.out).toMatch(/anonymised 1 account\(s\); 0 postponed .*0 skipped for other reasons; 0 failed; removed 0 expired/);
      expect(res.out).not.toContain(due.id);
      expect(res.out.toLowerCase()).not.toContain("example.test");
      expect(res.out).not.toContain(SECRET);

      const states = (await scratch.pool.query(`SELECT id, anonymised_at IS NOT NULL AS gone FROM users WHERE id = ANY($1)`, [[due.id, young.id, admin.id]])).rows;
      expect(Object.fromEntries(states.map((s) => [s.id, s.gone]))).toEqual({ [due.id]: true, [young.id]: false, [admin.id]: false });
      const expected = createHmac("sha256", SECRET).update("mixed.case@example.test").digest("hex");
      expect(await tombstones(scratch.url)).toEqual([expected]);
      // A second run has nothing left to do.
      expect((await run(scratch.url)).out).toMatch(/anonymised 0 account\(s\)/);
    } finally {
      await scratch.destroy();
    }
  });

  it("with the guard off (EMAIL_TOMBSTONE_GUARD=false) it anonymises without a secret and stores no tombstone", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const u = await createUser(scratch.pool);
      await scratch.pool.query(`UPDATE users SET deletion_requested_at = NOW() - INTERVAL '15 days' WHERE id = $1`, [u.id]);
      const res = await run(scratch.url, { EMAIL_TOMBSTONE_GUARD: "false", EMAIL_TOMBSTONE_SECRET: "" });
      expect(res.code, res.out).toBe(0);
      expect(res.out).toMatch(/anonymised 1 account/);
      expect(await tombstones(scratch.url)).toEqual([]);
    } finally {
      await scratch.destroy();
    }
  });

  it.each([
    ["no secret", { EMAIL_TOMBSTONE_SECRET: "" }],
    ["a short secret", { EMAIL_TOMBSTONE_SECRET: "too-short" }],
    ["an invalid guard flag", { EMAIL_TOMBSTONE_GUARD: "perhaps" }],
  ])("%s while the guard is on: refuses, exit 1, nobody is anonymised (never an unkeyed hash)", async (_label, env) => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const u = await createUser(scratch.pool);
      await scratch.pool.query(`UPDATE users SET deletion_requested_at = NOW() - INTERVAL '15 days' WHERE id = $1`, [u.id]);
      const res = await run(scratch.url, env);
      expect(res.code).toBe(1);
      expect((await scratch.pool.query(`SELECT anonymised_at FROM users WHERE id = $1`, [u.id])).rows[0].anonymised_at).toBeNull();
      expect(await tombstones(scratch.url)).toEqual([]);
    } finally {
      await scratch.destroy();
    }
  });

  it("--dry-run reports the number due and changes nothing; a bad argument exits 64", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const u = await createUser(scratch.pool);
      await scratch.pool.query(`UPDATE users SET deletion_requested_at = NOW() - INTERVAL '15 days' WHERE id = $1`, [u.id]);
      const dry = await run(scratch.url, {}, ["--dry-run"]);
      expect(dry.code).toBe(0);
      expect(dry.out).toMatch(/dry run: 1 account\(s\) are due; nothing was changed/);
      expect((await scratch.pool.query(`SELECT anonymised_at FROM users WHERE id = $1`, [u.id])).rows[0].anonymised_at).toBeNull();
      expect((await run(scratch.url, {}, ["--now"])).code).toBe(64);
    } finally {
      await scratch.destroy();
    }
  });

  it("postpones an account with an open reservation and counts it", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const u = await createUser(scratch.pool);
      await scratch.pool.query(`UPDATE users SET deletion_requested_at = NOW() - INTERVAL '15 days' WHERE id = $1`, [u.id]);
      await scratch.pool.query(`INSERT INTO ai_credit_holds (user_id, reference_id, operation_type, amount, status, expires_at) VALUES ($1, 'h', 'chat', 1, 'held', NOW() + INTERVAL '5 minutes')`, [u.id]);
      const res = await run(scratch.url);
      expect(res.code).toBe(0);
      expect(res.out).toMatch(/anonymised 0 account\(s\); 1 postponed/);
      expect((await scratch.pool.query(`SELECT anonymised_at FROM users WHERE id = $1`, [u.id])).rows[0].anonymised_at).toBeNull();
    } finally {
      await scratch.destroy();
    }
  });

  it("removes expired tombstones in the same run", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      await scratch.pool.query(`INSERT INTO deleted_email_tombstones (email_hmac, created_at) VALUES ($1, NOW() - INTERVAL '13 months'), ($2, NOW())`, [Buffer.alloc(32, 1), Buffer.alloc(32, 2)]);
      const res = await run(scratch.url);
      expect(res.code).toBe(0);
      expect(res.out).toMatch(/removed 1 expired e-mail tombstone/);
      expect(await tombstones(scratch.url)).toEqual([Buffer.alloc(32, 2).toString("hex")]);
    } finally {
      await scratch.destroy();
    }
  });

  it("on a database without migration 017 it says so and exits 1", async () => {
    const old = await ScratchDb.create({ migrate: false });
    try {
      const res = await run(old.url);
      expect(res.code).toBe(1);
      expect(res.out).toMatch(/migration 017 is not applied/);
    } finally {
      await old.destroy();
    }
  });

  describe("heartbeat (DELETION_HEARTBEAT_URL)", () => {
    let server: http.Server;
    let base: string;
    const hits: string[] = [];
    let status = 200;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        hits.push(`${req.method} ${req.url}`);
        res.statusCode = status;
        res.end("ok");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await new Promise((r) => server.close(r));
    });

    it("pings once after a successful run, never prints the secret path; exit 2 when the monitor answers 500; no ping when the run fails", async () => {
      const scratch = await ScratchDb.create({ migrate: true });
      try {
        hits.length = 0;
        status = 200;
        const ok = await run(scratch.url, { DELETION_HEARTBEAT_URL: `${base}/ping/SECRET-DEL-1` });
        expect(ok.code, ok.out).toBe(0);
        expect(hits).toEqual(["GET /ping/SECRET-DEL-1"]);
        expect(ok.out).toMatch(/\[process-deletions\] heartbeat sent to 127\.0\.0\.1:\d+/);
        expect(ok.out).not.toContain("SECRET-DEL-1");

        status = 500;
        const bad = await run(scratch.url, { DELETION_HEARTBEAT_URL: `${base}/ping/SECRET-DEL-2` });
        expect(bad.code).toBe(2);
        expect(bad.out).not.toContain("SECRET-DEL-2");

        hits.length = 0;
        status = 200;
        const refused = await run(scratch.url, { DELETION_HEARTBEAT_URL: `${base}/ping/x`, EMAIL_TOMBSTONE_SECRET: "" });
        expect(refused.code).toBe(1);
        expect(hits).toEqual([]);
      } finally {
        await scratch.destroy();
      }
    });
  });
});
