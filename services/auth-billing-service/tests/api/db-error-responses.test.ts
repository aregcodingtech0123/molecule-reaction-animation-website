/**
 * Phase 2C step 4: what the database's error text can reach over HTTP. `/health` `databaseError` and requireDatabase `details`
 * and `pgCode` are development-only. These tests pin that gate on the real process, in every other mode, and the one thing that
 * must hold in development too: the password never appears.
 *
 * Whether the development responses should exist at all is a separate decision, reported with the Step 4 results.
 */
import { describe, expect, it } from "vitest";
import { DEVELOPMENT_VARS, PRODUCTION_VARS, startService, strongSecret } from "../support/service-process";

const USER_MARKER = "dbusermarker77";
const PASSWORD_MARKER = "DBPASSWORDMARKER88";
/** Port 1: refused at once, so the service has a real connection error to report. */
const UNREACHABLE = `postgresql://${USER_MARKER}:${PASSWORD_MARKER}@127.0.0.1:1/probe_db_test`;

async function withUnreachableDatabase<T>(vars: Record<string, string | undefined>, work: (url: string, output: () => string) => Promise<T>): Promise<T> {
  const svc = await startService({ ...vars, SETTLEMENT_CAPABILITY_SECRET: strongSecret(), DATABASE_URL: UNREACHABLE });
  try {
    expect((await svc.firstHealth())?.status, svc.output()).toBe(503);
    return await work(svc.url, svc.output);
  } finally {
    await svc.stop();
  }
}

describe.each<[string, Record<string, string | undefined>]>([
  ["production", PRODUCTION_VARS],
  ["unset (production rules)", { ...PRODUCTION_VARS, NODE_ENV: undefined }],
  ["staging (production rules)", { ...PRODUCTION_VARS, NODE_ENV: "staging" }],
  ["test", { ...DEVELOPMENT_VARS, NODE_ENV: "test" }],
])("NODE_ENV %s: no database error text over HTTP", (_label, vars) => {
  it("/health and a database route answer with fixed text only", async () => {
    await withUnreachableDatabase(vars, async (url, output) => {
      const health = await fetch(`${url}/health`);
      expect(health.status).toBe(503);
      expect(await health.json()).toEqual({ success: false, service: "auth-billing-service", status: "degraded", database: "unavailable" });

      const route = await fetch(`${url}/api/billing/operation-costs`);
      expect(route.status).toBe(503);
      expect(await route.json()).toEqual({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" });

      expect(output()).not.toContain(PASSWORD_MARKER);
    });
  }, 60_000);
});

describe("NODE_ENV development: the responses that do carry error text", () => {
  it("never contain the password, in the body or in the log", async () => {
    await withUnreachableDatabase(DEVELOPMENT_VARS, async (url, output) => {
      const healthText = await (await fetch(`${url}/health`)).text();
      const routeText = await (await fetch(`${url}/api/billing/operation-costs`)).text();
      expect(healthText).not.toContain(PASSWORD_MARKER);
      expect(routeText).not.toContain(PASSWORD_MARKER);
      expect(output()).not.toContain(PASSWORD_MARKER);
    });
  }, 60_000);
});
