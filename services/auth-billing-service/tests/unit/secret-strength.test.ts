import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shannonEntropyPerChar, weakSecretReason } from "../../src/config/secretStrength.js";

describe("weakSecretReason (FINDING-30: JWT_SECRET check no longer rejects strong keys containing 'secret')", () => {
  it.each([
    ["random base64", randomBytes(48).toString("base64")],
    ["random hex", randomBytes(32).toString("hex")],
    ["strong key that contains the word 'secret'", `prod-secret-${randomBytes(24).toString("base64url")}`],
    ["strong key that contains 'jwt-secret'", `jwt-secret-${randomBytes(24).toString("hex")}`],
  ])("accepts %s", (_l, value) => {
    expect(weakSecretReason("JWT_SECRET", value)).toBeNull();
  });

  it.each([
    ["missing", undefined, /not set/],
    ["blank", "   ", /not set/],
    ["documented placeholder", "replace-with-at-least-32-characters-secret-key", /placeholder/],
    ["placeholder with different case/whitespace", "  CHANGEME  ", /placeholder/],
    ["31 characters", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P", /at least 32/],
    ["repeated character", "a".repeat(64), /low entropy/],
    ["repeated pair", "ab".repeat(32), /low entropy/],
  ])("rejects %s", (_l, value, reason) => {
    expect(weakSecretReason("JWT_SECRET", value)).toMatch(reason);
  });

  it("names the variable in the reason (reused for INTERNAL_SERVICE_SECRET)", () => {
    expect(weakSecretReason("INTERNAL_SERVICE_SECRET", "short")).toMatch(/^INTERNAL_SERVICE_SECRET /);
  });

  it("entropy helper: uniform pair = 1 bit/char, 16 distinct symbols = 4 bits/char", () => {
    expect(shannonEntropyPerChar("abab")).toBeCloseTo(1);
    expect(shannonEntropyPerChar("0123456789abcdef")).toBeCloseTo(4);
    expect(shannonEntropyPerChar("")).toBe(0);
  });
});
