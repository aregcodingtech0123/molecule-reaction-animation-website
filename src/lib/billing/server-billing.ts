/**
 * Server-side (BFF) client for the billing service's internal metering API.
 * Never imported by client components; the internal key never leaves the server.
 *
 * Flow for one AI operation (see src/app/api/chat/route.ts):
 *   reserve (/consume) → run the operation → capture (/capture) on success
 *                                            release (/refund)  on failure
 * Capture and release are retried with backoff. If every attempt fails, the
 * reservation simply expires on the billing side and is never charged.
 */
export {
  AI_OPERATION_COSTS,
  type AiOperationType,
} from "@/lib/billing/ai-operation-costs";

import type { AiOperationType } from "@/lib/billing/ai-operation-costs";

export const INTERNAL_SERVICE_HEADER = "X-Internal-Service-Key";
const DEFAULT_RETRY_DELAYS_MS = [250, 1000, 3000];

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type InternalCall =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown>; unreachable?: boolean };

/**
 * One call to an internal metering endpoint. Network failures are returned as
 * `{ ok:false, status:503, unreachable:true }` instead of throwing (FINDING-25).
 */
async function callInternal(path: string, bearerToken: string, payload: unknown): Promise<InternalCall> {
  const base = billingServiceBaseUrl();
  const secret = process.env.INTERNAL_SERVICE_SECRET?.trim();
  if (!base || !secret) {
    console.error("[billing] BILLING_NOT_CONFIGURED: BILLING_SERVICE_URL or INTERNAL_SERVICE_SECRET missing", { path });
    return { ok: false, status: 503, body: {} };
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        [INTERNAL_SERVICE_HEADER]: secret,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(billingCallTimeoutMs()),
    });
  } catch (err) {
    console.error("[billing] Billing service unreachable", { path, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 503, body: {}, unreachable: true };
  }

  // The body read is under the same deadline. A body that stalls after the status line keeps that
  // status (the service has decided) with an empty body.
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
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

const isRetryable = (r: InternalCall) => !r.ok && (r.status >= 500 || r.status === 429);

async function callWithRetry(path: string, bearerToken: string, payload: unknown): Promise<{ result: InternalCall; attempts: number }> {
  const delays = retryDelays();
  let result = await callInternal(path, bearerToken, payload);
  let attempts = 1;
  for (const delay of delays) {
    if (!isRetryable(result)) break;
    await sleep(delay);
    result = await callInternal(path, bearerToken, payload);
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

export interface ConsumeCreditsResult {
  ok: boolean;
  /** HTTP-like status: 402 insufficient, 403 unverified, 409 reference already used, 503 unavailable. */
  status: number;
  /** Credits still available after the reservation. */
  balance?: number;
  cost?: number;
  /** Present on a 402 — how many credits the operation needed. */
  requiredCredits?: number;
  /** The billing service's error code (e.g. AI_DAILY_LIMIT, AI_CAPACITY_REACHED — SEC-16). */
  code?: string;
  /** Seconds until a per-user daily cap frees up (429 AI_DAILY_LIMIT). */
  retryAfter?: number;
}

/**
 * Reserve the price of one AI operation (nothing is debited yet). The cost is
 * looked up by the billing service from `operationType` — never sent.
 * `referenceId` must be generated server-side, once per operation.
 */
export async function consumeCreditsForOperation(params: {
  bearerToken: string;
  operationType: AiOperationType;
  referenceId: string;
}): Promise<ConsumeCreditsResult> {
  const r = await callInternal("/consume", params.bearerToken, {
    operationType: params.operationType,
    referenceId: params.referenceId,
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
  const data = (r.body.data ?? {}) as { balance?: number; cost?: number };
  return { ok: true, status: r.status, balance: data.balance, cost: data.cost };
}

/**
 * Charge a reserved operation after it succeeded. Retries on 5xx/network errors.
 * A failure is logged as CAPTURE_FAILED (searchable); the reservation then
 * expires uncharged and appears in `npm run db:reconcile`.
 */
export async function captureOperationCredits(params: {
  bearerToken: string;
  referenceId: string;
}): Promise<{ captured: boolean; balance?: number; status: number }> {
  const { result, attempts } = await callWithRetry("/capture", params.bearerToken, { referenceId: params.referenceId });
  if (result.ok) {
    const data = (result.body.data ?? {}) as { balance?: number };
    return { captured: true, balance: data.balance, status: result.status };
  }
  console.error("[billing] CAPTURE_FAILED", {
    referenceId: params.referenceId,
    status: result.status,
    code: result.body.code ?? null,
    attempts,
  });
  return { captured: false, status: result.status };
}

/**
 * Release a reserved operation after it failed. Retries on 5xx/network errors.
 * If every attempt fails the reservation expires on the billing side and is
 * never charged (FINDING-22); logged as RELEASE_FAILED.
 */
export async function refundOperationCredits(params: {
  bearerToken: string;
  referenceId: string;
  reason: string;
}): Promise<{ refunded: boolean; balance?: number }> {
  const { result, attempts } = await callWithRetry("/refund", params.bearerToken, {
    referenceId: params.referenceId,
    reason: params.reason,
  });
  if (!result.ok) {
    console.error("[billing] RELEASE_FAILED (reservation will expire uncharged)", {
      referenceId: params.referenceId,
      status: result.status,
      attempts,
    });
    return { refunded: false };
  }
  const data = (result.body.data ?? {}) as { refunded?: boolean; balance?: number };
  return { refunded: Boolean(data.refunded), balance: data.balance };
}
