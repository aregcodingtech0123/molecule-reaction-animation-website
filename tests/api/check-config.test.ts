/**
 * `npm run check:config` (owner decision after Part 2A): both services' production env, checked together.
 * The pure check is exercised directly; the CLI is spawned for exit codes and to prove that no value —
 * secret or not — is ever printed.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { checkConfig, TTL_MARGIN } from "../../scripts/check-config.mjs";

const root = path.resolve(__dirname, "../..");
const secret = () => randomBytes(36).toString("base64url");
const shared = { INTERNAL_SERVICE_SECRET: secret(), JWT_SECRET: secret(), FRONTEND_URL: "https://studio.example" };

function serviceEnv(over: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    DATABASE_URL: `postgresql://app:${secret()}@db.internal.example/molecule`,
    ...shared,
    GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
    LEMONSQUEEZY_WEBHOOK_SECRET: secret().slice(0, 40),
    LEMONSQUEEZY_API_KEY: `lsk_${secret()}`,
    LEMONSQUEEZY_STORE_ID: "4242",
    LEMONSQUEEZY_VARIANT_STARTER: "700001",
    LEMONSQUEEZY_VARIANT_PRO: "700002",
    LEMONSQUEEZY_VARIANT_ENTERPRISE: "700003",
    RESEND_API_KEY: `re_${secret()}`,
    SENDER_EMAIL: "Molecule Studio <hello@studio.example>",
    AI_HOLD_TTL_SECONDS: "600",
    ...over,
  };
}
function webEnv(over: Record<string, string | undefined> = {}) {
  return {
    ...shared,
    AUTH_SERVICE_URL: "https://api.studio.example/api/auth",
    BILLING_SERVICE_URL: "https://api.studio.example/api/billing",
    USERS_SERVICE_URL: "https://api.studio.example/api/users",
    GEMINI_API_KEY: `AIza${secret()}`,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
    CLIENT_IP_HEADER: "x-forwarded-for",
    ...over,
  };
}

describe("checkConfig", () => {
  it("a complete, consistent production configuration passes without warnings", () => {
    expect(checkConfig(serviceEnv(), webEnv())).toMatchObject({ problems: [], warnings: [] });
  });

  it.each([
    ["INTERNAL_SERVICE_SECRET", /INTERNAL_SERVICE_SECRET differs between service and web/],
    ["JWT_SECRET", /JWT_SECRET differs between service and web/],
  ])("%s differing between the two sides is a problem", (name, message) => {
    const { problems } = checkConfig(serviceEnv(), webEnv({ [name]: secret() }));
    expect(problems).toEqual([expect.stringMatching(message)]);
  });

  it("FRONTEND_URL must be the same origin on both sides (a trailing slash is the same origin)", () => {
    expect(checkConfig(serviceEnv(), webEnv({ FRONTEND_URL: "https://studio.example/" })).problems).toEqual([]);
    expect(checkConfig(serviceEnv(), webEnv({ FRONTEND_URL: "https://www.studio.example" })).problems).toEqual([
      expect.stringMatching(/FRONTEND_URL differs between service and web/),
    ]);
  });

  it("the Google client id must match (service audience vs browser client)", () => {
    expect(checkConfig(serviceEnv(), webEnv({ NEXT_PUBLIC_GOOGLE_CLIENT_ID: "999-other.apps.googleusercontent.com" })).problems).toEqual([
      expect.stringMatching(/GOOGLE_CLIENT_ID \(service\) differs from NEXT_PUBLIC_GOOGLE_CLIENT_ID/),
    ]);
  });

  it(`hold TTL must be ≥ ${TTL_MARGIN}× (GEMINI_TIMEOUT_MS + Σ BILLING_RETRY_DELAYS_MS + attempts × BILLING_CALL_TIMEOUT_MS)`, () => {
    // Defaults (R20): 30 000 + (250 + 1 000 + 3 000 + 8 000 + 15 000) + 6 × 10 000 = 117 250 ms → at least 234.5 s.
    expect(checkConfig(serviceEnv({ AI_HOLD_TTL_SECONDS: "235" }), webEnv())).toMatchObject({ problems: [], turnMs: 117_250 });
    expect(checkConfig(serviceEnv({ AI_HOLD_TTL_SECONDS: "234" }), webEnv()).problems).toEqual([
      expect.stringMatching(/AI_HOLD_TTL_SECONDS \(234 s\) must be at least 2× .*117\.25 s → ≥ 235 s/),
    ]);
    // Values the operator sets on the web side count too: 300 s + 2 s + 3 × 5 s = 317 s → ≥ 634 s.
    const slow = webEnv({ GEMINI_TIMEOUT_MS: "300000", BILLING_RETRY_DELAYS_MS: "1000,1000", BILLING_CALL_TIMEOUT_MS: "5000" });
    expect(checkConfig(serviceEnv(), slow).problems).toEqual([expect.stringMatching(/AI_HOLD_TTL_SECONDS \(600 s\)/)]);
    expect(checkConfig(serviceEnv({ AI_HOLD_TTL_SECONDS: "634" }), slow).problems).toEqual([]);
  });

  it("missing required production variables are each reported by name, on the right side", () => {
    const { problems } = checkConfig({}, {});
    // NODE_ENV unset means production rules (SEC-08), so it is not itself a problem.
    for (const name of [
      "service: FRONTEND_URL",
      "service: LEMONSQUEEZY_WEBHOOK_SECRET",
      "service: LEMONSQUEEZY_API_KEY",
      "service: LEMONSQUEEZY_STORE_ID",
      "service: LEMONSQUEEZY_VARIANT_STARTER",
      "service: RESEND_API_KEY",
      "service: SENDER_EMAIL",
      "service: JWT_SECRET",
      "service: INTERNAL_SERVICE_SECRET",
      "service: DATABASE_URL",
      "web: JWT_SECRET",
      "web: FRONTEND_URL",
      "web: AUTH_SERVICE_URL",
      "web: BILLING_SERVICE_URL",
      "web: USERS_SERVICE_URL",
      "web: INTERNAL_SERVICE_SECRET",
      "web: GEMINI_API_KEY",
    ]) {
      expect(problems.some((p) => p.startsWith(name)), name).toBe(true);
    }
  });

  it("NODE_ENV=development (or test) on the service is a problem; unset is production rules", () => {
    expect(checkConfig(serviceEnv({ NODE_ENV: "development" }), webEnv()).problems).toEqual([expect.stringMatching(/^service: NODE_ENV is "development"/)]);
    expect(checkConfig(serviceEnv({ NODE_ENV: undefined }), webEnv()).problems).toEqual([]);
  });

  it("a value still equal to its .env.example placeholder is a problem", () => {
    const webExample = parseEnv(fs.readFileSync(path.join(root, ".env.example"), "utf8")) as Record<string, string>;
    const placeholder = webExample.AUTH_SERVICE_URL;
    expect(placeholder, "root .env.example must keep an AUTH_SERVICE_URL example").toBeTruthy();
    const { problems } = checkConfig(serviceEnv(), webEnv({ AUTH_SERVICE_URL: placeholder }));
    expect(problems).toContain("web: AUTH_SERVICE_URL still has its .env.example placeholder value.");
    // Tuning knobs may keep their example default (600 s here) without being flagged.
    expect(checkConfig(serviceEnv({ AI_HOLD_TTL_SECONDS: "600" }), webEnv()).problems).toEqual([]);
  });

  describe("LEMONSQUEEZY_ALLOW_TEST_MODE (SEC-13)", () => {
    const testModeProblem = /^service: LEMONSQUEEZY_ALLOW_TEST_MODE is set to a truthy value/;

    it("unset or empty passes silently", () => {
      expect(checkConfig(serviceEnv({ LEMONSQUEEZY_ALLOW_TEST_MODE: undefined }), webEnv())).toMatchObject({ problems: [], warnings: [] });
      expect(checkConfig(serviceEnv({ LEMONSQUEEZY_ALLOW_TEST_MODE: "  " }), webEnv())).toMatchObject({ problems: [], warnings: [] });
    });

    it.each(["false", "FALSE", " False ", "0", "no", "off"])("explicit %j passes silently", (value) => {
      expect(checkConfig(serviceEnv({ LEMONSQUEEZY_ALLOW_TEST_MODE: value }), webEnv())).toMatchObject({ problems: [], warnings: [] });
    });

    it.each(["true", "TRUE", " True ", "1", "yes", "Y", "on"])("truthy %j is a problem", (value) => {
      const { problems } = checkConfig(serviceEnv({ LEMONSQUEEZY_ALLOW_TEST_MODE: value }), webEnv());
      expect(problems).toEqual([expect.stringMatching(testModeProblem)]);
      // Names only: the configured value is never part of the message.
      expect(problems.join(" ")).not.toContain(`"${value.trim()}"`);
    });

    it("an unrecognised value only warns (the service ignores anything but \"true\")", () => {
      const res = checkConfig(serviceEnv({ LEMONSQUEEZY_ALLOW_TEST_MODE: "banana" }), webEnv());
      expect(res.problems).toEqual([]);
      expect(res.warnings).toEqual([expect.stringMatching(/^service: LEMONSQUEEZY_ALLOW_TEST_MODE has an unrecognised value/)]);
      expect(res.warnings.join(" ")).not.toContain("banana");
    });

    it("applies to production rules only: unset NODE_ENV is production, development reports just NODE_ENV", () => {
      expect(checkConfig(serviceEnv({ NODE_ENV: undefined, LEMONSQUEEZY_ALLOW_TEST_MODE: "true" }), webEnv()).problems).toEqual([
        expect.stringMatching(testModeProblem),
      ]);
      expect(checkConfig(serviceEnv({ NODE_ENV: "development", LEMONSQUEEZY_ALLOW_TEST_MODE: "true" }), webEnv()).problems).toEqual([
        expect.stringMatching(/^service: NODE_ENV is "development"/),
      ]);
    });

    it("the web side's file is not consulted for it", () => {
      expect(checkConfig(serviceEnv(), webEnv({ LEMONSQUEEZY_ALLOW_TEST_MODE: "true" })).problems).toEqual([]);
    });
  });

  it("warns (does not fail) about HOST, CLIENT_IP_HEADER and GOOGLE_CLIENT_ID", () => {
    const res = checkConfig(serviceEnv({ HOST: undefined, GOOGLE_CLIENT_ID: undefined }), webEnv({ CLIENT_IP_HEADER: undefined }));
    expect(res.problems).toEqual([]);
    expect(res.warnings).toEqual([
      expect.stringMatching(/^service: HOST is not set/),
      expect.stringMatching(/^service: GOOGLE_CLIENT_ID is not set/),
      expect.stringMatching(/^web: CLIENT_IP_HEADER is not set/),
    ]);
  });
});

describe("npm run check:config (CLI)", () => {
  // Inside the repo (gitignored): the standing rule keeps files out of the system temp dir.
  const dir = path.join(root, "test-results", `check-config-${randomBytes(4).toString("hex")}`);
  fs.mkdirSync(dir, { recursive: true });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, vars: Record<string, string | undefined>) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Object.entries(vars).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join("\n"));
    return file;
  };
  const run = (args: string[], env: Record<string, string | undefined> = {}) => {
    const res = spawnSync(process.execPath, [path.join(root, "services/auth-billing-service/node_modules/tsx/dist/cli.mjs"), "scripts/check-config.mts", ...args], {
      cwd: root,
      encoding: "utf8",
      // Nothing inherited but PATH: the developer's own env must not leak into `--service env`.
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } as unknown as NodeJS.ProcessEnv,
    });
    return { code: res.status, out: `${res.stdout}${res.stderr}` };
  };
  /** Every configured value worth leaking (NODE_ENV's "production" also appears in normal output text). */
  const values = (...envs: Record<string, string | undefined>[]) =>
    envs
      .flatMap((e) => Object.entries(e))
      .filter(([k, v]) => k !== "NODE_ENV" && typeof v === "string" && v.length >= 8)
      .map(([, v]) => v as string);

  it("exit 0 for a good pair of files; prints no value at all", () => {
    const service = serviceEnv();
    const web = webEnv();
    const res = run(["--service", write("svc.env", service), "--web", write("web.env", web)]);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toMatch(/OK — no problems found/);
    for (const v of values(service, web)) expect(res.out).not.toContain(v);
  });

  it("exit 1 with every problem listed by name, still printing no value", () => {
    const service = serviceEnv({ AI_HOLD_TTL_SECONDS: "30", RESEND_API_KEY: undefined });
    const web = webEnv({ INTERNAL_SERVICE_SECRET: secret() });
    const res = run(["--service", write("svc-bad.env", service), "--web", write("web-bad.env", web)]);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/PROBLEM {2}service: RESEND_API_KEY is not set/);
    expect(res.out).toMatch(/PROBLEM {2}INTERNAL_SERVICE_SECRET differs between service and web/);
    expect(res.out).toMatch(/PROBLEM {2}AI_HOLD_TTL_SECONDS \(30 s\)/);
    for (const v of values(service, web)) expect(res.out).not.toContain(v);
  });

  it("exit 1 naming LEMONSQUEEZY_ALLOW_TEST_MODE (and not its value) when it is truthy; false passes", () => {
    const web = webEnv();
    const truthy = serviceEnv({ LEMONSQUEEZY_ALLOW_TEST_MODE: "true" });
    const res = run(["--service", write("svc-testmode.env", truthy), "--web", write("web-testmode.env", web)]);
    expect(res.code, res.out).toBe(1);
    expect(res.out).toMatch(/PROBLEM {2}service: LEMONSQUEEZY_ALLOW_TEST_MODE is set to a truthy value/);
    expect(res.out).not.toMatch(/LEMONSQUEEZY_ALLOW_TEST_MODE=/);
    for (const v of values(truthy, web)) expect(res.out).not.toContain(v);
    const ok = run(["--service", write("svc-testmode-off.env", serviceEnv({ LEMONSQUEEZY_ALLOW_TEST_MODE: "false" })), "--web", write("web-testmode-off.env", web)]);
    expect(ok.code, ok.out).toBe(0);
  });

  it("`env` reads the variables it is started with", () => {
    const both = { ...serviceEnv(), ...webEnv() };
    const res = run(["--service", "env", "--web", "env"], both);
    expect(res.code, res.out).toBe(0);
    for (const v of values(both)) expect(res.out).not.toContain(v);
  });

  it.each([
    [[], /Both --service and --web are required/],
    [["--service", "env"], /Both --service and --web are required/],
    [["--service", "missing-file.env", "--web", "env"], /service env file not found/],
    [["--bogus", "x"], /Unknown argument/],
  ])("usage errors exit 64 (%j)", (args, message) => {
    const res = run(args as string[]);
    expect(res.code).toBe(64);
    expect(res.out).toMatch(message);
  });
});
