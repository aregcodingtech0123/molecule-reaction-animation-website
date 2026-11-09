import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TEST_ENV } from "../setup/env";
import { VALID_PRODUCTION_ENV } from "./production-env";

/**
 * The REAL service entry point, src/index.ts, in its own process, with ONLY the environment given here:
 *  - scripts/test/no-dotenv.mjs   → the developer's real .env is never read;
 *  - scripts/test/e2e-preload.mjs → network guard: no external call is possible.
 * Its stdout and stderr are captured, so a test sees exactly what an operator's log would hold.
 */
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

/** A fake but strong secret, random per call, so finding it in the output cannot be a coincidence. */
export const strongSecret = () => randomBytes(48).toString("base64url");

/** A complete production configuration: every value is fake or test-only. */
export const PRODUCTION_VARS: Record<string, string> = {
  ...VALID_PRODUCTION_ENV,
  NODE_ENV: "production",
  JWT_SECRET: TEST_ENV.JWT_SECRET,
  INTERNAL_SERVICE_SECRET: TEST_ENV.INTERNAL_SERVICE_SECRET,
};

/** The minimum a non-production mode needs to start. */
export const DEVELOPMENT_VARS: Record<string, string> = {
  NODE_ENV: "development",
  JWT_SECRET: TEST_ENV.JWT_SECRET,
  INTERNAL_SERVICE_SECRET: TEST_ENV.INTERNAL_SERVICE_SECRET,
};

export interface ServiceProcess {
  port: number;
  url: string;
  output(): string;
  exited: Promise<number | null>;
  /** Resolves with the first /health answer, or null when the process exited or the time ran out without ever serving. */
  firstHealth(timeoutMs?: number): Promise<Response | null>;
  waitForOutput(pattern: RegExp, timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
}

/** A variable set to `undefined` is removed from the child's environment. */
export async function startService(vars: Record<string, string | undefined>): Promise<ServiceProcess> {
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
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const url = `http://127.0.0.1:${port}`;

  return {
    port,
    url,
    output: () => out,
    exited,
    firstHealth: async (timeoutMs = 40_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          return await fetch(`${url}/health`);
        } catch {
          if (child.exitCode !== null) return null;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      return null;
    },
    waitForOutput: async (pattern, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!pattern.test(out)) {
        if (child.exitCode !== null) throw new Error(`the service exited before printing ${pattern}:\n${out}`);
        if (Date.now() > deadline) throw new Error(`the service did not print ${pattern}:\n${out}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    stop: async () => {
      if (child.exitCode === null) child.kill();
      await exited;
    },
  };
}
