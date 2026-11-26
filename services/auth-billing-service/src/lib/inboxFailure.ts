/**
 * How a failed inbox attempt is classified (V8 contract, Part P4.2; TS-X.2): what kind of failure it is and the fixed text stored in
 * `last_error`. Pure and environment-free; nothing here retries or writes.
 *
 * Not wired yet: the V8 consumer that calls credit_verified_purchase needs the V8 migration 022, which is not applied. The current
 * service path keeps webhookInbox.service.ts's failureText() until then.
 *
 * Rules: the server's message, DETAIL and HINT are never stored (only safeErrorDescription's fixed text or a fixed description); a
 * SQLSTATE decides only for an error that came from the server (it has a `severity`); no error is ever classified as processed.
 */
import { safeErrorDescription } from "../db/diagnostics.js";
import { isDatabaseUnavailableError, isTransientDatabaseError } from "../db/unavailable.js";
import { AppError } from "../types/index.js";
import { REVIEW_DESCRIPTIONS, type ReviewDescription } from "./lemonEvent.js";

/**
 * retryable: may heal by itself (Q7 retries apply). review: a review stop, retried per Q7 until closed and never while closed.
 * configuration: permanent until the deployment is fixed, then `webhooks:replay`. indeterminate: anything else (retried per Q7).
 */
export type InboxFailureKind = "retryable" | "review" | "configuration" | "indeterminate";

export interface InboxFailure {
  kind: InboxFailureKind;
  lastError: string;
}

/** The exact unique-constraint race of Q3 A: a second event of one order, resolved to another user, loses on this index. */
const LEDGER_REFERENCE_UNIQUE = "uq_credit_ledger_provider_reference";
export const LEDGER_REFERENCE_RACE = "retry:ledger_reference_race";

/** SQLSTATEs raised only by the V8 credit_verified_purchase (class MS is not used by PostgreSQL; Part P4.2, I-3). */
const FUNCTION_REVIEW_SQLSTATES: Readonly<Record<string, ReviewDescription>> = {
  MS001: REVIEW_DESCRIPTIONS.historicalCreditAmbiguous,
  MS002: REVIEW_DESCRIPTIONS.blockedByReviewDecision,
  MS003: REVIEW_DESCRIPTIONS.refundBeforeCredit,
};

/** insufficient_privilege (trust failure or a missing grant), undefined_function, undefined_table: the deployment is wrong. */
const CONFIGURATION_SQLSTATES: ReadonlySet<string> = new Set(["42501", "42883", "42P01"]);

const REVIEW_DESCRIPTION_SET: ReadonlySet<string> = new Set(Object.values(REVIEW_DESCRIPTIONS));

export function isReviewDescription(value: unknown): value is ReviewDescription {
  return typeof value === "string" && REVIEW_DESCRIPTION_SET.has(value);
}

function serverError(err: unknown): { code: string; constraint: string | null } | null {
  if (!err || typeof err !== "object") return null;
  const { code, constraint, severity } = err as { code?: unknown; constraint?: unknown; severity?: unknown };
  if (typeof severity !== "string" || typeof code !== "string") return null;
  return { code, constraint: typeof constraint === "string" ? constraint : null };
}

export function classifyInboxFailure(err: unknown): InboxFailure {
  // An AppError was written by this service: a consumer-side review stop carries its fixed description as the message.
  if (err instanceof AppError) {
    return { kind: isReviewDescription(err.message) ? "review" : "indeterminate", lastError: err.message };
  }
  if (isDatabaseUnavailableError(err) || isTransientDatabaseError(err)) {
    return { kind: "retryable", lastError: safeErrorDescription(err) };
  }
  const server = serverError(err);
  if (server) {
    if (server.code === "23505" && server.constraint === LEDGER_REFERENCE_UNIQUE) {
      return { kind: "retryable", lastError: LEDGER_REFERENCE_RACE };
    }
    const review = Object.hasOwn(FUNCTION_REVIEW_SQLSTATES, server.code) ? FUNCTION_REVIEW_SQLSTATES[server.code] : undefined;
    if (review) return { kind: "review", lastError: review };
    if (CONFIGURATION_SQLSTATES.has(server.code)) return { kind: "configuration", lastError: safeErrorDescription(err) };
  }
  return { kind: "indeterminate", lastError: safeErrorDescription(err) };
}
