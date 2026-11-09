/**
 * Single source of truth for the performance stack (docs/performance/README.md).
 *
 * Production mode on dedicated ports (Next 3200, Express 4200, mock Gemini 4290) against the guarded
 * `moleculestudio_perf_test` database in the project's PostgreSQL 18 test container. Every variable
 * either server reads is set explicitly (process env wins over .env files in both Next.js and dotenv),
 * secrets are random per process tree and never written to disk, and both servers get the perf preload
 * (network guard + Gemini/Lemon/Resend stubs).
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertTestDatabaseUrl, resolveTestDatabaseUrl } from "../test/db-guard.mjs";
import { loadTestEnvFile } from "../test/test-env-file.mjs";

loadTestEnvFile();

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const serviceRoot = path.join(repoRoot, "services/auth-billing-service");
export const RESULTS_DIR = path.join(repoRoot, "perf-results");
export const NEXT_DIST_DIR = ".next-perf";

export const WEB_PORT = Number(process.env.PERF_WEB_PORT || 3200);
export const API_PORT = Number(process.env.PERF_API_PORT || 4200);
export const GEMINI_PORT = Number(process.env.PERF_GEMINI_PORT || 4290);
// `localhost` for the site (the CSRF guard compares Origin with FRONTEND_URL), 127.0.0.1 for the service.
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const GEMINI_ORIGIN = `http://127.0.0.1:${GEMINI_PORT}`;

/** Known, non-secret password of every seeded user (local perf DB only). */
export const PERF_PASSWORD = "perf-password-not-a-secret-1";
export const PERF_VARIANTS = { starter: "930001", pro: "930002", enterprise: "930003" };

export function perfDatabaseUrl() {
  const u = new URL(resolveTestDatabaseUrl());
  u.pathname = "/moleculestudio_perf_test";
  assertTestDatabaseUrl(u.toString());
  return u.toString();
}

/** Fresh random secrets for one stack (both servers and the token minter must share them). */
export function makeSecrets() {
  const s = () => randomBytes(48).toString("base64url");
  // `settlement` is for the Express service only (it refuses to start without one); the Next.js env never receives it.
  return { jwt: s(), internal: s(), settlement: s(), webhook: randomBytes(20).toString("hex") };
}

const preload = pathToFileURL(path.join(repoRoot, "scripts/perf/preload.mjs")).href;
const noDotenv = pathToFileURL(path.join(repoRoot, "scripts/test/no-dotenv.mjs")).href;

function shared(secrets, files) {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    JWT_SECRET: secrets.jwt,
    INTERNAL_SERVICE_SECRET: secrets.internal,
    FRONTEND_URL: WEB_ORIGIN,
    NEXT_TELEMETRY_DISABLED: "1",
    TZ: "UTC",
    PERF_GEMINI_ORIGIN: GEMINI_ORIGIN,
    // Optional instrumentation, written by the preload (see README "Instrumentation").
    PERF_HOP_LOG: files?.hopLog ?? "",
    PERF_PROC_LOG: files?.procLog ?? "",
    // CPU profile of one server over a time window (preload, node:inspector): PERF_CPU_PROF=api|web,
    // PERF_CPU_PROF_AFTER_MS / PERF_CPU_PROF_FOR_MS after the server starts; written to the run folder.
    PERF_CPU_PROF_DIR: files?.cpuProfDir ?? "",
    PERF_CPU_PROF_AFTER_MS: process.env.PERF_CPU_PROF_AFTER_MS ?? "",
    PERF_CPU_PROF_FOR_MS: process.env.PERF_CPU_PROF_FOR_MS ?? "",
    // Heap snapshots of one server: PERF_HEAP_SNAP=api|web at PERF_HEAP_SNAP_AT_MS (comma-separated, after start).
    PERF_HEAP_SNAP_DIR: files?.heapSnapDir ?? "",
    PERF_HEAP_SNAP_AT_MS: process.env.PERF_HEAP_SNAP_AT_MS ?? "",
  };
}

/** Express, built output (`node dist/index.js`), production rules (NODE_ENV=production). */
export function apiEnv(secrets, files = {}, overrides = {}) {
  return {
    ...shared(secrets, { procLog: files.apiProcLog, cpuProfDir: process.env.PERF_CPU_PROF === "api" ? files.runDir : "", heapSnapDir: process.env.PERF_HEAP_SNAP === "api" ? files.runDir : "" }),
    NODE_OPTIONS: `--import ${noDotenv} --import ${preload}`,
    PERF_PROC_NAME: "api",
    SETTLEMENT_CAPABILITY_SECRET: secrets.settlement,
    NODE_ENV: "production",
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    DATABASE_URL: perfDatabaseUrl(),
    DB_HOST: "",
    DB_PORT: "",
    DB_USER: "",
    DB_PASSWORD: "",
    DB_NAME: "",
    JWT_EXPIRES_IN: "2h",
    // Production default (10, the SEC-08 floor). Login latency is measured at this cost.
    BCRYPT_ROUNDS: "",
    TRUST_PROXY_HOPS: "0",
    GOOGLE_CLIENT_ID: "perf-client.apps.googleusercontent.com",
    RESEND_API_KEY: "re_perf_not_real",
    SENDER_EMAIL: "Perf <perf@perf.example>",
    EMAIL_FROM: "",
    LEMONSQUEEZY_API_KEY: "perf_lemon_key_not_real",
    LEMONSQUEEZY_STORE_ID: "33333",
    LEMONSQUEEZY_WEBHOOK_SECRET: secrets.webhook,
    LEMONSQUEEZY_VARIANT_STARTER: PERF_VARIANTS.starter,
    LEMONSQUEEZY_VARIANT_PRO: PERF_VARIANTS.pro,
    LEMONSQUEEZY_VARIANT_ENTERPRISE: PERF_VARIANTS.enterprise,
    LEMONSQUEEZY_ALLOW_TEST_MODE: "",
    AI_HOLD_TTL_SECONDS: "",
    AI_HOLD_SWEEP_INTERVAL_MS: "",
    // Caps stay ON with production defaults unless a scenario says otherwise (its result records it).
    AI_DAILY_TURNS_PER_USER: "",
    AI_DAILY_TURNS_GLOBAL: "",
    ...overrides,
  };
}

/** Next.js, `next start` on the `.next-perf` build (always NODE_ENV=production). */
export function webEnv(secrets, files = {}, overrides = {}) {
  return {
    ...shared(secrets, { hopLog: files.hopLog, procLog: files.webProcLog, cpuProfDir: process.env.PERF_CPU_PROF === "web" ? files.runDir : "", heapSnapDir: process.env.PERF_HEAP_SNAP === "web" ? files.runDir : "" }),
    // --expose-gc only for the PERF-21 forced-GC check (PERF_FORCE_GC_MS); never in a normal run.
    NODE_OPTIONS: `${overrides.PERF_FORCE_GC_MS ? "--expose-gc " : ""}--import ${preload}`,
    PERF_PROC_NAME: "web",
    AUTH_SERVICE_URL: `${API_ORIGIN}/api/auth`,
    BILLING_SERVICE_URL: `${API_ORIGIN}/api/billing`,
    USERS_SERVICE_URL: `${API_ORIGIN}/api/users`,
    GEMINI_API_KEY: "perf-gemini-key-not-real",
    GEMINI_MODEL: "",
    GEMINI_TIMEOUT_MS: "",
    GEMINI_MAX_OUTPUT_TOKENS: "",
    BILLING_RETRY_DELAYS_MS: "",
    BILLING_CALL_TIMEOUT_MS: "",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: "perf-client.apps.googleusercontent.com",
    // Inlined at build time: set here so a developer's .env cannot leak into the perf bundle.
    NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_STARTER: PERF_VARIANTS.starter,
    NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_PRO: PERF_VARIANTS.pro,
    NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_ENTERPRISE: PERF_VARIANTS.enterprise,
    NEXT_DIST_DIR,
    // The load driver sends a distinct X-Forwarded-For per virtual user, as a platform proxy would.
    CLIENT_IP_HEADER: "x-forwarded-for",
    CSP_MODE: "",
    ...overrides,
  };
}
