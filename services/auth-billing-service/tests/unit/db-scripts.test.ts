/**
 * Static checks of the destructive DB scripts. They are not executed: they
 * call dotenv on the real service .env, which tests must never load.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const resetDb = fs.readFileSync(new URL("../../scripts/reset-db.mjs", import.meta.url), "utf8");
const guard = resetDb.match(/if \(([^\r\n]+)\) \{\s*console\.error\(\s*"Refusing to reset/)?.[1] ?? "";

/** Re-evaluate the script's own refusal condition for a given URL (NODE_ENV=development). */
function refuses(databaseUrl: string): boolean {
  // eslint-disable-next-line no-new-func
  return new Function("databaseUrl", "process", `return ${guard};`)(databaseUrl, { env: { NODE_ENV: "development" } });
}

describe("db:reset production guard", () => {
  it("the refusal condition can be located in reset-db.mjs", () => {
    expect(guard).toContain("databaseUrl");
  });

  it("refuses Supabase URLs", () => {
    expect(refuses("postgresql://postgres.abc:pw@db.abc.supabase.co:5432/postgres?sslmode=require")).toBe(true);
  });

  // FINDING-29 (High): README documents Neon as a production target, but reset-db only refuses
  // supabase.co — `npm run db:reset` with a Neon (or any other hosted) DATABASE_URL DROPs it.
  it.fails.each([
    ["Neon", "postgresql://u:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require"],
    ["any sslmode=require host", "postgresql://u:pw@db.example-hosting.com:5432/app?sslmode=require"],
  ])("refuses %s URLs (FINDING-29)", (_label, url) => {
    expect(refuses(url)).toBe(true);
  });
});
