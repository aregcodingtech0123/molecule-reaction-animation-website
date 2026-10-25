/**
 * Starts and stops the production perf stack: mock Gemini, Express (`node dist/index.js`) and Next
 * (`next start` on the `.next-perf` build), each with explicit env and stdout/stderr captured to the
 * run folder. Builds are fingerprinted: a run refuses a build made from different sources.
 */
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  API_ORIGIN,
  GEMINI_ORIGIN,
  GEMINI_PORT,
  NEXT_DIST_DIR,
  RESULTS_DIR,
  WEB_ORIGIN,
  WEB_PORT,
  apiEnv,
  repoRoot,
  serviceRoot,
  webEnv,
} from "./config.mjs";

const BUILD_INFO = path.join(RESULTS_DIR, "build-info.json");
const nextBin = path.join(repoRoot, "node_modules/next/dist/bin/next");
const tscBin = path.join(serviceRoot, "node_modules/typescript/bin/tsc");

/** HEAD + a hash of uncommitted changes to anything that ends up in either build. */
export function sourceFingerprint() {
  const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  const head = git("rev-parse", "HEAD").trim();
  const scope = [
    "src",
    "public",
    "next.config.ts",
    "tsconfig.json",
    "package.json",
    "package-lock.json",
    "services/auth-billing-service/src",
    "services/auth-billing-service/tsconfig.json",
    "services/auth-billing-service/package.json",
    "services/auth-billing-service/package-lock.json",
  ];
  const diff = git("diff", "HEAD", "--", ...scope);
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", ...scope);
  const dirty = Boolean(diff || untracked);
  const hash = crypto.createHash("sha256").update(diff).update(untracked).digest("hex").slice(0, 16);
  return { head, dirty, fingerprint: dirty ? `${head}+${hash}` : head };
}

export function buildAll(secrets) {
  const fp = sourceFingerprint();
  console.log("[perf] building Express (tsc → dist) …");
  execFileSync(process.execPath, [tscBin], { cwd: serviceRoot, stdio: "inherit" });
  console.log(`[perf] building Next (${NEXT_DIST_DIR}) …`);
  execFileSync(process.execPath, [nextBin, "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...webEnv(secrets), PERF_ALLOW_FONT_HOSTS: "1", NODE_ENV: "production" },
  });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(BUILD_INFO, `${JSON.stringify({ ...fp, builtAt: new Date().toISOString() }, null, 2)}\n`);
}

/** Throws unless both builds exist and were made from the current sources. */
export function assertFreshBuild({ allowStale = false } = {}) {
  if (!fs.existsSync(BUILD_INFO) || !fs.existsSync(path.join(repoRoot, NEXT_DIST_DIR, "BUILD_ID")) || !fs.existsSync(path.join(serviceRoot, "dist/index.js"))) {
    throw new Error("[perf] no perf build found — run with --build");
  }
  const built = JSON.parse(fs.readFileSync(BUILD_INFO, "utf8"));
  const now = sourceFingerprint();
  if (built.fingerprint !== now.fingerprint && !allowStale) {
    throw new Error(`[perf] build is stale (built from ${built.fingerprint}, sources are ${now.fingerprint}) — run with --build`);
  }
  return { ...built, stale: built.fingerprint !== now.fingerprint };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function waitFor(url, { timeoutMs = 120_000, child, name }) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`[perf] ${name} exited with code ${child.exitCode} (see its log)`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`[perf] ${name} not ready at ${url}: ${last}`);
}

/**
 * @param {object} o
 * @param {object} o.secrets      from makeSecrets()
 * @param {string} o.runDir       logs and instrumentation files go here
 * @param {boolean} [o.hopLog]    per-hop timing in the Next process
 * @param {boolean} [o.procLog]   memory / event-loop sampling in both servers
 * @param {object} [o.apiOverrides] [o.webOverrides] extra env (recorded in the result)
 */
export async function startStack(o) {
  fs.mkdirSync(o.runDir, { recursive: true });
  const files = {
    hopLog: o.hopLog ? path.join(o.runDir, "hops.jsonl") : "",
    apiProcLog: o.procLog ? path.join(o.runDir, "proc-api.jsonl") : "",
    webProcLog: o.procLog ? path.join(o.runDir, "proc-web.jsonl") : "",
  };
  const children = [];
  const launch = (name, args, cwd, env) => {
    const log = fs.openSync(path.join(o.runDir, `${name}.log`), "a");
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", log, log], detached: process.platform !== "win32" });
    children.push(child);
    return child;
  };
  const stop = async () => {
    for (const child of children.reverse()) killTree(child);
  };
  try {
    const mock = launch("mock-gemini", [path.join(repoRoot, "scripts/perf/mock-gemini.mjs"), "--port", String(GEMINI_PORT)], repoRoot, {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
    });
    await waitFor(`${GEMINI_ORIGIN}/__stats`, { child: mock, name: "mock-gemini", timeoutMs: 15_000 });
    const api = launch("api", ["dist/index.js"], serviceRoot, apiEnv(o.secrets, files, o.apiOverrides));
    await waitFor(`${API_ORIGIN}/health`, { child: api, name: "express" });
    const web = launch("web", [nextBin, "start", "--port", String(WEB_PORT)], repoRoot, webEnv(o.secrets, files, o.webOverrides));
    await waitFor(`${WEB_ORIGIN}/`, { child: web, name: "next" });
    return { files, stop, pids: { mock: mock.pid, api: api.pid, web: web.pid } };
  } catch (err) {
    await stop();
    throw err;
  }
}

export async function configureMock(config) {
  const res = await fetch(`${GEMINI_ORIGIN}/__config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`[perf] mock config refused: ${await res.text()}`);
  return res.json();
}
