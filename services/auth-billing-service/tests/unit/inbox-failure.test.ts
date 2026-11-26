/**
 * Consumer error classification (V8 contract Part P4.2, TS-X.2). Pure; no database: the errors are shaped like node-postgres errors
 * (pg-protocol copies the server's SQLSTATE field verbatim into `code`).
 */
import { describe, expect, it } from "vitest";
import { LEDGER_REFERENCE_RACE, classifyInboxFailure, isReviewDescription } from "../../src/lib/inboxFailure.js";
import { REVIEW_DESCRIPTIONS } from "../../src/lib/lemonEvent.js";
import { AppError } from "../../src/types/index.js";

function pgError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`server text with user@example.test for ${code}`), {
    severity: "ERROR",
    code,
    detail: "Key (reference_id)=(ls_order_1) already exists.",
    ...extra,
  });
}

describe("classifyInboxFailure", () => {
  it.each([
    ["MS001", "review:historical_credit_ambiguous"],
    ["MS002", "review:blocked_by_review_decision"],
    ["MS003", "review:refund_before_credit"],
  ])("%s from the function is a review stop with its fixed description", (code, description) => {
    expect(classifyInboxFailure(pgError(code))).toEqual({ kind: "review", lastError: description });
  });

  it("the exact ledger-reference race is retryable with its fixed text (Q3 A)", () => {
    expect(classifyInboxFailure(pgError("23505", { constraint: "uq_credit_ledger_provider_reference" }))).toEqual({
      kind: "retryable",
      lastError: LEDGER_REFERENCE_RACE,
    });
  });

  it("any other unique violation is not covered by that rule", () => {
    const result = classifyInboxFailure(pgError("23505", { constraint: "uq_something_else" }));
    expect(result.kind).toBe("indeterminate");
    expect(result.lastError).toBe("Database error (SQLSTATE 23505, constraint uq_something_else)");
  });

  it.each(["40P01", "40001", "57P01", "08006", "53300"])("%s is retryable", (code) => {
    expect(classifyInboxFailure(pgError(code)).kind).toBe("retryable");
  });

  it("a connect socket error is retryable", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED", syscall: "connect" });
    expect(classifyInboxFailure(err)).toMatchObject({ kind: "retryable" });
  });

  it.each(["42501", "42883", "42P01"])("%s is a configuration failure", (code) => {
    expect(classifyInboxFailure(pgError(code)).kind).toBe("configuration");
  });

  it("an MS code that did not come from the server decides nothing", () => {
    expect(classifyInboxFailure(Object.assign(new Error("x"), { code: "MS001" })).kind).toBe("indeterminate");
  });

  it.each(["MS000", "MS004", "P0001", "XX000"])("%s is indeterminate", (code) => {
    expect(classifyInboxFailure(pgError(code)).kind).toBe("indeterminate");
  });

  it("a consumer-side review stop keeps its fixed description; another AppError is indeterminate", () => {
    expect(classifyInboxFailure(new AppError(500, REVIEW_DESCRIPTIONS.partialRefund, "REVIEW"))).toEqual({
      kind: "review",
      lastError: "review:partial_refund",
    });
    expect(classifyInboxFailure(new AppError(500, "review:made_up", "REVIEW")).kind).toBe("indeterminate");
    expect(classifyInboxFailure(new AppError(500, "stored payload is missing", "WEBHOOK_PAYLOAD_MISSING"))).toEqual({
      kind: "indeterminate",
      lastError: "stored payload is missing",
    });
    // I-6 ii: the missing payload is now a review stop with the ninth description.
    expect(classifyInboxFailure(new AppError(500, REVIEW_DESCRIPTIONS.payloadCleared, "WEBHOOK_PAYLOAD_MISSING"))).toEqual({
      kind: "review",
      lastError: "review:payload_cleared",
    });
  });

  it("never stores the server's message or DETAIL", () => {
    for (const code of ["MS001", "23505", "42501", "40P01", "22P02", "MS999"]) {
      const { lastError } = classifyInboxFailure(pgError(code, { constraint: "uq_credit_ledger_provider_reference" }));
      expect(lastError).not.toMatch(/user@example|already exists|server text/);
    }
  });

  it("non-errors are indeterminate", () => {
    for (const value of [undefined, null, "boom", 42]) expect(classifyInboxFailure(value).kind).toBe("indeterminate");
  });
});

describe("isReviewDescription", () => {
  it("accepts only the pinned list", () => {
    for (const d of Object.values(REVIEW_DESCRIPTIONS)) expect(isReviewDescription(d)).toBe(true);
    for (const v of ["review:", "review:other", "Review:partial_refund", undefined, 1]) expect(isReviewDescription(v)).toBe(false);
  });
});
