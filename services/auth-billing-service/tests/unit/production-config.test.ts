/**
 * SEC-08: production startup validation of every secret and URL, and production semantics for
 * any NODE_ENV that is not explicitly development/test (an unset NODE_ENV must not quietly turn
 * on dev-only behaviour such as logging verification/reset links).
 */
import { describe, expect, it } from "vitest";
import { isProductionNodeEnv } from "../../src/config/env.js";
import { productionConfigProblems } from "../../src/config/productionConfig.js";
import { VALID_PRODUCTION_ENV } from "../support/production-env";

const problems = (overrides: Record<string, string | undefined>) =>
  productionConfigProblems({ ...VALID_PRODUCTION_ENV, ...overrides } as NodeJS.ProcessEnv);

describe("isProductionNodeEnv (SEC-08)", () => {
  it.each([
    ["production", true],
    [undefined, true],
    ["", true],
    ["  ", true],
    ["staging", true],
    ["Production", true],
    ["development", false],
    ["Development", false],
    ["test", false],
  ])("NODE_ENV=%j → production rules: %s", (value, expected) => {
    expect(isProductionNodeEnv(value)).toBe(expected);
  });
});

describe("productionConfigProblems (SEC-08)", () => {
  it("accepts a complete production configuration", () => {
    expect(productionConfigProblems(VALID_PRODUCTION_ENV as NodeJS.ProcessEnv)).toEqual([]);
  });

  it.each([
    ["FRONTEND_URL missing", { FRONTEND_URL: undefined }, /FRONTEND_URL is not set/],
    ["FRONTEND_URL not a URL", { FRONTEND_URL: "studio.example" }, /FRONTEND_URL must be an absolute/],
    ["FRONTEND_URL plain http", { FRONTEND_URL: "http://studio.example" }, /FRONTEND_URL must use https/],
    ["FRONTEND_URL with a path", { FRONTEND_URL: "https://studio.example/app" }, /FRONTEND_URL must be an origin/],
    ["webhook secret missing", { LEMONSQUEEZY_WEBHOOK_SECRET: undefined }, /LEMONSQUEEZY_WEBHOOK_SECRET is not set/],
    ["webhook secret placeholder", { LEMONSQUEEZY_WEBHOOK_SECRET: "your_webhook_secret" }, /LEMONSQUEEZY_WEBHOOK_SECRET/],
    ["webhook secret short", { LEMONSQUEEZY_WEBHOOK_SECRET: "short-secret-12" }, /LEMONSQUEEZY_WEBHOOK_SECRET must be at least 32/],
    ["webhook secret low entropy", { LEMONSQUEEZY_WEBHOOK_SECRET: "a".repeat(36) }, /LEMONSQUEEZY_WEBHOOK_SECRET has too little variety/],
    ["Lemon API key missing", { LEMONSQUEEZY_API_KEY: undefined }, /LEMONSQUEEZY_API_KEY is not set/],
    ["Lemon API key placeholder", { LEMONSQUEEZY_API_KEY: "your_api_key" }, /LEMONSQUEEZY_API_KEY is a placeholder/],
    ["store id placeholder", { LEMONSQUEEZY_STORE_ID: "your_store_id" }, /LEMONSQUEEZY_STORE_ID must be a numeric/],
    ["variants missing", { LEMONSQUEEZY_VARIANT_PRO: undefined }, /LEMONSQUEEZY_VARIANT_PRO not set/],
    ["Resend key missing", { RESEND_API_KEY: undefined }, /RESEND_API_KEY is not set/],
    ["sender missing", { SENDER_EMAIL: undefined }, /SENDER_EMAIL is not set/],
    ["sender is Resend's sandbox address", { SENDER_EMAIL: "MoleculeStudio <onboarding@resend.dev>" }, /SENDER_EMAIL .*sandbox/],
    ["bcrypt cost too low", { BCRYPT_ROUNDS: "4" }, /BCRYPT_ROUNDS must be an integer between 10 and 15/],
    ["bcrypt cost not a number", { BCRYPT_ROUNDS: "ten" }, /BCRYPT_ROUNDS must be an integer between 10 and 15/],
  ])("%s → refused", (_label, overrides, message) => {
    expect(problems(overrides).join("\n")).toMatch(message);
  });

  it("FRONTEND_URL on localhost may use http (local production-mode runs) and a trailing slash is fine", () => {
    expect(problems({ FRONTEND_URL: "http://localhost:3100" })).toEqual([]);
    expect(problems({ FRONTEND_URL: "http://127.0.0.1:3000/" })).toEqual([]);
    expect(problems({ FRONTEND_URL: "https://studio.example/" })).toEqual([]);
  });

  it("BCRYPT_ROUNDS unset uses the default cost 10 (accepted)", () => {
    expect(problems({ BCRYPT_ROUNDS: undefined })).toEqual([]);
  });

  it("EMAIL_FROM is accepted as the legacy sender alias", () => {
    expect(problems({ SENDER_EMAIL: undefined, EMAIL_FROM: "MoleculeStudio <no-reply@studio.example>" })).toEqual([]);
  });

  it("reports every problem at once (so a deploy fails with the full list)", () => {
    expect(productionConfigProblems({} as NodeJS.ProcessEnv).length).toBeGreaterThanOrEqual(7);
  });
});

describe("re-registration guard settings (account deletion)", () => {
  it.each([
    ["secret missing", { EMAIL_TOMBSTONE_SECRET: undefined }, /EMAIL_TOMBSTONE_SECRET is not set/],
    ["secret too short", { EMAIL_TOMBSTONE_SECRET: "short-secret-12" }, /EMAIL_TOMBSTONE_SECRET must be at least 32/],
    ["secret low entropy", { EMAIL_TOMBSTONE_SECRET: "a".repeat(40) }, /EMAIL_TOMBSTONE_SECRET has too little variety/],
    [".env.example placeholder", { EMAIL_TOMBSTONE_SECRET: "replace-with-another-32-characters-email-tombstone-key" }, /EMAIL_TOMBSTONE_SECRET/],
    ["same value as JWT_SECRET", { EMAIL_TOMBSTONE_SECRET: "Zq8Lm3Vx7Rt1Nb5Kc9Dj2Hs6Gy4Fw0Pa", JWT_SECRET: "Zq8Lm3Vx7Rt1Nb5Kc9Dj2Hs6Gy4Fw0Pa" }, /EMAIL_TOMBSTONE_SECRET must not be the same value as JWT_SECRET/],
    ["same value as INTERNAL_SERVICE_SECRET", { EMAIL_TOMBSTONE_SECRET: "Zq8Lm3Vx7Rt1Nb5Kc9Dj2Hs6Gy4Fw0Pa", INTERNAL_SERVICE_SECRET: "Zq8Lm3Vx7Rt1Nb5Kc9Dj2Hs6Gy4Fw0Pa" }, /EMAIL_TOMBSTONE_SECRET must not be the same value as INTERNAL_SERVICE_SECRET/],
    ["guard flag that is neither true nor false", { EMAIL_TOMBSTONE_GUARD: "maybe" }, /EMAIL_TOMBSTONE_GUARD must be "true" or "false"/],
  ])("%s → refused", (_label, overrides, message) => {
    expect(problems(overrides).join("\n")).toMatch(message);
  });

  it.each(["true", "TRUE", "1", "yes", "on", ""])("EMAIL_TOMBSTONE_GUARD=%j keeps the guard on (and so requires the secret)", (flag) => {
    expect(problems({ EMAIL_TOMBSTONE_GUARD: flag, EMAIL_TOMBSTONE_SECRET: undefined }).join("\n")).toMatch(/EMAIL_TOMBSTONE_SECRET is not set/);
  });

  it.each(["false", "FALSE", "0", "no", "off"])("EMAIL_TOMBSTONE_GUARD=%j switches the guard off: no secret needed, nothing else changes", (flag) => {
    expect(problems({ EMAIL_TOMBSTONE_GUARD: flag, EMAIL_TOMBSTONE_SECRET: undefined })).toEqual([]);
  });
});

