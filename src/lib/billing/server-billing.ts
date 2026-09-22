/**
 * Credit price list, mirrored from the billing service for display and for
 * sizing refunds in logs. The server re-derives the real cost from its own
 * table on every charge, so a drift here can never overcharge a user.
 */
export {
  AI_OPERATION_COSTS,
  type AiOperationType,
} from "@/lib/billing/ai-operation-costs";

import type { AiOperationType } from "@/lib/billing/ai-operation-costs";

function billingServiceBaseUrl(): string | null {
  const raw = process.env.BILLING_SERVICE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export async function fetchUserBalance(userId: string, bearerToken: string): Promise<number | null> {
  const base = billingServiceBaseUrl();
  if (!base) return null;

  const res = await fetch(`${base}/balance`, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearerToken}` },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { success?: boolean; data?: { balance?: number } };
  return typeof data.data?.balance === "number" ? data.data.balance : null;
}

export interface ConsumeCreditsResult {
  ok: boolean;
  status: number;
  /** Balance after the charge. */
  balance?: number;
  cost?: number;
  /** Present on a 402 — how many credits the operation needed. */
  requiredCredits?: number;
  /** True when this referenceId had already been charged. */
  alreadyProcessed?: boolean;
}

/**
 * Charge the caller for one metered AI operation.
 *
 * The cost is NOT sent — the billing service looks it up from its own price
 * list, keyed by `operationType`.
 */
export async function consumeCreditsForOperation(params: {
  bearerToken: string;
  operationType: AiOperationType;
  referenceId: string;
  metadata?: Record<string, unknown>;
}): Promise<ConsumeCreditsResult> {
  const base = billingServiceBaseUrl();
  if (!base) return { ok: false, status: 503 };

  const res = await fetch(`${base}/consume`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operationType: params.operationType,
      referenceId: params.referenceId,
      metadata: params.metadata ?? {},
    }),
    cache: "no-store",
  });

  const payload = (await res.json().catch(() => ({}))) as {
    data?: { balance?: number; cost?: number; alreadyProcessed?: boolean };
    requiredCredits?: number;
  };

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      requiredCredits: payload.requiredCredits,
    };
  }

  return {
    ok: true,
    status: res.status,
    balance: payload.data?.balance,
    cost: payload.data?.cost,
    alreadyProcessed: payload.data?.alreadyProcessed,
  };
}

/**
 * Hand credits back for an operation that failed after being charged.
 *
 * Best-effort and safe to call from a catch block: the billing service treats
 * "nothing was charged" and "already refunded" as normal 200 outcomes, and a
 * transport failure here is swallowed so it can never mask the original error.
 */
export async function refundOperationCredits(params: {
  bearerToken: string;
  referenceId: string;
  reason: string;
}): Promise<{ refunded: boolean; balance?: number }> {
  const base = billingServiceBaseUrl();
  if (!base) return { refunded: false };

  try {
    const res = await fetch(`${base}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ referenceId: params.referenceId, reason: params.reason }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("[billing] Refund request failed", {
        referenceId: params.referenceId,
        status: res.status,
      });
      return { refunded: false };
    }

    const payload = (await res.json().catch(() => ({}))) as {
      data?: { refunded?: boolean; balance?: number };
    };
    return {
      refunded: Boolean(payload.data?.refunded),
      balance: payload.data?.balance,
    };
  } catch (err) {
    console.error("[billing] Refund request threw", {
      referenceId: params.referenceId,
      err,
    });
    return { refunded: false };
  }
}

export async function deductUserCredits(params: {
  bearerToken: string;
  amount: number;
  type: string;
  referenceId: string;
}): Promise<{ ok: boolean; newBalance?: number; status: number }> {
  const base = billingServiceBaseUrl();
  if (!base) {
    return { ok: false, status: 503 };
  }

  const res = await fetch(`${base}/deduct`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      type: params.type,
      referenceId: params.referenceId,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  const data = (await res.json()) as { data?: { newBalance?: number } };
  return {
    ok: true,
    status: res.status,
    newBalance: data.data?.newBalance,
  };
}
