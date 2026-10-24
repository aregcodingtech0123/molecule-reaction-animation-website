/**
 * Deterministic environment for every service test. Runs before any source
 * module is imported, so `env.ts` captures these values (JWT_SECRET is read
 * once at import time).
 */
import { loadTestEnvFile } from "../../../../scripts/test/test-env-file.mjs";
import { testDatabaseUrl } from "./test-db-url";

loadTestEnvFile();

export const TEST_ENV = {
  NODE_ENV: "test",
  PORT: "0",
  JWT_SECRET: "test-only-jwt-secret-7f3c9a1e5b2d4c6e8a0b",
  JWT_EXPIRES_IN: "1h",
  BCRYPT_ROUNDS: "4",
  FRONTEND_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  RESEND_API_KEY: "",
  SENDER_EMAIL: "Test <test@example.test>",
  EMAIL_FROM: "",
  LEMONSQUEEZY_API_KEY: "test_lemon_api_key",
  LEMONSQUEEZY_STORE_ID: "11111",
  LEMONSQUEEZY_WEBHOOK_SECRET: "test_webhook_secret_do_not_use",
  LEMONSQUEEZY_VARIANT_STARTER: "900001",
  LEMONSQUEEZY_VARIANT_PRO: "900002",
  LEMONSQUEEZY_VARIANT_ENTERPRISE: "900003",
} as const;

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}

// Discrete DB_* vars would be ignored when DATABASE_URL is set, but clear them
// so nothing from a developer shell can leak into connection resolution.
for (const key of ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "HOST"]) {
  delete process.env[key];
}

process.env.DATABASE_URL = process.env.TEST_DB_NAME
  ? testDatabaseUrl()
  : // Unit project: point at a guarded URL that is never connected to.
    testDatabaseUrl("moleculestudio_unit_unused_test");
