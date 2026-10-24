/**
 * FINDING-13: Lemon variant → pack mapping comes from the environment only, and
 * production refuses to start without a complete, unambiguous mapping.
 */
import { describe, expect, it } from "vitest";
import { lemonVariantConfigProblem } from "../../src/config/env.js";
import { packageIdForLemonVariant } from "../../src/lib/lemonsqueezy.js";

const complete = {
  LEMONSQUEEZY_VARIANT_STARTER: "700001",
  LEMONSQUEEZY_VARIANT_PRO: "700002",
  LEMONSQUEEZY_VARIANT_ENTERPRISE: "700003",
};
const env = (vars: Record<string, string | undefined>) => vars as NodeJS.ProcessEnv;

describe("lemonVariantConfigProblem (FINDING-13)", () => {
  it("accepts three distinct numeric variant ids", () => {
    expect(lemonVariantConfigProblem(env(complete))).toBeNull();
    expect(lemonVariantConfigProblem(env({ ...complete, LEMONSQUEEZY_VARIANT_PRO: " 700002 " }))).toBeNull();
  });

  it.each([
    ["all missing", {}, /LEMONSQUEEZY_VARIANT_STARTER, LEMONSQUEEZY_VARIANT_PRO, LEMONSQUEEZY_VARIANT_ENTERPRISE not set/],
    ["one missing", { ...complete, LEMONSQUEEZY_VARIANT_PRO: undefined }, /^LEMONSQUEEZY_VARIANT_PRO not set/],
    ["one blank", { ...complete, LEMONSQUEEZY_VARIANT_ENTERPRISE: "  " }, /^LEMONSQUEEZY_VARIANT_ENTERPRISE not set/],
    ["a placeholder", { ...complete, LEMONSQUEEZY_VARIANT_STARTER: "your_starter_variant_id" }, /LEMONSQUEEZY_VARIANT_STARTER must be a numeric/],
    ["two packs share an id", { ...complete, LEMONSQUEEZY_VARIANT_ENTERPRISE: "700001" }, /LEMONSQUEEZY_VARIANT_ENTERPRISE and LEMONSQUEEZY_VARIANT_STARTER use the same variant id/],
  ])("%s → a startup problem naming the variable", (_label, vars, message) => {
    expect(lemonVariantConfigProblem(env(vars))).toMatch(message);
  });
});

describe("packageIdForLemonVariant — environment only (FINDING-13)", () => {
  it("maps the configured ids (test env: 900001–900003)", () => {
    expect([900001, "900002", " 900003 "].map(packageIdForLemonVariant)).toEqual(["starter", "pro", "enterprise"]);
  });

  it("no longer maps the formerly hard-coded production ids", () => {
    expect([2154652, 2154661, 2154665].map(packageIdForLemonVariant)).toEqual([null, null, null]);
  });

  it("an unset variable never matches an empty or missing variant id", () => {
    const saved = process.env.LEMONSQUEEZY_VARIANT_PRO;
    process.env.LEMONSQUEEZY_VARIANT_PRO = "";
    try {
      expect(packageIdForLemonVariant("")).toBeNull();
      expect(packageIdForLemonVariant(900002)).toBeNull();
    } finally {
      process.env.LEMONSQUEEZY_VARIANT_PRO = saved;
    }
  });
});
