/**
 * Phase 2C step 2: the real service entry point, src/index.ts, refuses to start on a bad settlement secret, before it
 * accepts any request. Production-mode cases are in production-startup.test.ts.
 *
 * Each case spawns a real Node process with ONLY the environment given here:
 *  - scripts/test/no-dotenv.mjs   → the developer's real .env is never read;
 *  - scripts/test/e2e-preload.mjs → network guard: no external call is possible.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { TEST_ENV } from "../setup/env";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(serviceRoot, "../..");
const preloads = ["scripts/test/no-dotenv.mjs", "scripts/test/e2e-preload.mjs"].map((p) => pathToFileURL(path.join(repoRoot, p)).href);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Fake but strong secrets that are random per run, so a leak into the output cannot be a coincidence. */
const strong = () => randomBytes(48).toString("base64url");

/** Start a process, and report how it ended up: exited with a code, or listening on its port. */
async function boot(vars: Record<string, string | undefined>) {
  const port = await freePort();
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    TZ: "UTC",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    AI_HOLD_SWEEP_INTERVAL_MS: "0",
    WEBHOOK_RETRY_INTERVAL_MS: "0",
    NODE_ENV: "development",
    JWT_SECRET: TEST_ENV.JWT_SECRET,
    INTERNAL_SERVICE_SECRET: TEST_ENV.INTERNAL_SERVICE_SECRET,
  };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const child = spawn(process.execPath, ["--import", "tsx", ...preloads.flatMap((p) => ["--import", p]), "src/index.ts"], {
    cwd: serviceRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));

  const listening = (async () => {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      try {
        return await fetch(`http://127.0.0.1:${port}/health`);
      } catch {
        if (child.exitCode !== null) break;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    return null;
  })();

  const result = await Promise.race([exited.then((code) => ({ code, health: null as Response | null })), listening.then((health) => ({ code: null as number | null, health }))]);
  if (child.exitCode === null) child.kill();
  await exited;
  return { ...result, output };
}

const CURRENT = "SETTLEMENT_CAPABILITY_SECRET";
const PREVIOUS = "SETTLEMENT_CAPABILITY_SECRET_PREVIOUS";

/** Refused before serving: exit 1, a FATAL naming the problem, no value in the output, never reached the listener. */
async function expectRefusal(vars: Record<string, string | undefined>, fatal: RegExp) {
  const { code, health, output } = await boot(vars);
  expect(health, `it started serving:\n${output}`).toBeNull();
  expect(code, output).toBe(1);
  expect(output).toMatch(fatal);
  expect(output).not.toMatch(/running seamlessly|bound to/);
  for (const name of [CURRENT, PREVIOUS, "JWT_SECRET", "INTERNAL_SERVICE_SECRET", "EMAIL_TOMBSTONE_SECRET"]) {
    const value = vars[name]?.trim();
    if (value && value.length >= 8) expect(output).not.toContain(value);
  }
  for (const value of [TEST_ENV.JWT_SECRET, TEST_ENV.INTERNAL_SERVICE_SECRET]) expect(output).not.toContain(value);
}

/** Starts and serves, with no FATAL line. */
async function expectStarts(vars: Record<string, string | undefined>) {
  const { health, output } = await boot(vars);
  expect(health?.status, output).toBe(200);
  expect(output).not.toMatch(/FATAL/);
  for (const value of Object.values(vars)) if (value && value.trim().length >= 8) expect(output).not.toContain(value.trim());
}

describe("the real service entry point and the settlement secret", () => {
  it.each<[string, Record<string, string | undefined>, RegExp]>([
    ["the secret missing", { [CURRENT]: undefined }, /FATAL: SETTLEMENT_CAPABILITY_SECRET is not set/],
    ["the secret empty", { [CURRENT]: "" }, /FATAL: SETTLEMENT_CAPABILITY_SECRET is not set/],
    ["the secret whitespace only", { [CURRENT]: "   \t " }, /FATAL: SETTLEMENT_CAPABILITY_SECRET is not set/],
    ["the .env.example placeholder", { [CURRENT]: "replace-with-another-32-characters-settlement-key" }, /FATAL: SETTLEMENT_CAPABILITY_SECRET is a documented placeholder/],
    ["a short secret", { [CURRENT]: "short-secret-value-12" }, /FATAL: SETTLEMENT_CAPABILITY_SECRET must be at least 32/],
    ["a low-entropy secret", { [CURRENT]: "ab".repeat(32) }, /FATAL: SETTLEMENT_CAPABILITY_SECRET has too little variety/],
    ["the secret equal to JWT_SECRET", { [CURRENT]: TEST_ENV.JWT_SECRET }, /FATAL: SETTLEMENT_CAPABILITY_SECRET must not be the same value as JWT_SECRET/],
    ["the secret equal to INTERNAL_SERVICE_SECRET", { [CURRENT]: TEST_ENV.INTERNAL_SERVICE_SECRET }, /FATAL: SETTLEMENT_CAPABILITY_SECRET must not be the same value as INTERNAL_SERVICE_SECRET/],
  ])("refuses to start with %s", async (_label, vars, fatal) => {
    await expectRefusal(vars, fatal);
  }, 60_000);

  it("refuses to start with the secret equal to a configured EMAIL_TOMBSTONE_SECRET", async () => {
    const shared = strong();
    await expectRefusal({ [CURRENT]: shared, EMAIL_TOMBSTONE_SECRET: shared }, /FATAL: SETTLEMENT_CAPABILITY_SECRET must not be the same value as EMAIL_TOMBSTONE_SECRET/);
  }, 60_000);

  it("refuses to start with a previous key equal to the current one", async () => {
    const same = strong();
    await expectRefusal({ [CURRENT]: same, [PREVIOUS]: same }, /FATAL: SETTLEMENT_CAPABILITY_SECRET_PREVIOUS must differ from SETTLEMENT_CAPABILITY_SECRET/);
  }, 60_000);

  it("refuses to start with a weak previous key", async () => {
    await expectRefusal({ [CURRENT]: strong(), [PREVIOUS]: "short-secret-value-12" }, /FATAL: SETTLEMENT_CAPABILITY_SECRET_PREVIOUS must be at least 32/);
  }, 60_000);

  it("refuses to start with a previous key equal to another secret", async () => {
    await expectRefusal({ [CURRENT]: strong(), [PREVIOUS]: TEST_ENV.JWT_SECRET }, /FATAL: SETTLEMENT_CAPABILITY_SECRET_PREVIOUS must not be the same value as JWT_SECRET/);
  }, 60_000);

  it("reports every problem at once, each without its value", async () => {
    const same = strong();
    const { output } = await boot({ [CURRENT]: same, [PREVIOUS]: same, EMAIL_TOMBSTONE_SECRET: same });
    expect(output).toMatch(/SETTLEMENT_CAPABILITY_SECRET must not be the same value as EMAIL_TOMBSTONE_SECRET/);
    expect(output).toMatch(/SETTLEMENT_CAPABILITY_SECRET_PREVIOUS must differ/);
    expect(output).not.toContain(same);
  }, 60_000);

  it("starts with a valid secret and no previous key", async () => {
    await expectStarts({ [CURRENT]: strong() });
  }, 60_000);

  it.each(["", "   "])("starts with a blank previous key (%j): it is ignored", async (blank) => {
    await expectStarts({ [CURRENT]: strong(), [PREVIOUS]: blank });
  }, 60_000);

  it("starts with a valid current and previous key (rotation)", async () => {
    await expectStarts({ [CURRENT]: strong(), [PREVIOUS]: strong(), EMAIL_TOMBSTONE_SECRET: strong() });
  }, 60_000);
});

describe("the real entry point, src/index.ts", () => {
  it("refuses to start without a settlement secret: exit 1, the closing FATAL line, and it never opened its port", async () => {
    const { code, health, output } = await boot({ [CURRENT]: undefined });
    expect(health, `it started serving:\n${output}`).toBeNull();
    expect(code, output).toBe(1);
    expect(output).toMatch(/FATAL: SETTLEMENT_CAPABILITY_SECRET is not set/);
    expect(output).toMatch(/FATAL: refusing to start without a valid settlement capability secret\. Exiting\./);
    expect(output).not.toMatch(/running seamlessly|bound to/);
  }, 60_000);

  it("the settlement secret does not excuse the older checks: a weak JWT_SECRET is still fatal", async () => {
    await expectRefusal({ [CURRENT]: strong(), JWT_SECRET: "short-secret-value-12" }, /FATAL: JWT_SECRET must be at least 32/);
  }, 60_000);
});
