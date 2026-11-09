/**
 * Phase 2C step 4: the settlement secret at the real entry point, in the modes settlement-startup.test.ts (development)
 * and production-startup.test.ts (a few production cases) do not reach: every rule under production rules, and the other
 * NODE_ENV classes. Also the one secret a startup log could print on its own: the database URL's.
 */
import { describe, expect, it } from "vitest";
import { TEST_ENV } from "../setup/env";
import { DEVELOPMENT_VARS, PRODUCTION_VARS, startService, strongSecret } from "../support/service-process";

const CURRENT = "SETTLEMENT_CAPABILITY_SECRET";
const PREVIOUS = "SETTLEMENT_CAPABILITY_SECRET_PREVIOUS";

type Vars = Record<string, string | undefined>;

const secretsIn = (vars: Vars) =>
  [CURRENT, PREVIOUS, "JWT_SECRET", "INTERNAL_SERVICE_SECRET", "EMAIL_TOMBSTONE_SECRET", "LEMONSQUEEZY_WEBHOOK_SECRET", "LEMONSQUEEZY_API_KEY", "RESEND_API_KEY"]
    .map((name) => vars[name]?.trim())
    .filter((value): value is string => Boolean(value) && value!.length >= 8);

/** Exit 1, the FATAL line, and it never served, never touched the database and printed no value. */
async function expectRefused(vars: Vars, fatal: RegExp) {
  const svc = await startService(vars);
  const health = await svc.firstHealth();
  const code = await Promise.race([svc.exited, new Promise<"running">((r) => setTimeout(() => r("running"), 5_000))]);
  await svc.stop();
  const output = svc.output();
  expect(health, `it started serving:\n${output}`).toBeNull();
  expect(code, output).toBe(1);
  expect(output).toMatch(fatal);
  expect(output).toMatch(/FATAL: refusing to start without a valid settlement capability secret\. Exiting\./);
  expect(output).not.toMatch(/running seamlessly|bound to/);
  expect(output, "the guard must run before the first database contact").not.toMatch(/\[db:config\]/);
  for (const value of secretsIn(vars)) expect(output).not.toContain(value);
}

/** Serves, with no FATAL line, and printed no value of any secret it was given. */
async function expectStarts(vars: Vars) {
  const svc = await startService(vars);
  try {
    const health = await svc.firstHealth();
    expect(health?.status, svc.output()).toBe(200);
  } finally {
    await svc.stop();
  }
  const output = svc.output();
  expect(output).not.toMatch(/FATAL/);
  for (const value of secretsIn(vars)) expect(output).not.toContain(value);
}

const shared = strongSecret();
const REFUSALS: Array<[string, () => Vars, RegExp]> = [
  ["missing", () => ({ [CURRENT]: undefined }), /FATAL: SETTLEMENT_CAPABILITY_SECRET is not set/],
  ["empty", () => ({ [CURRENT]: "" }), /FATAL: SETTLEMENT_CAPABILITY_SECRET is not set/],
  ["whitespace only", () => ({ [CURRENT]: " \t  " }), /FATAL: SETTLEMENT_CAPABILITY_SECRET is not set/],
  ["short", () => ({ [CURRENT]: "short-secret-value-12" }), /FATAL: SETTLEMENT_CAPABILITY_SECRET must be at least 32/],
  ["low entropy", () => ({ [CURRENT]: "ab".repeat(32) }), /FATAL: SETTLEMENT_CAPABILITY_SECRET has too little variety/],
  ["equal to JWT_SECRET", () => ({ [CURRENT]: TEST_ENV.JWT_SECRET }), /FATAL: SETTLEMENT_CAPABILITY_SECRET must not be the same value as JWT_SECRET/],
  ["equal to INTERNAL_SERVICE_SECRET", () => ({ [CURRENT]: TEST_ENV.INTERNAL_SERVICE_SECRET }), /FATAL: SETTLEMENT_CAPABILITY_SECRET must not be the same value as INTERNAL_SERVICE_SECRET/],
  ["equal to its own previous key", () => ({ [CURRENT]: shared, [PREVIOUS]: shared }), /FATAL: SETTLEMENT_CAPABILITY_SECRET_PREVIOUS must differ from SETTLEMENT_CAPABILITY_SECRET/],
  ["valid, with a weak previous key", () => ({ [CURRENT]: strongSecret(), [PREVIOUS]: "short-secret-value-12" }), /FATAL: SETTLEMENT_CAPABILITY_SECRET_PREVIOUS must be at least 32/],
];

describe.each([
  ["NODE_ENV=production", PRODUCTION_VARS],
  ["NODE_ENV unset (production rules)", { ...PRODUCTION_VARS, NODE_ENV: undefined }],
  ["NODE_ENV=staging (production rules)", { ...PRODUCTION_VARS, NODE_ENV: "staging" }],
] as Array<[string, Vars]>)("production rules: %s", (_label, base) => {
  it.each(REFUSALS)("refuses a secret that is %s", async (_case, vars, fatal) => {
    await expectRefused({ ...base, ...vars() }, fatal);
  }, 60_000);

  it("starts with a valid secret, and prints none of the secrets it was given", async () => {
    await expectStarts({ ...base, [CURRENT]: strongSecret() });
  }, 60_000);

  it.each(["", "   "])("starts with a blank previous key (%j): it is ignored", async (blank) => {
    await expectStarts({ ...base, [CURRENT]: strongSecret(), [PREVIOUS]: blank });
  }, 60_000);

  it("starts with a valid current and previous key (rotation)", async () => {
    await expectStarts({ ...base, [CURRENT]: strongSecret(), [PREVIOUS]: strongSecret() });
  }, 60_000);
});

describe("NODE_ENV=test: the secret is not a production-only rule", () => {
  const base: Vars = { ...DEVELOPMENT_VARS, NODE_ENV: "test" };

  it.each(REFUSALS)("refuses a secret that is %s", async (_case, vars, fatal) => {
    await expectRefused({ ...base, ...vars() }, fatal);
  }, 60_000);

  it("starts with a valid secret", async () => {
    await expectStarts({ ...base, [CURRENT]: strongSecret() });
  }, 60_000);
});

describe("the database URL in the startup log", () => {
  it("a password given as a query parameter is not printed: pg accepts this form, so it is a real credential", async () => {
    const password = `QUERYPASSWORDMARKER${strongSecret()}`;
    const sslPassword = `SSLPASSWORDMARKER${strongSecret()}`;
    const svc = await startService({
      ...DEVELOPMENT_VARS,
      [CURRENT]: strongSecret(),
      // Port 1: nothing is ever contacted, and the log lines under test come before the connection attempt.
      DATABASE_URL: `postgresql://probe_user@127.0.0.1:1/probe_db_test?password=${password}&sslpassword=${sslPassword}&sslmode=disable`,
    });
    try {
      await svc.firstHealth();
      await svc.waitForOutput(/bound to/);
    } finally {
      await svc.stop();
    }
    const output = svc.output();
    expect(output).toMatch(/DATABASE_URL \(masked\)/);
    expect(output).not.toContain("QUERYPASSWORDMARKER");
    expect(output).not.toContain("SSLPASSWORDMARKER");
    expect(output, "the diagnostic value of the URL stays").toContain("sslmode=disable");
  }, 60_000);
});
