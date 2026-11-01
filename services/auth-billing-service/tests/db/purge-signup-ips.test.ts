/**
 * Migration 016: purge_signup_ips() and `npm run db:purge-signup-ips` (docs/seo/PRIVACY_FOLLOWUPS.md §1).
 * PostgreSQL 18, throwaway databases. The ledger is never touched.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, ledgerSum } from "../support/db";
import { ScratchDb } from "../support/scratch-db";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let db: ScratchDb;
beforeAll(async () => {
  db = await ScratchDb.create({ migrate: true });
});
afterAll(async () => {
  await db?.destroy();
});

/** A user created `ageDays` ago with the given signup address. */
async function userAged(ageDays: number, ip: string | null) {
  const u = await createUser(db.pool);
  await db.pool.query(
    `UPDATE users SET signup_ip = $2::inet, created_at = NOW() - make_interval(days => $3::int) WHERE id = $1`,
    [u.id, ip, ageDays],
  );
  return u;
}
const ipOf = async (id: string) => (await db.pool.query(`SELECT host(signup_ip) AS ip FROM users WHERE id = $1`, [id])).rows[0].ip as string | null;

describe("purge_signup_ips()", () => {
  it("clears addresses older than the retention, keeps newer ones, and returns how many it cleared", async () => {
    const old1 = await userAged(120, "203.0.113.10");
    const old2 = await userAged(91, "2001:db8::1");
    const edge = await userAged(89, "203.0.113.11");
    const fresh = await userAged(0, "203.0.113.12");
    const none = await userAged(400, null);

    const { rows } = await db.pool.query(`SELECT purge_signup_ips() AS cleared`);
    expect(rows[0].cleared).toBe(2);
    expect(await ipOf(old1.id)).toBeNull();
    expect(await ipOf(old2.id)).toBeNull();
    expect(await ipOf(edge.id)).toBe("203.0.113.11");
    expect(await ipOf(fresh.id)).toBe("203.0.113.12");
    expect(await ipOf(none.id)).toBeNull();
  });

  it("is idempotent: a second run clears nothing", async () => {
    await userAged(200, "198.51.100.7");
    expect((await db.pool.query(`SELECT purge_signup_ips() AS cleared`)).rows[0].cleared).toBe(1);
    expect((await db.pool.query(`SELECT purge_signup_ips() AS cleared`)).rows[0].cleared).toBe(0);
  });

  it("takes a custom retention", async () => {
    const u = await userAged(10, "198.51.100.8");
    expect((await db.pool.query(`SELECT purge_signup_ips(INTERVAL '7 days') AS cleared`)).rows[0].cleared).toBeGreaterThanOrEqual(1);
    expect(await ipOf(u.id)).toBeNull();
  });

  it("changes nothing but signup_ip (and updated_at, by the existing trigger): email, names, hash, flags, balance and ledger stay", async () => {
    const u = await userAged(300, "192.0.2.55");
    await db.pool.query(`SELECT post_credit_transaction($1, 5, 'SIGNUP_BONUS', 'signup-bonus-keep')`, [u.id]);
    const before = (await db.pool.query(`SELECT email, password_hash, first_name, last_name, date_of_birth, is_verified, is_admin, token_version, created_at FROM users WHERE id = $1`, [u.id])).rows[0];
    const ledgerBefore = (await db.pool.query(`SELECT * FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY id`, [u.id])).rows;
    const balanceBefore = (await db.pool.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [u.id])).rows[0];

    await db.pool.query(`SELECT purge_signup_ips()`);

    expect(await ipOf(u.id)).toBeNull();
    expect((await db.pool.query(`SELECT email, password_hash, first_name, last_name, date_of_birth, is_verified, is_admin, token_version, created_at FROM users WHERE id = $1`, [u.id])).rows[0]).toEqual(before);
    expect((await db.pool.query(`SELECT * FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY id`, [u.id])).rows).toEqual(ledgerBefore);
    expect((await db.pool.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [u.id])).rows[0]).toEqual(balanceBefore);
    expect(await ledgerSum(db.pool, u.id)).toBe(5);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM ledger_reconciliation()`)).rows[0].n).toBe(0);
  });

  it.each(["0 days", "23 hours", "-5 days"])("refuses a retention below one day (%s) and clears nothing", async (interval) => {
    const u = await userAged(30, "192.0.2.77");
    await expect(db.pool.query(`SELECT purge_signup_ips($1::interval)`, [interval])).rejects.toMatchObject({ code: "22023" });
    expect(await ipOf(u.id)).toBe("192.0.2.77");
  });

  it("refuses NULL", async () => {
    await expect(db.pool.query(`SELECT purge_signup_ips(NULL)`)).rejects.toMatchObject({ code: "22023" });
  });

  it("is not executable by PUBLIC (only the owner and roles granted it); the application role is not granted it", async () => {
    const { rows } = await db.pool.query(
      `SELECT has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
              has_function_privilege(p.proowner, p.oid, 'EXECUTE') AS owner_exec,
              p.prosecdef AS definer, p.proconfig AS config
       FROM pg_proc p WHERE p.proname = 'purge_signup_ips'`,
    );
    expect(rows).toEqual([{ public_exec: false, owner_exec: true, definer: false, config: ["search_path=public, pg_temp"] }]);
  });

  it("migration 016 can be re-applied by hand (idempotent)", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync(path.join(serviceRoot, "../../database/init/016_signup_ip_retention.sql"), "utf8");
    await db.pool.query(sql);
    await db.pool.query(sql);
    expect((await db.pool.query(`SELECT has_function_privilege('public', 'purge_signup_ips(interval)', 'EXECUTE') AS e`)).rows[0].e).toBe(false);
  });
});

describe("npm run db:purge-signup-ips", () => {
  function run(args: string[], url: string) {
    const res = spawnSync(process.execPath, [path.join(serviceRoot, "scripts", "purge-signup-ips.mjs"), ...args], {
      cwd: serviceRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", MOLECULESTUDIO_SKIP_DOTENV: "1", NODE_ENV: "development", DATABASE_URL: url },
    });
    return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
  }

  it("clears with the default and with --days, prints a count and never an address", async () => {
    const a = await userAged(100, "203.0.113.201");
    const b = await userAged(40, "203.0.113.202");
    const first = run([], db.url);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/cleared \d+ signup address\(es\) older than 90 days/);
    expect(first.out).not.toMatch(/203\.0\.113\./);
    expect(await ipOf(a.id)).toBeNull();
    expect(await ipOf(b.id)).toBe("203.0.113.202");

    const second = run(["--days", "30"], db.url);
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/older than 30 days/);
    expect(await ipOf(b.id)).toBeNull();
  });

  it.each([["--days"], ["--days", "0"], ["--days", "ten"], ["90"], ["--days", "5", "extra"]])("a bad argument %j exits 64 with usage", (...args) => {
    const res = run(args, db.url);
    expect(res.code).toBe(64);
    expect(res.out).toMatch(/Usage: node scripts\/purge-signup-ips\.mjs/);
  });

  it("on a database without migration 016 it says so and exits 1", async () => {
    const old = await ScratchDb.create({ migrate: false });
    try {
      const res = run([], old.url);
      expect(res.code).toBe(1);
      expect(res.out).toMatch(/apply migration 016 first/);
    } finally {
      await old.destroy();
    }
  });
});
