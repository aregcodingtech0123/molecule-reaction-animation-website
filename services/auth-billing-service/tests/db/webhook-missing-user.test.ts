/**
 * Migration 018: webhook_missing_user_to_review() and the `webhook_missing_user` section of `npm run db:reconcile`.
 * A purchase that credited nobody because no account matched is listed until the owner has refunded it and set reviewed_at.
 * PostgreSQL 18, throwaway databases. Nothing about the ledger, balances or the existing lists changes.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
const q = (sql: string, params: unknown[] = []) => db.pool.query(sql, params);

let n = 0;
/** One stored delivery. */
async function store(opts: { order: string; status?: string; outcome?: string | null; event?: string; reviewed?: boolean; payload?: string | null }) {
  n += 1;
  const status = opts.status ?? "processed";
  await q(
    `INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status, attempts, outcome, processed_at, reviewed_at)
     VALUES (decode(lpad(to_hex($1::int), 64, '0'), 'hex'), $2, $3, $4, $5::text, 1, $6, CASE WHEN $5::text = 'processed' THEN NOW() END, CASE WHEN $7::boolean THEN NOW() END)`,
    [
      n,
      opts.event ?? "order_created",
      opts.order,
      opts.payload === undefined ? '{"user_email":"buyer@example.test"}' : opts.payload,
      status,
      opts.outcome === undefined ? "missing_user" : opts.outcome,
      opts.reviewed ?? false,
    ],
  );
}
const listed = async () => (await q(`SELECT provider_order_id FROM webhook_missing_user_to_review() ORDER BY provider_order_id`)).rows.map((r) => r.provider_order_id);

describe("webhook_missing_user_to_review()", () => {
  it("lists only processed deliveries whose outcome is missing_user and that nobody has reviewed", async () => {
    await store({ order: "m1" });
    await store({ order: "m2" });
    await store({ order: "credited", outcome: "credited" });
    await store({ order: "mismatch", outcome: "amount_mismatch" });
    await store({ order: "failed", status: "failed", outcome: null });
    await store({ order: "pending", status: "pending", outcome: null });
    await store({ order: "done", outcome: "missing_user", reviewed: true });
    expect(await listed()).toEqual(["m1", "m2"]);
  });

  it("setting reviewed_at removes exactly that order; the others stay until reviewed too", async () => {
    await store({ order: "r1" });
    await store({ order: "r2" });
    const before = await listed();
    await q(`UPDATE lemon_webhook_events SET reviewed_at = NOW() WHERE provider_order_id = 'r1' AND outcome = 'missing_user' AND reviewed_at IS NULL`);
    const after = await listed();
    expect(after).toEqual(before.filter((o) => o !== "r1"));
    expect(after).toContain("r2");
  });

  it("holds ids and times only: never the buyer e-mail or the stored message", async () => {
    await store({ order: "pii", payload: '{"user_email":"secret.buyer@example.test"}' });
    const { rows, fields } = await q(`SELECT * FROM webhook_missing_user_to_review() WHERE provider_order_id = 'pii'`);
    expect(fields.map((f) => f.name)).toEqual(["id", "event_name", "provider_order_id", "received_at", "processed_at"]);
    expect(JSON.stringify(rows)).not.toContain("secret.buyer");
  });

  it("is a read-only, SECURITY INVOKER function with a pinned search_path, and it does not touch ledger or balances", async () => {
    const meta = (await q(`SELECT prosecdef, provolatile, proconfig FROM pg_proc WHERE proname = 'webhook_missing_user_to_review'`)).rows[0];
    expect(meta).toEqual({ prosecdef: false, provolatile: "s", proconfig: ["search_path=public, pg_temp"] });
    const u = await createUser(db.pool);
    await q(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    const snapshot = async () => ({ sum: await ledgerSum(db.pool, u.id), rows: (await q(`SELECT count(*)::int AS n FROM credit_ledger_transactions`)).rows[0].n });
    const before = await snapshot();
    await listed();
    expect(await snapshot()).toEqual(before);
  });

  it("does not change what the existing lists show", async () => {
    await store({ order: "stuck", status: "failed", outcome: null });
    await q(`UPDATE lemon_webhook_events SET received_at = NOW() - INTERVAL '1 hour' WHERE provider_order_id = 'stuck'`);
    const old = (await q(`SELECT provider_order_id FROM webhook_events_to_review()`)).rows.map((r) => r.provider_order_id);
    expect(old).toContain("stuck");
    expect(old).not.toContain("m1");
    expect(await listed()).not.toContain("stuck");
  });

  it("migration 018 can be re-applied by hand (idempotent) and keeps its data", async () => {
    const sql = fs.readFileSync(path.join(serviceRoot, "../../database/init/018_webhook_missing_user_review.sql"), "utf8");
    const before = await listed();
    await q(sql);
    await q(sql);
    expect(await listed()).toEqual(before);
  });
});

describe("npm run db:reconcile, section webhook_missing_user", () => {
  function reconcile(url: string) {
    const res = spawnSync(process.execPath, [path.join(serviceRoot, "scripts", "reconcile.mjs")], {
      cwd: serviceRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", MOLECULESTUDIO_SKIP_DOTENV: "1", NODE_ENV: "development", DATABASE_URL: url },
    });
    return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
  }
  const insertOrder = (pool: ScratchDb["pool"], hex: string, order: string, outcome: string, payload = "{}") =>
    pool.query(
      `INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status, attempts, outcome, processed_at)
       VALUES (decode($1, 'hex'), 'order_created', $2, $3, 'processed', 1, $4, NOW())`,
      [hex, order, payload, outcome],
    );

  it("exits 0 and says OK when nothing is waiting; exits 2 and lists the order id (no e-mail) when a purchase credited nobody; 0 again once reviewed", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      const clean = reconcile(scratch.url);
      expect(clean.code, clean.out).toBe(0);
      expect(clean.out).toMatch(/OK — no purchase is waiting because its buyer matched no account/);

      await insertOrder(scratch.pool, "aa", "4242001", "missing_user", '{"user_email":"buyer.private@example.test"}');
      const res = reconcile(scratch.url);
      expect(res.code).toBe(2);
      expect(res.out).toMatch(/1 purchase\(s\) credited nobody because no account matched \(webhook_missing_user\)/);
      expect(res.out).toMatch(/refund the order in the Lemon dashboard, then set lemon_webhook_events\.reviewed_at/);
      expect(res.out).toContain("4242001");
      expect(res.out).not.toContain("buyer.private");

      await scratch.pool.query(`UPDATE lemon_webhook_events SET reviewed_at = NOW() WHERE provider_order_id = '4242001' AND outcome = 'missing_user' AND reviewed_at IS NULL`);
      expect(reconcile(scratch.url).code).toBe(0);
    } finally {
      await scratch.destroy();
    }
  });

  it("the other sections behave exactly as before: a credited order is not listed here, and a drifting balance is still its own finding", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      await insertOrder(scratch.pool, "bb", "7", "credited");
      expect(reconcile(scratch.url).code).toBe(0);
      const u = await createUser(scratch.pool);
      await scratch.pool.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
      await scratch.pool.query(`ALTER TABLE user_balances DISABLE TRIGGER trg_user_balances_write_guard`);
      await scratch.pool.query(`UPDATE user_balances SET balance = 99 WHERE user_id = $1`, [u.id]);
      const res = reconcile(scratch.url);
      expect(res.code).toBe(2);
      expect(res.out).toMatch(/balance_mismatch/);
      expect(res.out).toMatch(/OK — no purchase is waiting because its buyer matched no account/);
    } finally {
      await scratch.destroy();
    }
  });

  it("on a database that does not have the function yet the new section is skipped, not an error", async () => {
    const scratch = await ScratchDb.create({ migrate: true });
    try {
      await scratch.pool.query(`DROP FUNCTION webhook_missing_user_to_review()`);
      const out = reconcile(scratch.url);
      expect(out.code, out.out).toBe(0);
      expect(out.out).not.toMatch(/webhook_missing_user/);
    } finally {
      await scratch.destroy();
    }
  });
});
