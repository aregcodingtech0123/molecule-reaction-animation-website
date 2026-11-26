/**
 * The classification table itself (Phase 2C step 3). Pure: nothing here touches a database. What the marks mean for a real
 * connection is proved in tests/db/with-transaction-connection-loss.test.ts.
 */
import { describe, expect, it } from "vitest";
import { isTransientDatabaseError } from "../../src/db/unavailable.js";
import { classifyCaptureError } from "../../src/services/aiCredits.service.js";

const pgError = (code: string, severity = "ERROR") => Object.assign(new Error("server text"), { code, severity });

describe("classifyCaptureError", () => {
  it.each(["40P01", "40001"])("%s is retryable: the initial allowlist", (code) => {
    expect(classifyCaptureError(pgError(code))).toBe("retryable");
    expect(isTransientDatabaseError(pgError(code))).toBe(true);
  });

  it.each(["08006", "08003", "57P01", "57P02", "57P03", "53300"])("%s from the server means it is unavailable: retryable, through the existing list", (code) => {
    expect(classifyCaptureError(pgError(code))).toBe("retryable");
    expect(isTransientDatabaseError(pgError(code))).toBe(false);
  });

  it("a connect-time socket error is retryable", () => {
    expect(classifyCaptureError(Object.assign(new Error("x"), { code: "ECONNREFUSED", syscall: "connect" }))).toBe("retryable");
  });

  it.each(["XX000", "55P03", "57014", "42P01", "22P02", "40000", "40002", "40003"])("%s is not on any list: indeterminate", (code) => {
    expect(classifyCaptureError(pgError(code))).toBe("indeterminate");
    expect(isTransientDatabaseError(pgError(code))).toBe(false);
  });

  // C12: what the narrow database operations raise for a privilege, state or check failure. A retry cannot fix any of
  // them, and none may be read as "nothing was charged, refund" or as transient. They are indeterminate by decision,
  // not merely because no list names them.
  it.each([
    ["42501", "insufficient_privilege: a missing grant or a refused role"],
    ["55000", "object_not_in_prerequisite_state: a contract guard or a hold in the wrong state"],
    ["23514", "check_violation: a constraint the operation refuses to break"],
  ])("%s (%s) is indeterminate and never retried", (code) => {
    expect(classifyCaptureError(pgError(code))).toBe("indeterminate");
    expect(isTransientDatabaseError(pgError(code))).toBe(false);
  });

  // Terminal handling exists only inside the debit's savepoint. Anywhere else these prove nothing, so they are not terminal.
  it.each(["P0001", "23505"])("%s outside the debit is indeterminate here: the debit's savepoint handles the terminal case", (code) => {
    expect(classifyCaptureError(pgError(code))).toBe("indeterminate");
  });

  it.each([
    ["no code at all", new Error("boom")],
    ["an error that only says 'not queryable'", new Error("Client has encountered a connection error and is not queryable")],
    ["a string", "text"],
    ["null", null],
    ["undefined", undefined],
    ["a code that is not a string", Object.assign(new Error("x"), { code: 40001 })],
  ])("%s is indeterminate", (_label, err) => {
    expect(classifyCaptureError(err)).toBe("indeterminate");
    expect(isTransientDatabaseError(err)).toBe(false);
  });
});
