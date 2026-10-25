/**
 * Single source of truth for the E2E stack's environment. Every variable either
 * server reads is set explicitly (process env wins over .env files in both
 * Next.js and dotenv), so no developer secret is used by E2E runs.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertTestDatabaseUrl, resolveTestDatabaseUrl } from "./db-guard.mjs";
import { loadTestEnvFile } from "./test-env-file.mjs";

loadTestEnvFile();

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const WEB_PORT = Number(process.env.E2E_WEB_PORT || 3100);
export const API_PORT = Number(process.env.E2E_API_PORT || 4100);
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

export const E2E_JWT_SECRET = "e2e-only-signing-key-4b9d2f7a1c3e5a7b9d0f";
export const E2E_WEBHOOK_SECRET = "e2e_webhook_secret_not_real";
export const E2E_INTERNAL_KEY = "e2e-only-internal-key-8c1f4a7d2b9e6c3a0f5d";
export const E2E_VARIANTS = { starter: "910001", pro: "910002", enterprise: "910003" };

export function e2eDatabaseUrl() {
  const u = new URL(resolveTestDatabaseUrl());
  u.pathname = "/moleculestudio_e2e_test";
  assertTestDatabaseUrl(u.toString());
  return u.toString();
}

const preload = pathToFileURL(path.join(repoRoot, "scripts/test/e2e-preload.mjs")).href;

const shared = {
  NODE_OPTIONS: `--import ${preload}`,
  JWT_SECRET: E2E_JWT_SECRET,
  INTERNAL_SERVICE_SECRET: E2E_INTERNAL_KEY,
  FRONTEND_URL: WEB_ORIGIN,
  NEXT_TELEMETRY_DISABLED: "1",
  TZ: "UTC",
};

export function apiEnv() {
  return {
    ...shared,
    NODE_ENV: "test",
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    DATABASE_URL: e2eDatabaseUrl(),
    TEST_DATABASE_URL: e2eDatabaseUrl(),
    DB_HOST: "",
    DB_PORT: "",
    DB_USER: "",
    DB_PASSWORD: "",
    DB_NAME: "",
    JWT_EXPIRES_IN: "1h",
    BCRYPT_ROUNDS: "4",
    GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
    RESEND_API_KEY: "",
    SENDER_EMAIL: "E2E <e2e@example.test>",
    EMAIL_FROM: "",
    LEMONSQUEEZY_API_KEY: "e2e_lemon_key_not_real",
    LEMONSQUEEZY_STORE_ID: "22222",
    LEMONSQUEEZY_WEBHOOK_SECRET: E2E_WEBHOOK_SECRET,
    LEMONSQUEEZY_VARIANT_STARTER: E2E_VARIANTS.starter,
    LEMONSQUEEZY_VARIANT_PRO: E2E_VARIANTS.pro,
    LEMONSQUEEZY_VARIANT_ENTERPRISE: E2E_VARIANTS.enterprise,
  };
}

export function webEnv() {
  return {
    ...shared,
    AUTH_SERVICE_URL: `${API_ORIGIN}/api/auth`,
    BILLING_SERVICE_URL: `${API_ORIGIN}/api/billing`,
    USERS_SERVICE_URL: `${API_ORIGIN}/api/users`,
    GEMINI_API_KEY: "e2e-gemini-key-not-real",
    GEMINI_MODEL: "",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
    // Own build/lock directory: runs alongside a developer's `next dev` on the same checkout.
    NEXT_DIST_DIR: ".next-e2e",
    CLIENT_IP_HEADER: "x-forwarded-for",
  };
}
