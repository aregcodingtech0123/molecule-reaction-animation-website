/**
 * Server-side (BFF) client for the billing service's internal metering API.
 * Never imported by client components; the internal key never leaves the server.
 *
 * Flow for one AI operation (see src/app/api/chat/route.ts):
 *   reserve (/consume) → run the operation → settleOperation (/capture, then /refund as a probe) on a chargeable answer
 *                                            refundOperationCredits (/refund) otherwise
 *
 * /consume returns one capture and one refund capability. They authorise every later call for that reservation, so
 * settlement does not depend on the user's session staying alive. They live only in the handling of this one request:
 * never in a response, a log, an error message or the model's prompt.
 */
export {
  AI_OPERATION_COSTS,
  type AiOperationType,
} from "@/lib/billing/ai-operation-costs";

import type { AiOperationType } from "@/lib/billing/ai-operation-costs";
import { withDeadline } from "@/lib/http/deadline";

export const INTERNAL_SERVICE_HEADER = "X-Internal-Service-Key";
// ≈ 27 s of retries (6 attempts): a capture or release rides out a billing or database outage of ~30 s
// instead of ~4 s (R20). The answer waits for the capture, so this is the longest a turn is delayed by an outage.
const DEFAULT_RETRY_DELAYS_MS = [250, 1000, 3000, 8000, 15000];

function billingServiceBaseUrl(): string | null {
  const raw = process.env.BILLING_SERVICE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/** Backoff between capture/release attempts. Exported for `npm run check:config`. */
export function retryDelays(source: NodeJS.ProcessEnv = process.env): number[] {
  const raw = source.BILLING_RETRY_DELAYS_MS?.trim();
  if (!raw) return DEFAULT_RETRY_DELAYS_MS;
  const parsed = raw.split(",").map((v) => Number(v.trim()));
  return parsed.every((n) => Number.isFinite(n) && n >= 0) ? parsed : DEFAULT_RETRY_DELAYS_MS;
}

/**
 * Upper bound for one BFF → billing call (SEC-17). Without it a billing service that accepts the
 * connection and never answers holds the AI turn for undici's ~300 s per attempt. A timed-out call is
 * treated like an unreachable service (503, retried for capture/release — both are idempotent).
 */
export function billingCallTimeoutMs(source: NodeJS.ProcessEnv = process.env): number {
  const v = Number(source.BILLING_CALL_TIMEOUT_MS);
  return Number.isInteger(v) && v > 0 ? v : 10_000;
}

/**
 * Delivery-attempt tracking (Phase 2C step 5.2.2). OFF unless BILLING_DELIVERY_TRACKING is `true` or `1` (any case, trimmed):
 * unset, empty or anything else is off, so a deployment never starts tracking by accident or by a typo. When on, new
 * reservations ask the billing service for a tracked reservation, and the chat route makes one acknowledgement call just
 * before returning a settled answer. Reservations made while it is off (or by an older BFF) are never tracked.
 */
export function deliveryTrackingEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  const v = source.BILLING_DELIVERY_TRACKING?.trim().toLowerCase();
  return v === "true" || v === "1";
}

/** The acknowledgement waits at most this long, once. It is bookkeeping and must never hold an answer back for longer. */
export const DELIVERY_ACK_TIMEOUT_MS = 2000;

/** The smaller of the acknowledgement budget and a billing call's own bound, so it can never wait longer than any billing call. */
export function deliveryAckTimeoutMs(source: NodeJS.ProcessEnv = process.env): number {
  return Math.min(DELIVERY_ACK_TIMEOUT_MS, billingCallTimeoutMs(source));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type InternalCall =
  | { ok: true; status: number; body: Record<string, unknown> }
  /**
   * `responseLost`: no complete answer arrived (unreachable, timed out, or the body broke off), whatever the status line said.
   * `notSent`: this BFF is not configured and the status is its own; nothing reached the network.
   */
  | { ok: false; status: number; body: Record<string, unknown>; responseLost?: boolean; notSent?: boolean };

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * One call to an internal metering endpoint. Network failures are returned as
 * `{ ok:false, status:503, responseLost:true }` instead of throwing (FINDING-25).
 *
 * @param bearerToken the user's JWT, for /consume only. Capture and refund are authorised by their capability.
 * @param timeoutMs   the bound for this one call and its body read; a billing call's usual bound unless the caller needs less.
 */
async function callInternal(path: string, bearerToken: string | null, payload: unknown, timeoutMs: number = billingCallTimeoutMs()): Promise<InternalCall> {
  const base = billingServiceBaseUrl();
  const secret = process.env.INTERNAL_SERVICE_SECRET?.trim();
  if (!base || !secret) {
    console.error("[billing] BILLING_NOT_CONFIGURED: BILLING_SERVICE_URL or INTERNAL_SERVICE_SECRET missing", { path });
    return { ok: false, status: 503, body: {}, notSent: true };
  }

  let res: Response;
  let text: string | null;
  try {
    // One deadline for the call and its body read, cleared as soon as both are done (PERF-19).
    ({ res, text } = await withDeadline(timeoutMs, async (signal) => {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
          "Content-Type": "application/json",
          [INTERNAL_SERVICE_HEADER]: secret,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal,
      });
      // A body that stalls or breaks off keeps the status line, and is marked as lost: a 200 without its body confirms nothing.
      return { res: response, text: await response.text().catch(() => null) };
    }));
  } catch (err) {
    console.error("[billing] Billing service unreachable", { path, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 503, body: {}, responseLost: true };
  }

  if (text === null) {
    console.error("[billing] Billing service response lost", { path, status: res.status });
    return { ok: false, status: res.status, body: {}, responseLost: true };
  }
  const body = parseObject(text);

  if (res.status === 404) {
    // The billing service answers 404 to a wrong/missing internal key on purpose.
    console.error(
      "[billing] INTERNAL_AUTH_REJECTED: billing service returned 404 for an internal metering route — " +
        "most likely INTERNAL_SERVICE_SECRET differs between the Next.js app and auth-billing-service.",
      { path },
    );
  }
  return res.ok ? { ok: true, status: res.status, body } : { ok: false, status: res.status, body };
}

async function callWithRetry(path: string, payload: unknown, isRetryable: (r: InternalCall) => boolean): Promise<{ result: InternalCall; attempts: number }> {
  const delays = retryDelays();
  let result = await callInternal(path, null, payload);
  let attempts = 1;
  for (const delay of delays) {
    if (!isRetryable(result)) break;
    await sleep(delay);
    result = await callInternal(path, null, payload);
    attempts += 1;
  }
  return { result, attempts };
}

export async function fetchUserBalance(_userId: string, bearerToken: string): Promise<number | null> {
  const base = billingServiceBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/balance`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { balance?: number } };
    return typeof data.data?.balance === "number" ? data.data.balance : null;
  } catch {
    return null;
  }
}

/** Server-to-server credentials for one reservation. Never for a browser, a log or the model. */
export interface SettlementCapabilities {
  captureCapabilityToken: string;
  refundCapabilityToken: string;
  /** Present only when delivery tracking was requested AND the service issued it. Authorises one acknowledgement, nothing else. */
  deliveryAckCapabilityToken?: string;
}

export type ConsumeCreditsResult =
  | {
      ok: true;
      status: number;
      /** Credits still available after the reservation. */
      balance?: number;
      cost?: number;
      capabilities: SettlementCapabilities;
    }
  | {
      ok: false;
      /** HTTP-like status: 402 insufficient, 403 unverified, 409 reference already used, 503 unavailable, 502 unusable reservation. */
      status: number;
      /** Present on a 402 — how many credits the operation needed. */
      requiredCredits?: number;
      /** The billing service's error code (e.g. AI_DAILY_LIMIT, AI_CAPACITY_REACHED — SEC-16). */
      code?: string;
      /** Seconds until a per-user daily cap frees up (429 AI_DAILY_LIMIT). */
      retryAfter?: number;
    };

const isPresentToken = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The `data` object of a service response, or an empty one. */
function dataOf(body: Record<string, unknown>): Record<string, unknown> {
  const { data } = body;
  return data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/**
 * Reserve the price of one AI operation (nothing is debited yet). The cost is
 * looked up by the billing service from `operationType` — never sent.
 * `referenceId` must be generated server-side, once per operation.
 *
 * A reservation without both capabilities cannot be settled, so it counts as a failure and the operation must not run.
 * Its hold, if one exists, expires uncharged.
 *
 * `trackDelivery` asks for a tracked reservation (and its third capability). That token is bookkeeping only, so its absence
 * is NOT a failure: an older service simply does not issue it, and the turn proceeds untracked.
 */
export async function consumeCreditsForOperation(params: {
  bearerToken: string;
  operationType: AiOperationType;
  referenceId: string;
  trackDelivery?: boolean;
}): Promise<ConsumeCreditsResult> {
  const r = await callInternal("/consume", params.bearerToken, {
    operationType: params.operationType,
    referenceId: params.referenceId,
    ...(params.trackDelivery === true ? { trackDelivery: true } : {}),
  });
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      requiredCredits: typeof r.body.requiredCredits === "number" ? r.body.requiredCredits : undefined,
      code: typeof r.body.code === "string" ? r.body.code : undefined,
      retryAfter: typeof r.body.retryAfter === "number" ? r.body.retryAfter : undefined,
    };
  }
  const data = dataOf(r.body);
  const { captureCapabilityToken, refundCapabilityToken } = data;
  if (!isPresentToken(captureCapabilityToken) || !isPresentToken(refundCapabilityToken)) {
    console.error("[billing] RESERVATION_UNUSABLE: /consume did not return both settlement capabilities", {
      referenceId: params.referenceId,
      status: r.status,
    });
    return { ok: false, status: 502 };
  }
  return {
    ok: true,
    status: r.status,
    balance: typeof data.balance === "number" ? data.balance : undefined,
    cost: typeof data.cost === "number" ? data.cost : undefined,
    capabilities: {
      captureCapabilityToken,
      refundCapabilityToken,
      // Taken only if this BFF asked for it: a token nobody requested is ignored.
      ...(params.trackDelivery === true && isPresentToken(data.deliveryAckCapabilityToken) ? { deliveryAckCapabilityToken: data.deliveryAckCapabilityToken } : {}),
    },
  };
}

/**
 * What one /capture response means. Status and contract fields together; anything else is `rejected`, which fails closed.
 *  - confirmed:   200 with `captured: true` and the resulting balance. A first capture or an idempotent repeat.
 *  - rolled_back: 409 CAPTURE_INDETERMINATE + rolled_back. Nothing was charged and the hold stays as it is.
 *  - retry:       503 CAPTURE_INDETERMINATE + unknown, 503 TRANSIENT_DATABASE_ERROR, 503 DATABASE_UNAVAILABLE, a 502 or 503
 *                 with no service code, or no complete response at all. Repeating the same capture cannot debit twice.
 *
 * A service error always carries a non-empty string `code`. A 502 or 503 without one therefore came from something in
 * front of the service, and says nothing about whether the capture committed. A code nobody recognises is the service
 * saying something this contract does not cover, so it stays `rejected`, as does any other status with no code.
 */
type CaptureRetryClass = "response_lost" | "gateway_no_service_code" | "capture_indeterminate_unknown" | "transient_database_error" | "database_unavailable";
type CaptureVerdict = { kind: "confirmed"; balance: number } | { kind: "rolled_back" } | { kind: "retry"; classification: CaptureRetryClass } | { kind: "rejected" };

function readCaptureResponse(r: InternalCall): CaptureVerdict {
  if (!r.ok && r.notSent) return { kind: "rejected" };
  if (!r.ok && r.responseLost) return { kind: "retry", classification: "response_lost" };
  const { code, commitOutcome } = r.body;
  const hasServiceCode = typeof code === "string" && code.trim() !== "";
  if ((r.status === 502 || r.status === 503) && !hasServiceCode) return { kind: "retry", classification: "gateway_no_service_code" };
  if (r.status === 200) {
    const { captured, balance } = dataOf(r.body);
    return r.body.success === true && captured === true && typeof balance === "number" ? { kind: "confirmed", balance } : { kind: "rejected" };
  }
  if (r.status === 409 && code === "CAPTURE_INDETERMINATE" && commitOutcome === "rolled_back") return { kind: "rolled_back" };
  if (r.status === 503) {
    if (code === "CAPTURE_INDETERMINATE" && commitOutcome === "unknown") return { kind: "retry", classification: "capture_indeterminate_unknown" };
    if (code === "TRANSIENT_DATABASE_ERROR") return { kind: "retry", classification: "transient_database_error" };
    if (code === "DATABASE_UNAVAILABLE") return { kind: "retry", classification: "database_unavailable" };
  }
  return { kind: "rejected" };
}

/** What a response may contribute to a log line: the shape service codes have, and nothing a body could fill with text. */
function loggableCode(code: unknown): string | null {
  if (code === undefined || code === null) return null;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "UNRECOGNIZED";
}

function loggableCommitOutcome(commitOutcome: unknown): string | null {
  if (commitOutcome === undefined || commitOutcome === null) return null;
  return commitOutcome === "rolled_back" || commitOutcome === "unknown" ? commitOutcome : "unrecognized";
}

/** The HTTP status that really arrived. A lost response has none: its 503 is this BFF's own stand-in. */
const receivedStatus = (r: InternalCall) => (!r.ok && r.responseLost ? null : r.status);

export type RefundOutcome = "released" | "already_released" | "already_expired" | "already_captured" | "capture_failed" | "not_found";

const REFUND_OUTCOMES: ReadonlySet<unknown> = new Set<RefundOutcome>(["released", "already_released", "already_expired", "already_captured", "capture_failed", "not_found"]);

type ProbeFailureCategory = "probe_not_sent" | "probe_response_lost" | "probe_service_unavailable" | "probe_rejected" | "probe_malformed_response";

function probeFailureCategory(r: InternalCall): ProbeFailureCategory {
  if (r.ok) return "probe_malformed_response";
  if (r.notSent) return "probe_not_sent";
  if (r.responseLost) return "probe_response_lost";
  return r.status >= 500 || r.status === 429 ? "probe_service_unavailable" : "probe_rejected";
}

/**
 * One /refund, within the retry budget. Retries on 5xx/429/network errors, which cannot charge anyone. `outcome` is null
 * unless a 200 named one the contract knows; no other field stands in for it. Reports only: the caller knows what a
 * missing outcome means.
 */
async function requestRefund(params: { referenceId: string; refundCapabilityToken: string; reason: string }) {
  const { result, attempts } = await callWithRetry(
    "/refund",
    { referenceId: params.referenceId, reason: params.reason, settlementCapability: params.refundCapabilityToken },
    (r) => !r.ok && (r.responseLost === true || r.status >= 500 || r.status === 429),
  );
  const { outcome, balance } = dataOf(result.body);
  const known = result.status === 200 && result.body.success === true && REFUND_OUTCOMES.has(outcome);
  return {
    result,
    attempts,
    outcome: known ? (outcome as RefundOutcome) : null,
    balance: known && typeof balance === "number" ? balance : undefined,
  };
}

/**
 * Release a reserved operation that delivers nothing chargeable: the service reports the hold's state as `outcome`, read
 * under its lock, and a captured hold is never reversed. With no outcome this is logged as RELEASE_FAILED, and a hold that
 * was not captured expires on the billing side, never charged (FINDING-22).
 */
export async function refundOperationCredits(params: {
  referenceId: string;
  refundCapabilityToken: string;
  reason: string;
}): Promise<{ outcome: RefundOutcome | null; balance?: number }> {
  const { result, attempts, outcome, balance } = await requestRefund(params);
  if (outcome === null) {
    console.error("[billing] RELEASE_FAILED (an uncaptured reservation expires uncharged)", {
      referenceId: params.referenceId,
      status: result.status,
      attempts,
    });
  }
  return { outcome, balance };
}

/**
 * Every capture attempt and every probe attempt ended without an authoritative outcome, and the answer was withheld.
 * It may or may not have been charged: this line deliberately does not say, and the database does
 * (docs/ops/SETTLEMENT_INVESTIGATION.md). Fixed values, statuses, counts and the reservation's server-generated reference
 * only, never text from a response. A logger that throws must not change the settlement.
 */
function reportUnresolvedSettlement(fields: {
  referenceId: string;
  captureClassification: CaptureRetryClass;
  captureHttpStatus: number | null;
  captureAttempts: number;
  probeHttpStatus: number | null;
  probeAttempts: number;
  failureCategory: ProbeFailureCategory;
}): void {
  try {
    console.error("[billing] SETTLEMENT_PROBE_UNRESOLVED", {
      event: "SETTLEMENT_PROBE_UNRESOLVED",
      ...fields,
      probeOutcome: "unresolved",
      answerDelivery: "withheld",
      occurredAt: new Date().toISOString(),
    });
  } catch {
    // Nothing to do: the decision is already made, and it does not depend on this line.
  }
}

export type SettlementDecision = { deliver: true; balance: number | null } | { deliver: false };

/**
 * Charge a reservation whose answer crossed the charge boundary, and decide whether that answer may be delivered.
 *
 * Capture is attempted within the bounded retry policy, always with the same token and reference. If no attempt gets an
 * answer the protocol recognises as final, the refund capability asks the service what happened: delivery then requires
 * the explicit outcome `already_captured`. Every other result withholds the answer. The answer is never regenerated and
 * nothing is reserved again; the caller must not contact the model because of a result here.
 */
export async function settleOperation(params: { referenceId: string; capabilities: SettlementCapabilities }): Promise<SettlementDecision> {
  const { referenceId, capabilities } = params;
  const { result, attempts } = await callWithRetry(
    "/capture",
    { referenceId, settlementCapability: capabilities.captureCapabilityToken },
    (r) => readCaptureResponse(r).kind === "retry",
  );
  const verdict = readCaptureResponse(result);
  if (verdict.kind === "confirmed") return { deliver: true, balance: verdict.balance };

  const failure = {
    referenceId,
    status: result.status,
    code: loggableCode(result.body.code),
    commitOutcome: loggableCommitOutcome(result.body.commitOutcome),
    attempts,
  };
  if (verdict.kind !== "retry") {
    console.error("[billing] CAPTURE_FAILED", failure);
    return { deliver: false };
  }

  const probe = await requestRefund({
    referenceId,
    refundCapabilityToken: capabilities.refundCapabilityToken,
    reason: "capture_unconfirmed",
  });
  if (probe.outcome === "already_captured") {
    console.warn("[billing] CAPTURE_CONFIRMED_BY_PROBE", failure);
    return { deliver: true, balance: probe.balance ?? null };
  }
  if (probe.outcome === null) {
    reportUnresolvedSettlement({
      referenceId,
      captureClassification: verdict.classification,
      captureHttpStatus: receivedStatus(result),
      captureAttempts: attempts,
      probeHttpStatus: receivedStatus(probe.result),
      probeAttempts: probe.attempts,
      failureCategory: probeFailureCategory(probe.result),
    });
    return { deliver: false };
  }
  console.error("[billing] CAPTURE_FAILED", { ...failure, probeOutcome: probe.outcome });
  return { deliver: false };
}

type DeliveryAckFailure = "ack_token_absent" | "ack_not_sent" | "ack_response_lost" | "ack_service_unavailable" | "ack_rejected" | "ack_unexpected_response";

/**
 * The acknowledgement did not get recorded. Fixed category, a status and the server-generated reference: never text from a
 * response. The answer was returned regardless. A logger that throws must not change anything.
 */
function reportDeliveryAttemptUnrecorded(fields: { referenceId: string; category: DeliveryAckFailure; httpStatus: number | null }): void {
  try {
    console.error("[billing] DELIVERY_ATTEMPT_UNRECORDED", { event: "DELIVERY_ATTEMPT_UNRECORDED", ...fields, occurredAt: new Date().toISOString() });
  } catch {
    // Nothing to do: the answer's fate does not depend on this line.
  }
}

/**
 * Record that the BFF is about to return a settled answer: ONE call, bounded by deliveryAckTimeoutMs, never retried.
 *
 * Call it only after a capture was confirmed (settleOperation said deliver) and the answer will be returned. It is
 * bookkeeping, not part of the settlement: it never throws, never changes a charge, never releases or refunds, and never
 * touches the model. Whatever happens, the caller still returns the answer. It deliberately ignores the client's abort signal,
 * because the capture is already final and the record should be made for a client that has gone as well.
 *
 * "Recorded" means the BFF attempted to return the answer. It does not prove the client received it.
 */
export async function recordDeliveryAttempt(params: { referenceId: string; capabilities: SettlementCapabilities }): Promise<void> {
  const { referenceId } = params;
  try {
    const token = params.capabilities.deliveryAckCapabilityToken;
    if (!token) {
      reportDeliveryAttemptUnrecorded({ referenceId, category: "ack_token_absent", httpStatus: null });
      return;
    }
    const r = await callInternal("/delivery-attempt", null, { referenceId, settlementCapability: token }, deliveryAckTimeoutMs());
    if (r.ok) {
      if (r.status === 200 && r.body.success === true && dataOf(r.body).recorded === true) return;
      reportDeliveryAttemptUnrecorded({ referenceId, category: "ack_unexpected_response", httpStatus: r.status });
      return;
    }
    if (r.notSent) reportDeliveryAttemptUnrecorded({ referenceId, category: "ack_not_sent", httpStatus: null });
    else if (r.responseLost) reportDeliveryAttemptUnrecorded({ referenceId, category: "ack_response_lost", httpStatus: null });
    else reportDeliveryAttemptUnrecorded({ referenceId, category: r.status >= 500 || r.status === 429 ? "ack_service_unavailable" : "ack_rejected", httpStatus: r.status });
  } catch {
    // Bookkeeping only: nothing here may reach the caller.
  }
}
