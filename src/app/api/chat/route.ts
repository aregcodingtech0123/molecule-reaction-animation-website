import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import {
  DEFAULT_GEMINI_MODEL,
  LAB_ASSISTANT_SYSTEM_INSTRUCTION,
} from "@/lib/ai/lab-assistant-prompt";
import type { ChatRequestBody } from "@/lib/ai/chat-types";
import { validateAiOutput } from "@/lib/ai/validate-ai-output";
import { resolveSessionTokenFromRequest } from "@/lib/auth/resolve-session-token";
import { isJwtConfigured, verifyJwtToken } from "@/lib/auth/verify-jwt";
import {
  AI_OPERATION_COSTS,
  consumeCreditsForOperation,
  deliveryTrackingEnabled,
  recordDeliveryAttempt,
  refundOperationCredits,
  settleOperation,
} from "@/lib/billing/server-billing";
import { checkChatRateLimit } from "@/lib/rateLimit/chatLimiter";
import { BodyTooLargeError, CHAT_MAX_BODY_BYTES, readBodyWithLimit } from "@/lib/http/limited-body";
import { crossSiteRejection, isCrossSiteRequest } from "@/lib/security/csrf";
import { boundConversation, geminiMaxOutputTokens, geminiTimeoutMs } from "@/lib/ai/gemini-limits";
import { withDeadline } from "@/lib/http/deadline";

const MAX_MESSAGES = 24;

function isAbortError(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  return name === "TimeoutError" || name === "AbortError";
}
const MAX_CONTENT_LENGTH = 8_000;

/** In-memory fallback when Upstash is not configured — single-instance only. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function isValidMessage(
  item: unknown,
): item is { role: "user" | "assistant"; content: string } {
  if (!item || typeof item !== "object") return false;
  const m = item as Record<string, unknown>;
  return (
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.trim().length > 0 &&
    m.content.length <= MAX_CONTENT_LENGTH
  );
}

function checkInMemoryRateLimit(userId: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(userId);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export async function POST(request: Request) {
  // Spends credits: same cross-site guard as every other state-changing BFF route (SEC-11);
  // SameSite=Strict on the cookie is the first line, this is the second.
  if (isCrossSiteRequest(request)) return crossSiteRejection();

  const bearer = resolveSessionTokenFromRequest(request);
  if (!bearer) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!isJwtConfigured()) {
    console.error("[api/chat] JWT_SECRET is not configured on the Next.js server.");
    return Response.json({ error: "Server auth is not configured." }, { status: 503 });
  }

  const session = await verifyJwtToken(bearer);
  if (!session) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Revocation (logout, token_version) and the verified-email gate are enforced by the reservation call
  // itself (/consume runs requireAuth + requireVerified before reserving anything): nothing is reserved and
  // the model is never called for such a session. A separate GET /auth/me before it was a redundant
  // round trip on every turn (PERF-01).

  const distributedRate = await checkChatRateLimit(session.sub);
  if (!distributedRate.allowed) {
    return Response.json(
      { error: "RATE_LIMITED", retryAfter: distributedRate.retryAfter || 60 },
      { status: 429, headers: { "Retry-After": String(distributedRate.retryAfter || 60) } },
    );
  }

  const memoryRate = checkInMemoryRateLimit(session.sub);
  if (!memoryRate.allowed) {
    return Response.json(
      { error: "RATE_LIMITED", retryAfter: memoryRate.retryAfter || 60 },
      { status: 429, headers: { "Retry-After": String(memoryRate.retryAfter || 60) } },
    );
  }

  let body: ChatRequestBody;
  try {
    // Bounded read (SEC-10): request.json() would buffer any size a signed-in user sends.
    const raw = await readBodyWithLimit(request, CHAT_MAX_BODY_BYTES);
    body = JSON.parse(new TextDecoder().decode(raw ?? new Uint8Array())) as ChatRequestBody;
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "At least one message is required." }, { status: 400 });
  }

  const messages = body.messages.slice(-MAX_MESSAGES);
  if (!messages.every(isValidMessage)) {
    return Response.json({ error: "Invalid message format in history." }, { status: 400 });
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    return Response.json({ error: "The last message must be from the user." }, { status: 400 });
  }

  // Server-generated, single-use reference for this turn's reservation. The
  // client never sees or chooses it.
  const chatTurnId = randomUUID();

  // Off unless BILLING_DELIVERY_TRACKING says so. Read once per turn, so one turn is tracked or not from start to finish.
  const trackDelivery = deliveryTrackingEnabled();

  const charge = await consumeCreditsForOperation({
    bearerToken: bearer,
    operationType: "AI_CHAT_QUERY",
    referenceId: chatTurnId,
    trackDelivery,
  });

  if (!charge.ok) {
    if (charge.status === 401) {
      // Revoked (logout) or superseded (token_version) session.
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (charge.status === 409) {
      // The reference is already reserved/charged: never run the model twice for it.
      console.error("[api/chat] Duplicate operation reference — not calling the model", {
        userId: session.sub,
        referenceId: chatTurnId,
      });
      return Response.json({ error: "DUPLICATE_OPERATION" }, { status: 409 });
    }
    if (charge.status === 403) {
      return Response.json({ error: "EMAIL_NOT_VERIFIED" }, { status: 403 });
    }
    // Daily caps (SEC-16): nothing reserved, the model is not called.
    if (charge.status === 429 && charge.code === "AI_DAILY_LIMIT") {
      const retryAfter = charge.retryAfter ?? 3600;
      return Response.json({ error: "AI_DAILY_LIMIT", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    }
    if (charge.status === 503 && charge.code === "AI_CAPACITY_REACHED") {
      return Response.json({ error: "AI_CAPACITY_REACHED" }, { status: 503 });
    }
    if (charge.status === 402) {
      return Response.json(
        {
          success: false,
          error: "INSUFFICIENT_CREDITS",
          code: "INSUFFICIENT_CREDITS",
          requiredCredits: charge.requiredCredits ?? AI_OPERATION_COSTS.AI_CHAT_QUERY,
        },
        { status: 402 },
      );
    }
    // Billing is unreachable or erroring. Fail closed rather than serving a
    // free generation, but say so honestly instead of blaming the balance.
    console.error("[api/chat] Credit charge failed", {
      userId: session.sub,
      referenceId: chatTurnId,
      status: charge.status,
    });
    return Response.json({ error: "BILLING_UNAVAILABLE" }, { status: 503 });
  }

  // Reservation-bound credentials for this turn: they stay in this function's scope, out of responses and logs.
  const { capabilities } = charge;

  /** Release the reservation: this turn delivers nothing chargeable. */
  const refund = (reason: string) =>
    refundOperationCredits({ referenceId: chatTurnId, refundCapabilityToken: capabilities.refundCapabilityToken, reason });

  /** The client left before the charge boundary, so the turn is released. Nobody reads this response. */
  const releaseCancelledTurn = async () => {
    console.warn("[api/chat] Client cancelled before the answer was validated — releasing the reservation", {
      userId: session.sub,
      referenceId: chatTurnId,
    });
    await refund("client_cancelled");
    return Response.json({ error: "CLIENT_CLOSED_REQUEST" }, { status: 499 });
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[api/chat] GEMINI_API_KEY is not configured.");
    await refund("gemini_api_key_missing");
    return Response.json({ error: "AI service unavailable. Please try again." }, { status: 503 });
  }

  // Bounded prompt and answer (SEC-16): the history is the user's to send, its cost is ours.
  const contents = boundConversation(messages).map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content.trim() }],
  }));

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  if (request.signal.aborted) return releaseCancelledTurn();

  let response;
  try {
    const ai = new GoogleGenAI({ apiKey });
    // FINDING-21: a hung model call must not hold a reserved turn open forever. The deadline is cleared as
    // soon as the call settles (PERF-19: an AbortSignal.timeout kept every finished turn alive for 30 s).
    response = await withDeadline(geminiTimeoutMs(), (abortSignal) =>
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: LAB_ASSISTANT_SYSTEM_INSTRUCTION,
          temperature: 0.7,
          maxOutputTokens: geminiMaxOutputTokens(),
          abortSignal: AbortSignal.any([abortSignal, request.signal]),
        },
      }),
    );
  } catch (err) {
    if (request.signal.aborted) return releaseCancelledTurn();
    if (isAbortError(err)) {
      console.error("[api/chat] Gemini timed out — releasing the reservation", {
        userId: session.sub,
        referenceId: chatTurnId,
        timeoutMs: geminiTimeoutMs(),
      });
      await refund("gemini_timeout");
      return Response.json({ error: "AI_TIMEOUT" }, { status: 504 });
    }
    console.error("[api/chat] Gemini failed — releasing the reservation", {
      userId: session.sub,
      referenceId: chatTurnId,
      err,
    });
    await refund("ai_generation_error");
    return Response.json({ error: "AI_SERVICE_UNAVAILABLE" }, { status: 502 });
  }

  if (request.signal.aborted) return releaseCancelledTurn();

  const text = response.text?.trim();
  if (!text) {
    console.error("[api/chat] Gemini returned an empty response — releasing the reservation", {
      userId: session.sub,
      referenceId: chatTurnId,
    });
    await refund("empty_ai_response");
    return Response.json({ error: "AI_SERVICE_UNAVAILABLE" }, { status: 502 });
  }

  const validation = validateAiOutput(text);
  if (!validation.safe) {
    // A withheld answer is never charged (Phase 2A).
    console.warn("[api/chat] Output policy violation:", validation.reason, {
      userId: session.sub,
      referenceId: chatTurnId,
    });
    await refund("output_filter_blocked");
    return Response.json(
      { error: "Response blocked by content policy." },
      { status: 422 },
    );
  }

  // The charge boundary: a complete, validated answer. From here on a client disconnect changes nothing, because
  // settlement does not use request.signal, so leaving cannot turn a chargeable answer into a free one. No answer byte
  // leaves before settlement says so. A withheld answer is not regenerated.
  const settlement = await settleOperation({ referenceId: chatTurnId, capabilities });
  if (!settlement.deliver) {
    return Response.json({ error: "BILLING_UNAVAILABLE" }, { status: 503 });
  }
  // Only here: the answer passed validation, its capture is confirmed, and it WILL be returned. One bounded attempt to record
  // that. It cannot throw and cannot change anything above: the charge, the answer and the model call are final.
  if (trackDelivery) await recordDeliveryAttempt({ referenceId: chatTurnId, capabilities });
  return Response.json({ message: text, balance: settlement.balance });
}
