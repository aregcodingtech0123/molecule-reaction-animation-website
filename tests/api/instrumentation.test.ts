import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertProductionConfig, assertServerSecrets, register } from "@/instrumentation";
import { weakSecretReason as bffCheck } from "@/lib/security/secret-strength";
import { weakSecretReason as serviceCheck } from "../../services/auth-billing-service/src/config/secretStrength";

const strong = randomBytes(48).toString("base64");
const env = (vars: Record<string, string | undefined>) => vars as NodeJS.ProcessEnv;

describe("Next.js startup check for INTERNAL_SERVICE_SECRET (instrumentation.ts)", () => {
  it.each([
    ["missing", undefined, /not set/],
    ["placeholder from .env.example", "replace-with-at-least-32-characters-internal-key", /placeholder/],
    ["too short", "short-but-random-Xy7", /at least 32/],
    ["low entropy", "x".repeat(40), /low entropy/],
  ])("refuses to start when the secret is %s", (_l, value, reason) => {
    expect(() => assertServerSecrets(env({ INTERNAL_SERVICE_SECRET: value }))).toThrow(reason);
  });

  it("starts with a strong secret", () => {
    expect(() => assertServerSecrets(env({ INTERNAL_SERVICE_SECRET: strong }))).not.toThrow();
  });

  it("never runs during `next build` (NEXT_PHASE=phase-production-build), even without the secret", () => {
    expect(() => assertServerSecrets(env({ NEXT_PHASE: "phase-production-build" }))).not.toThrow();
  });

  it("does run for `next dev` / `next start` phases", () => {
    for (const phase of ["phase-development-server", "phase-production-server"]) {
      expect(() => assertServerSecrets(env({ NEXT_PHASE: phase }))).toThrow(/not set/);
    }
  });

  it("register() checks the real environment in the Node.js runtime and skips the edge runtime", () => {
    const saved = { runtime: process.env.NEXT_RUNTIME, secret: process.env.INTERNAL_SERVICE_SECRET };
    try {
      process.env.NEXT_RUNTIME = "nodejs";
      process.env.INTERNAL_SERVICE_SECRET = "";
      expect(() => register()).toThrow(/INTERNAL_SERVICE_SECRET/);
      process.env.NEXT_RUNTIME = "edge";
      expect(() => register()).not.toThrow();
      process.env.NEXT_RUNTIME = "nodejs";
      process.env.INTERNAL_SERVICE_SECRET = strong;
      expect(() => register()).not.toThrow();
    } finally {
      if (saved.runtime === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = saved.runtime;
      process.env.INTERNAL_SERVICE_SECRET = saved.secret;
    }
  });
});

describe("BFF and service secret checks agree (they are separate copies)", () => {
  const vectors: (string | undefined)[] = [
    undefined,
    "",
    "   ",
    "changeme",
    "REPLACE-WITH-AT-LEAST-32-CHARACTERS-INTERNAL-KEY",
    "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P",
    "ab".repeat(20),
    `prod-secret-${randomBytes(24).toString("base64url")}`,
    randomBytes(32).toString("hex"),
    strong,
  ];
  it.each(vectors.map((v) => [v]))("same verdict for %j", (v) => {
    expect(bffCheck("X", v)).toBe(serviceCheck("X", v));
  });
});

describe("Next.js production startup validation (SEC-08)", () => {
  const production = {
    NODE_ENV: "production",
    INTERNAL_SERVICE_SECRET: strong,
    JWT_SECRET: randomBytes(48).toString("base64"),
    FRONTEND_URL: "https://studio.example",
    AUTH_SERVICE_URL: "https://api.studio.example/api/auth",
    BILLING_SERVICE_URL: "https://api.studio.example/api/billing",
    USERS_SERVICE_URL: "https://api.studio.example/api/users",
  };

  it("accepts a complete production configuration", () => {
    expect(() => assertProductionConfig(env(production))).not.toThrow();
  });

  it.each([
    ["JWT_SECRET missing (protected pages could not verify sessions)", { JWT_SECRET: undefined }, /JWT_SECRET is not set/],
    ["JWT_SECRET placeholder", { JWT_SECRET: "replace-with-at-least-32-characters-secret-key" }, /JWT_SECRET is a documented placeholder/],
    ["JWT_SECRET short", { JWT_SECRET: "short" }, /JWT_SECRET must be at least 32/],
    ["FRONTEND_URL missing (CSRF origin)", { FRONTEND_URL: undefined }, /FRONTEND_URL is not set/],
    ["FRONTEND_URL plain http", { FRONTEND_URL: "http://studio.example" }, /FRONTEND_URL must use https/],
    ["FRONTEND_URL with a path", { FRONTEND_URL: "https://studio.example/app" }, /FRONTEND_URL must be an origin/],
    ["AUTH_SERVICE_URL missing", { AUTH_SERVICE_URL: undefined }, /AUTH_SERVICE_URL is not set/],
    ["BILLING_SERVICE_URL not a URL", { BILLING_SERVICE_URL: "api.studio.example" }, /BILLING_SERVICE_URL must be an absolute http\(s\) URL/],
    ["USERS_SERVICE_URL with another scheme", { USERS_SERVICE_URL: "ftp://api.studio.example/api/users" }, /USERS_SERVICE_URL must be an absolute http\(s\) URL/],
  ])("%s → refuses to start", (_label, overrides, message) => {
    expect(() => assertProductionConfig(env({ ...production, ...overrides }))).toThrow(message);
  });

  it("lists every problem in one error", () => {
    expect(() => assertProductionConfig(env({ NODE_ENV: "production" }))).toThrow(/JWT_SECRET[\s\S]*FRONTEND_URL[\s\S]*AUTH_SERVICE_URL/);
  });

  it("http on localhost is accepted (local production-mode runs)", () => {
    expect(() => assertProductionConfig(env({ ...production, FRONTEND_URL: "http://localhost:3100" }))).not.toThrow();
  });

  it("does not apply to `next dev` / tests or during `next build`", () => {
    expect(() => assertProductionConfig(env({ NODE_ENV: "development" }))).not.toThrow();
    expect(() => assertProductionConfig(env({ NODE_ENV: "test" }))).not.toThrow();
    expect(() => assertProductionConfig(env({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }))).not.toThrow();
  });

  it("register() runs it: a production server with a missing JWT_SECRET refuses to start", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { ...production, NEXT_RUNTIME: "nodejs", JWT_SECRET: "" });
      expect(() => register()).toThrow(/JWT_SECRET/);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
