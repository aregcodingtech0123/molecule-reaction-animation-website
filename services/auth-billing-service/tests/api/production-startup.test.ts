/**
 * SEC-08: the REAL service process, booted with production settings, fails closed on every
 * missing / weak / placeholder secret or URL, and has no dev-only behaviour.
 *
 * Each case spawns `node --import tsx src/index.ts` with ONLY the environment given here:
 *  - scripts/test/no-dotenv.mjs  → the developer's real .env is never read;
 *  - scripts/test/e2e-preload.mjs → network guard: no real Resend / Lemon / Google call is possible.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { TEST_ENV } from "../setup/env";
import { VALID_PRODUCTION_ENV } from "../support/production-env";

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

interface Booted {
  port: number;
  output: () => string;
  exited: Promise<number | null>;
  stop: () => Promise<void>;
}

async function boot(vars: Record<string, string | undefined>): Promise<Booted> {
  const port = await freePort();
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    TZ: "UTC",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    AI_HOLD_SWEEP_INTERVAL_MS: "0",
  };
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) env[k] = v;
  const child = spawn(process.execPath, ["--import", "tsx", ...preloads.flatMap((p) => ["--import", p]), "src/index.ts"], {
    cwd: serviceRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    port,
    output: () => out,
    exited,
    stop: async () => {
      if (child.exitCode === null) child.kill();
      await exited;
    },
  };
}

/** A complete production environment for the real process (all values fake or test-only). */
const PRODUCTION = {
  ...VALID_PRODUCTION_ENV,
  NODE_ENV: "production",
  JWT_SECRET: TEST_ENV.JWT_SECRET,
  INTERNAL_SERVICE_SECRET: TEST_ENV.INTERNAL_SERVICE_SECRET,
};

async function waitForHealth(svc: Booted, timeoutMs = 40_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fetch(`http://127.0.0.1:${svc.port}/health`);
    } catch {
      if (Date.now() > deadline) throw new Error(`service did not start:\n${svc.output()}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function expectRefusal(vars: Record<string, string | undefined>, fatal: RegExp) {
  const svc = await boot(vars);
  const code = await Promise.race([svc.exited, new Promise<"running">((r) => setTimeout(() => r("running"), 40_000))]);
  if (code === "running") await svc.stop();
  expect(code, svc.output()).toBe(1);
  expect(svc.output()).toMatch(fatal);
}

describe("real service boot in production (SEC-08)", () => {
  it("starts with a complete production configuration; no dev-only behaviour", async () => {
    const svc = await boot(PRODUCTION);
    try {
      const health = await waitForHealth(svc);
      expect(health.status).toBe(200);
      const body = await health.json();
      expect(body).not.toHaveProperty("databaseError");
      // helmet on the public service
      expect(health.headers.get("x-content-type-options")).toBe("nosniff");
      expect(health.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
      // dev CORS allowance is off
      const preflight = await fetch(`http://127.0.0.1:${svc.port}/api/auth/login`, {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST" },
      });
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      // errors are generic: no stack traces or internals
      const bad = await fetch(`http://127.0.0.1:${svc.port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"email": ',
      });
      expect(bad.status).toBe(400);
      expect(await bad.text()).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
      // no FATAL and no dev mail logging on the way up
      expect(svc.output()).not.toMatch(/FATAL|logging email \(dev only\)/);
    } finally {
      await svc.stop();
    }
  }, 60_000);

  it("NODE_ENV unset is treated as production (fails closed instead of enabling dev behaviour)", async () => {
    await expectRefusal({ ...PRODUCTION, NODE_ENV: undefined, RESEND_API_KEY: undefined }, /FATAL: RESEND_API_KEY is not set/);
  }, 60_000);

  it("an unknown NODE_ENV (\"staging\") gets production rules too", async () => {
    await expectRefusal({ ...PRODUCTION, NODE_ENV: "staging", FRONTEND_URL: undefined }, /FATAL: FRONTEND_URL is not set/);
  }, 60_000);

  it.each([
    ["a weak Lemon webhook secret (forgeable purchase webhooks)", { LEMONSQUEEZY_WEBHOOK_SECRET: "your_webhook_secret" }, /FATAL: LEMONSQUEEZY_WEBHOOK_SECRET/],
    ["FRONTEND_URL over plain http", { FRONTEND_URL: "http://studio.example" }, /FATAL: FRONTEND_URL must use https/],
    ["Resend's sandbox sender", { SENDER_EMAIL: "onboarding@resend.dev" }, /FATAL: SENDER_EMAIL .*sandbox/],
    ["a low bcrypt cost", { BCRYPT_ROUNDS: "4" }, /FATAL: BCRYPT_ROUNDS/],
    ["a placeholder JWT_SECRET", { JWT_SECRET: "replace-with-at-least-32-characters-secret-key" }, /FATAL: JWT_SECRET is a documented placeholder/],
    ["no INTERNAL_SERVICE_SECRET", { INTERNAL_SERVICE_SECRET: undefined }, /FATAL: INTERNAL_SERVICE_SECRET is not set/],
  ])("refuses to start with %s", async (_label, overrides, fatal) => {
    await expectRefusal({ ...PRODUCTION, ...overrides }, fatal);
  }, 60_000);

  it("development still starts with a minimal configuration (dev rules only when NODE_ENV says so)", async () => {
    const svc = await boot({ NODE_ENV: "development", JWT_SECRET: TEST_ENV.JWT_SECRET, INTERNAL_SERVICE_SECRET: TEST_ENV.INTERNAL_SERVICE_SECRET });
    try {
      expect((await waitForHealth(svc)).status).toBe(200);
      expect(svc.output()).not.toMatch(/FATAL/);
    } finally {
      await svc.stop();
    }
  }, 60_000);
});
