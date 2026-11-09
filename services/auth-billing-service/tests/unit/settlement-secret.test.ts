/**
 * Validation of SETTLEMENT_CAPABILITY_SECRET (Phase 2C step 1). Pure: no startup wiring exists yet, and none of this
 * touches the environment or a database. Secrets here are random per run or obvious test constants, never real values.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { weakSecretReason } from "../../src/config/secretStrength.js";
import {
  SETTLEMENT_PREVIOUS_SECRET_NAME,
  SETTLEMENT_SECRET_NAME,
  resolveSettlementKeys,
  settlementSecretProblems,
} from "../../src/config/settlementSecret.js";

const PLACEHOLDER = "replace-with-another-32-characters-settlement-key";
const strong = () => randomBytes(48).toString("base64");
const envWith = (overrides: Record<string, string | undefined> = {}) =>
  ({ [SETTLEMENT_SECRET_NAME]: strong(), ...overrides }) as NodeJS.ProcessEnv;

describe("settlementSecretProblems: the current key", () => {
  it("accepts a strong random key on its own", () => {
    expect(settlementSecretProblems(envWith())).toEqual([]);
  });

  it.each([
    ["missing", undefined, /not set/],
    ["empty", "", /not set/],
    ["whitespace only", "   \t ", /not set/],
    ["the .env.example placeholder", PLACEHOLDER, /placeholder/],
    ["the placeholder in other case, padded", `  ${PLACEHOLDER.toUpperCase()}  `, /placeholder/],
    ["31 characters", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P", /at least 32/],
    ["a repeated character", "a".repeat(64), /low entropy/],
    ["a repeated pair", "ab".repeat(32), /low entropy/],
    ["a documented placeholder from another variable", "replace-with-at-least-32-characters-secret-key", /placeholder/],
    ["a generic placeholder", "changeme", /placeholder/],
  ])("rejects %s", (_label, value, reason) => {
    const problems = settlementSecretProblems(envWith({ [SETTLEMENT_SECRET_NAME]: value }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(reason);
    expect(problems[0]).toMatch(new RegExp(`^${SETTLEMENT_SECRET_NAME} `));
  });

  it("the secret is required even when every other variable is absent", () => {
    expect(settlementSecretProblems({} as NodeJS.ProcessEnv)).toEqual([`${SETTLEMENT_SECRET_NAME} is not set.`]);
  });
});

describe("settlementSecretProblems: it must be its own secret", () => {
  it.each(["JWT_SECRET", "INTERNAL_SERVICE_SECRET", "EMAIL_TOMBSTONE_SECRET"])("refuses a value equal to %s", (other) => {
    const shared = strong();
    const problems = settlementSecretProblems(envWith({ [SETTLEMENT_SECRET_NAME]: shared, [other]: shared }));
    expect(problems).toEqual([`${SETTLEMENT_SECRET_NAME} must not be the same value as ${other}; generate a separate secret.`]);
  });

  it("compares trimmed values", () => {
    const shared = strong();
    expect(settlementSecretProblems(envWith({ [SETTLEMENT_SECRET_NAME]: ` ${shared} `, JWT_SECRET: shared })).join("\n")).toMatch(/same value as JWT_SECRET/);
  });

  it("a missing or empty other secret never counts as 'the same' (an empty value is not a shared secret)", () => {
    expect(settlementSecretProblems(envWith({ JWT_SECRET: undefined, INTERNAL_SERVICE_SECRET: "", EMAIL_TOMBSTONE_SECRET: "  " }))).toEqual([]);
  });

  it("a missing current key with empty other secrets reports only that the key is missing", () => {
    expect(settlementSecretProblems({ JWT_SECRET: "", INTERNAL_SERVICE_SECRET: "" } as NodeJS.ProcessEnv)).toEqual([`${SETTLEMENT_SECRET_NAME} is not set.`]);
  });

  it("different secrets are fine", () => {
    expect(settlementSecretProblems(envWith({ JWT_SECRET: strong(), INTERNAL_SERVICE_SECRET: strong(), EMAIL_TOMBSTONE_SECRET: strong() }))).toEqual([]);
  });
});

describe("settlementSecretProblems: the optional previous key (rotation)", () => {
  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("a %s previous key is simply 'not set': no problem", (_label, value) => {
    expect(settlementSecretProblems(envWith({ [SETTLEMENT_PREVIOUS_SECRET_NAME]: value }))).toEqual([]);
  });

  it("a strong, different previous key is accepted", () => {
    expect(settlementSecretProblems(envWith({ [SETTLEMENT_PREVIOUS_SECRET_NAME]: strong() }))).toEqual([]);
  });

  it.each([
    ["short", "short-secret-12", /at least 32/],
    ["low entropy", "a".repeat(64), /low entropy/],
    ["the placeholder", PLACEHOLDER, /placeholder/],
  ])("a %s previous key is refused, naming the previous variable", (_label, value, reason) => {
    const problems = settlementSecretProblems(envWith({ [SETTLEMENT_PREVIOUS_SECRET_NAME]: value }));
    expect(problems.join("\n")).toMatch(reason);
    expect(problems[0]).toMatch(new RegExp(`^${SETTLEMENT_PREVIOUS_SECRET_NAME} `));
  });

  it("a previous key equal to the current one is refused (the rotation is pointless)", () => {
    const same = strong();
    expect(settlementSecretProblems({ [SETTLEMENT_SECRET_NAME]: same, [SETTLEMENT_PREVIOUS_SECRET_NAME]: ` ${same} ` } as NodeJS.ProcessEnv)).toEqual([
      `${SETTLEMENT_PREVIOUS_SECRET_NAME} must differ from ${SETTLEMENT_SECRET_NAME}; remove it once the rotation window has passed.`,
    ]);
  });

  it.each(["JWT_SECRET", "INTERNAL_SERVICE_SECRET", "EMAIL_TOMBSTONE_SECRET"])("a previous key equal to %s is refused", (other) => {
    const shared = strong();
    const problems = settlementSecretProblems(envWith({ [SETTLEMENT_PREVIOUS_SECRET_NAME]: shared, [other]: shared }));
    expect(problems).toEqual([`${SETTLEMENT_PREVIOUS_SECRET_NAME} must not be the same value as ${other}; generate a separate secret.`]);
  });

  it("a previous key does not excuse a missing current key", () => {
    expect(settlementSecretProblems({ [SETTLEMENT_PREVIOUS_SECRET_NAME]: strong() } as NodeJS.ProcessEnv)).toEqual([`${SETTLEMENT_SECRET_NAME} is not set.`]);
  });
});

describe("no problem message ever contains a secret value", () => {
  it("across every kind of failure", () => {
    const shared = strong();
    const previous = strong();
    const scenarios: NodeJS.ProcessEnv[] = [
      { [SETTLEMENT_SECRET_NAME]: "a".repeat(64) } as NodeJS.ProcessEnv,
      { [SETTLEMENT_SECRET_NAME]: "short-secret-12" } as NodeJS.ProcessEnv,
      { [SETTLEMENT_SECRET_NAME]: PLACEHOLDER } as NodeJS.ProcessEnv,
      { [SETTLEMENT_SECRET_NAME]: shared, JWT_SECRET: shared, INTERNAL_SERVICE_SECRET: shared, EMAIL_TOMBSTONE_SECRET: shared } as NodeJS.ProcessEnv,
      { [SETTLEMENT_SECRET_NAME]: shared, [SETTLEMENT_PREVIOUS_SECRET_NAME]: shared } as NodeJS.ProcessEnv,
      { [SETTLEMENT_SECRET_NAME]: strong(), [SETTLEMENT_PREVIOUS_SECRET_NAME]: "a".repeat(64) } as NodeJS.ProcessEnv,
      { [SETTLEMENT_SECRET_NAME]: strong(), [SETTLEMENT_PREVIOUS_SECRET_NAME]: previous, JWT_SECRET: previous } as NodeJS.ProcessEnv,
    ];
    for (const source of scenarios) {
      const text = settlementSecretProblems(source).join("\n");
      expect(text.length).toBeGreaterThan(0);
      for (const value of Object.values(source)) {
        if (typeof value === "string" && value.trim().length >= 8) expect(text).not.toContain(value.trim());
      }
    }
  });
});

describe("resolveSettlementKeys", () => {
  it("returns the trimmed current key, and omits a blank previous key entirely", () => {
    const keys = resolveSettlementKeys({ [SETTLEMENT_SECRET_NAME]: "  current-value  ", [SETTLEMENT_PREVIOUS_SECRET_NAME]: "   " } as NodeJS.ProcessEnv);
    expect(keys).toEqual({ current: "current-value" });
    expect("previous" in keys).toBe(false);
  });

  it("returns the trimmed previous key when it is set", () => {
    expect(resolveSettlementKeys({ [SETTLEMENT_SECRET_NAME]: "cur", [SETTLEMENT_PREVIOUS_SECRET_NAME]: "\n prev \t" } as NodeJS.ProcessEnv)).toEqual({ current: "cur", previous: "prev" });
  });

  it("a missing current key resolves to an empty string (the capability module then refuses to mint or verify)", () => {
    expect(resolveSettlementKeys({} as NodeJS.ProcessEnv)).toEqual({ current: "" });
    expect(resolveSettlementKeys({ [SETTLEMENT_PREVIOUS_SECRET_NAME]: "prev" } as NodeJS.ProcessEnv)).toEqual({ current: "", previous: "prev" });
  });

  it("reads the given source, not the process environment", () => {
    const before = process.env[SETTLEMENT_SECRET_NAME];
    try {
      process.env[SETTLEMENT_SECRET_NAME] = "from-process-env";
      expect(resolveSettlementKeys({} as NodeJS.ProcessEnv)).toEqual({ current: "" });
      expect(settlementSecretProblems({} as NodeJS.ProcessEnv)).toEqual([`${SETTLEMENT_SECRET_NAME} is not set.`]);
    } finally {
      if (before === undefined) delete process.env[SETTLEMENT_SECRET_NAME];
      else process.env[SETTLEMENT_SECRET_NAME] = before;
    }
  });
});

describe("the documented placeholder", () => {
  it("is refused by weakSecretReason as a placeholder (it is long and varied enough to pass the other checks)", () => {
    expect(weakSecretReason(SETTLEMENT_SECRET_NAME, PLACEHOLDER)).toMatch(/placeholder/);
    expect(PLACEHOLDER.length).toBeGreaterThanOrEqual(32);
  });

  it("the service .env.example documents the variable with the placeholder only, and never sets the previous key", () => {
    // The template only: the real services/auth-billing-service/.env is never opened by a test.
    const example = parseEnv(fs.readFileSync(fileURLToPath(new URL("../../.env.example", import.meta.url)), "utf8")) as Record<string, string>;
    expect(example[SETTLEMENT_SECRET_NAME]).toBe(PLACEHOLDER);
    expect(example).not.toHaveProperty(SETTLEMENT_PREVIOUS_SECRET_NAME);
    expect(settlementSecretProblems({ [SETTLEMENT_SECRET_NAME]: example[SETTLEMENT_SECRET_NAME] } as NodeJS.ProcessEnv).join("\n")).toMatch(/placeholder/);
  });
});
