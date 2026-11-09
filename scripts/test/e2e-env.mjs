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
/** Express only (never in `shared` or `webEnv`): the service refuses to start without a valid settlement capability key, and the BFF must not hold it. */
export const E2E_SETTLEMENT_KEY = "e2e-only-settlement-key-3d7a9c1e5b8f2a6d4c0e";
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
    SETTLEMENT_CAPABILITY_SECRET: E2E_SETTLEMENT_KEY,
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

/**
 * Every SITE_OWNER_* variable, set empty: Next.js loads the developer's root .env, and an owner detail in it must not change what
 * the E2E pages show (the specs assert the draft state). tests/unit/legal/site-owner.test.ts checks this list against the real one.
 */
export const OWNER_ENV_NAMES = [
  "SITE_OWNER_LEGAL_NAME", "SITE_OWNER_COUNTRY", "SITE_OWNER_REGISTRATION_NUMBER", "SITE_OWNER_POSTAL_ADDRESS",
  "SITE_OWNER_CONTACT_EMAIL", "SITE_OWNER_SUPPORT_EMAIL", "SITE_OWNER_PRIVACY_EMAIL", "SITE_OWNER_PHONE",
  "SITE_OWNER_GOVERNING_LAW", "SITE_OWNER_REFUND_POLICY", "SITE_OWNER_HOSTING_PROVIDERS", "SITE_OWNER_LOG_RETENTION",
  "SITE_OWNER_GEMINI_DATA_USE", "SITE_OWNER_ACCOUNT_DELETION", "SITE_OWNER_SIGNUP_IP_PURGE_JOB",
  "SITE_OWNER_ACCOUNT_DELETION_JOB", "SITE_OWNER_EMAIL_TOMBSTONE_GUARD", "SITE_OWNER_EFFECTIVE_DATE",
  "SITE_OWNER_LAST_UPDATED", "SITE_OWNER_LEGAL_REVIEWED",
];

export function webEnv() {
  return {
    ...shared,
    ...Object.fromEntries(OWNER_ENV_NAMES.map((name) => [name, ""])),
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
