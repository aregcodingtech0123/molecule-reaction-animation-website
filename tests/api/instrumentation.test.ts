import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertServerSecrets, register } from "@/instrumentation";
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
