/**
 * Destructive DB scripts and their connection guards. The scripts themselves
 * are not executed: they call dotenv on the real service .env, which tests
 * must never load. The guard functions they use are tested directly.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, isPooledConnectionUrl } from "../../scripts/lib/db-safety.mjs";

const resetDb = fs.readFileSync(new URL("../../scripts/reset-db.mjs", import.meta.url), "utf8");

/** Same contract as the Phase 1 helper: true when reset-db would refuse this URL. */
function refuses(databaseUrl: string): boolean {
  try {
    assertLocalDatabaseUrl(databaseUrl);
    return false;
  } catch {
    return true;
  }
}

describe("db:reset production guard", () => {
  it("reset-db.mjs runs the local-only guard before any DROP DATABASE", () => {
    const guardAt = resetDb.indexOf("assertLocalDatabaseUrl(appUrl)");
    const dropAt = resetDb.indexOf("DROP DATABASE");
    expect(guardAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(guardAt);
    expect(resetDb).toMatch(/process\.exit\(1\)/);
  });

  it("reset-db.mjs also refuses NODE_ENV=production before any DROP DATABASE (independent of the URL guard)", () => {
    const prodGuardAt = resetDb.indexOf('process.env.NODE_ENV === "production"');
    expect(prodGuardAt).toBeGreaterThan(-1);
    expect(resetDb.indexOf("DROP DATABASE")).toBeGreaterThan(prodGuardAt);
  });

  it("refuses Supabase URLs", () => {
    expect(refuses("postgresql://postgres.abc:pw@db.abc.supabase.co:5432/postgres?sslmode=require")).toBe(true);
  });

  // FINDING-29 (High) — fixed: only local hosts are accepted.
  it.each([
    ["Neon", "postgresql://u:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require"],
    ["any sslmode=require host", "postgresql://u:pw@db.example-hosting.com:5432/app?sslmode=require"],
  ])("refuses %s URLs (FINDING-29)", (_label, url) => {
    expect(refuses(url)).toBe(true);
  });

  it.each([
    ["an arbitrary remote host without sslmode", "postgresql://u:pw@10.1.2.3:5432/molecule_studio_db"],
    ["a public IP", "postgresql://u:pw@203.0.113.5/app"],
    ["a local host with sslmode=require", "postgresql://u:pw@localhost/app?sslmode=require"],
    ["a non-postgres scheme", "mysql://localhost/app"],
    ["garbage", "not a url"],
  ])("refuses %s", (_label, url) => {
    expect(refuses(url)).toBe(true);
  });

  it.each([
    "postgresql://postgres:postgres_dev_password@localhost:5432/molecule_studio_db",
    "postgresql://postgres@127.0.0.1:55432/molecule_studio_db",
    "postgres://postgres@[::1]:5432/molecule_studio_db",
    "postgresql://postgres:pw@postgres:5432/molecule_studio_db",
  ])("accepts local %s", (url) => {
    expect(refuses(url)).toBe(false);
  });
});

describe("pooled connection detection (migration runner refuses these)", () => {
  it.each([
    ["Neon pooler host", "postgresql://u:p@ep-x-123-pooler.eu-central-1.aws.neon.tech/db", true],
    ["Supabase pooler", "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres", true],
    ["port 6543", "postgresql://u:p@db.example.com:6543/app", true],
    ["?pgbouncer=true", "postgresql://u:p@db.example.com:5432/app?pgbouncer=true", true],
    ["Neon direct host", "postgresql://u:p@ep-x-123.eu-central-1.aws.neon.tech/db", false],
    ["Supabase direct", "postgresql://u:p@db.abc.supabase.co:5432/postgres", false],
    ["local", "postgresql://postgres@127.0.0.1:55432/x_test", false],
  ])("%s → %s", (_l, url, pooled) => {
    expect(isPooledConnectionUrl(url)).toBe(pooled);
  });
});
