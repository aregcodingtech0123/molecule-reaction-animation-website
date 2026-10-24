/**
 * The DB CLIs exactly as the runbook invokes them (node scripts/*.mjs), run
 * against throwaway databases with MOLECULESTUDIO_SKIP_DOTENV=1 so the real
 * service .env is never read.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createUser } from "../support/db";
import { ScratchDb, migrationsByPrefix } from "../support/scratch-db";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(script: string, args: string[], env: Record<string, string>) {
  const res = spawnSync(process.execPath, [path.join(serviceRoot, "scripts", script), ...args], {
    cwd: serviceRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: process.env.PATH ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      MOLECULESTUDIO_SKIP_DOTENV: "1",
      NODE_ENV: "development",
      ...env,
    },
  });
  return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
}

describe("db CLIs", () => {
  it("migrate --status / --dry-run / apply / re-apply on a fresh database", async () => {
    const db = await ScratchDb.create();
    try {
      const env = { DATABASE_URL: db.url };
      expect(run("migrate.mjs", ["--status"], env).out).toMatch(/pending\s+001_moleculestudio_core\.sql/);
      const dry = run("migrate.mjs", ["--dry-run"], env);
      expect(dry.code).toBe(0);
      expect(dry.out).toMatch(/would apply 001_/);
      expect((await db.pool.query(`SELECT to_regclass('public.users') IS NULL AS empty`)).rows[0].empty).toBe(true);

      const apply = run("migrate.mjs", [], env);
      expect(apply.code).toBe(0);
      expect(apply.out).toMatch(/mode=fresh/);
      expect(run("migrate.mjs", [], env).out).toMatch(/mode=tracked baselined=0 applied=0/);
    } finally {
      await db.destroy();
    }
  });

  it("setup-db on a legacy database fails with exit 1 and BASELINE_REQUIRED, then --baseline adopts it", async () => {
    const db = await ScratchDb.create({ migrate: migrationsByPrefix("001", "002", "003", "004", "005") });
    try {
      const env = { DATABASE_URL: db.url };
      const refused = run("setup-db.mjs", [], env);
      expect(refused.code).toBe(1);
      expect(refused.out).toMatch(/BASELINE_REQUIRED/);

      const adopted = run("setup-db.mjs", ["--baseline"], env);
      expect(adopted.code).toBe(0);
      expect(adopted.out).toMatch(/mode=baseline baselined=5/);
    } finally {
      await db.destroy();
    }
  });

  it("MIGRATION_DATABASE_URL wins over DATABASE_URL, and a pooled URL is refused", async () => {
    const db = await ScratchDb.create();
    try {
      const ok = run("migrate.mjs", [], {
        DATABASE_URL: "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db",
        MIGRATION_DATABASE_URL: db.url,
      });
      expect(ok.code).toBe(0);
      const pooled = run("migrate.mjs", [], { DATABASE_URL: "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db" });
      expect(pooled.code).toBe(1);
      expect(pooled.out).toMatch(/POOLED_URL/);
    } finally {
      await db.destroy();
    }
  });

  it("reconcile exits 0 when consistent and 2 (with a table) when a balance drifts", async () => {
    const db = await ScratchDb.create();
    try {
      const env = { DATABASE_URL: db.url };
      run("migrate.mjs", [], env);
      expect(run("reconcile.mjs", [], env).code).toBe(0);
      await createUser(db.pool, { balance: 42 });
      const drift = run("reconcile.mjs", [], env);
      expect(drift.code).toBe(2);
      expect(drift.out).toMatch(/balance_mismatch/);
    } finally {
      await db.destroy();
    }
  });

  it.each([
    ["Neon", "postgresql://u:p@ep-x-123.eu-central-1.aws.neon.tech/neondb?sslmode=require"],
    ["remote host", "postgresql://u:p@203.0.113.9:5432/molecule_studio_db"],
  ])("reset-db refuses %s before connecting (exit 1)", (_l, url) => {
    const res = run("reset-db.mjs", [], { DATABASE_URL: url });
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/Refusing to reset/);
  });

  it("reset-db refuses NODE_ENV=production even for a local URL", () => {
    const res = run("reset-db.mjs", [], { DATABASE_URL: "postgresql://postgres@127.0.0.1:55432/whatever_test", NODE_ENV: "production" });
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/NODE_ENV=production/);
  });

  it("reset-db drops, recreates and re-migrates a local database", async () => {
    const db = await ScratchDb.create();
    try {
      const env = { DATABASE_URL: db.url };
      run("migrate.mjs", [], env);
      await createUser(db.pool, { balance: 0 });
      await db.pool.end();
      const res = run("reset-db.mjs", [], env);
      expect(res.code).toBe(0);
      expect(res.out).toMatch(/Reset database/);
      expect(res.out).toMatch(/mode=fresh/);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
