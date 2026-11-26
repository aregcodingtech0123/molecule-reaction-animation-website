/**
 * C14a: the main service refuses to start while it holds the webhook-ingest database credential. Pure: no database, no real exit.
 */
import { describe, expect, it, vi } from "vitest";
import { enforceNoWebhookCredential, webhookCredentialProblems, WEBHOOK_DATABASE_URL_NAME } from "../../src/config/webhookCredentialGuard.js";
import { spyConsole } from "../support/console";

class ExitCalled extends Error {}
function spyExit() {
  return vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ExitCalled();
  }) as typeof process.exit);
}

const SECRET_URL = "postgresql://moleculestudio_webhook:s3cr3t-do-not-print@db.example.test:5432/moleculestudio";

describe("webhookCredentialProblems", () => {
  it("is empty when the variable is unset", () => {
    expect(webhookCredentialProblems({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it.each(["", "   ", "\t\n"])("ignores a blank value (%j): it carries no credential", (value) => {
    expect(webhookCredentialProblems({ [WEBHOOK_DATABASE_URL_NAME]: value } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("reports the variable and the rule, and never the value", () => {
    const problems = webhookCredentialProblems({ [WEBHOOK_DATABASE_URL_NAME]: SECRET_URL } as NodeJS.ProcessEnv);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(WEBHOOK_DATABASE_URL_NAME);
    expect(problems.join("\n")).not.toContain("s3cr3t");
    expect(problems.join("\n")).not.toContain("moleculestudio_webhook");
  });

  it("refuses any non-blank value, whether or not it parses as a URL", () => {
    expect(webhookCredentialProblems({ [WEBHOOK_DATABASE_URL_NAME]: "not a url" } as NodeJS.ProcessEnv)).toHaveLength(1);
  });

  it("does not react to the ack or main database variables", () => {
    expect(
      webhookCredentialProblems({ ACK_DATABASE_URL: SECRET_URL, DATABASE_URL: SECRET_URL } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });
});

describe("enforceNoWebhookCredential", () => {
  it("does nothing when the variable is unset: no exit, no output", () => {
    const exit = spyExit();
    const logs = spyConsole();
    enforceNoWebhookCredential({} as NodeJS.ProcessEnv);
    expect(exit).not.toHaveBeenCalled();
    expect(logs.lines()).toEqual([]);
  });

  it("prints a FATAL line naming no value, then exits 1", () => {
    const exit = spyExit();
    const logs = spyConsole();
    expect(() => enforceNoWebhookCredential({ [WEBHOOK_DATABASE_URL_NAME]: SECRET_URL } as NodeJS.ProcessEnv)).toThrow(ExitCalled);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    const text = logs.lines().join("\n");
    expect(text).toContain(`FATAL: ${WEBHOOK_DATABASE_URL_NAME} must not be set`);
    expect(text).toContain("refusing to start");
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("db.example.test");
  });

  it("reads the process environment at call time when no source is given", () => {
    const exit = spyExit();
    spyConsole();
    const before = process.env[WEBHOOK_DATABASE_URL_NAME];
    try {
      delete process.env[WEBHOOK_DATABASE_URL_NAME];
      enforceNoWebhookCredential();
      expect(exit).not.toHaveBeenCalled();
      process.env[WEBHOOK_DATABASE_URL_NAME] = SECRET_URL;
      expect(() => enforceNoWebhookCredential()).toThrow(ExitCalled);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      if (before === undefined) delete process.env[WEBHOOK_DATABASE_URL_NAME];
      else process.env[WEBHOOK_DATABASE_URL_NAME] = before;
    }
  });
});
