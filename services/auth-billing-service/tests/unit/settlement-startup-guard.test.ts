/**
 * The startup guard on its own: what it prints, and that importing it does nothing. Whether the real process enforces it
 * is proved by tests/api/settlement-startup.test.ts and production-startup.test.ts, with real child processes.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { enforceSettlementSecret } from "../../src/config/settlementStartupGuard.js";
import { SETTLEMENT_SECRET_NAME } from "../../src/config/settlementSecret.js";
import { spyConsole } from "../support/console";

class ExitCalled extends Error {}
function spyExit() {
  return vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ExitCalled();
  }) as typeof process.exit);
}
const strong = () => randomBytes(48).toString("base64");

describe("enforceSettlementSecret", () => {
  it("does nothing with a valid configuration: no exit, no output", () => {
    const exit = spyExit();
    const logs = spyConsole();
    enforceSettlementSecret({ [SETTLEMENT_SECRET_NAME]: strong() } as NodeJS.ProcessEnv);
    expect(exit).not.toHaveBeenCalled();
    expect(logs.lines()).toEqual([]);
  });

  it("prints every problem as a FATAL line naming no value, then exits 1", () => {
    const exit = spyExit();
    const logs = spyConsole();
    const shared = strong();
    expect(() => enforceSettlementSecret({ [SETTLEMENT_SECRET_NAME]: shared, JWT_SECRET: shared, INTERNAL_SERVICE_SECRET: shared } as NodeJS.ProcessEnv)).toThrow(ExitCalled);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logs.lines()).toEqual([
      `error: FATAL: ${SETTLEMENT_SECRET_NAME} must not be the same value as JWT_SECRET; generate a separate secret.`,
      `error: FATAL: ${SETTLEMENT_SECRET_NAME} must not be the same value as INTERNAL_SERVICE_SECRET; generate a separate secret.`,
      "error: FATAL: refusing to start without a valid settlement capability secret. Exiting.",
    ]);
    expect(logs.lines().join("\n")).not.toContain(shared);
  });

  it("reads the process environment at call time when no source is given", () => {
    const exit = spyExit();
    spyConsole();
    const before = process.env[SETTLEMENT_SECRET_NAME];
    try {
      delete process.env[SETTLEMENT_SECRET_NAME];
      expect(() => enforceSettlementSecret()).toThrow(ExitCalled);
      process.env[SETTLEMENT_SECRET_NAME] = strong();
      exit.mockClear();
      enforceSettlementSecret();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      process.env[SETTLEMENT_SECRET_NAME] = before;
    }
  });

  it("importing the module has no side effect, even with no secret configured", async () => {
    const exit = spyExit();
    const logs = spyConsole();
    const before = process.env[SETTLEMENT_SECRET_NAME];
    try {
      delete process.env[SETTLEMENT_SECRET_NAME];
      vi.resetModules();
      await import("../../src/config/settlementStartupGuard.js");
      expect(exit).not.toHaveBeenCalled();
      expect(logs.lines()).toEqual([]);
    } finally {
      process.env[SETTLEMENT_SECRET_NAME] = before;
    }
  });
});
