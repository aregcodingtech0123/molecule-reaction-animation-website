import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import {
  DEFAULT_GEMINI_MODEL,
  LAB_ASSISTANT_SYSTEM_INSTRUCTION,
} from "@/lib/ai/lab-assistant-prompt";
import type { ChatRequestBody } from "@/lib/ai/chat-types";
import { validateAiOutput } from "@/lib/ai/validate-ai-output";
import { resolveSessionTokenFromRequest } from "@/lib/auth/resolve-session-token";
import { fetchEmailVerificationStatus } from "@/lib/auth/verification";
import { isJwtConfigured, verifyJwtToken } from "@/lib/auth/verify-jwt";
import { deductUserCredits } from "@/lib/billing/server-billing";
import { checkChatRateLimit } from "@/lib/rateLimit/chatLimiter";

const MAX_MESSAGES = 24;
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

  const verification = await fetchEmailVerificationStatus(bearer);
  if (!verification.ok) {
    if (verification.status === 401) {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    console.error("[api/chat] Unable to resolve email verification status", {
      userId: session.sub,
      status: verification.status,
    });
    return Response.json({ error: "Server auth is not configured." }, { status: 503 });
  }
  if (!verification.isVerified) {
    return Response.json({ error: "EMAIL_NOT_VERIFIED" }, { status: 403 });
  }

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
    body = (await request.json()) as ChatRequestBody;
  } catch {
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

  const chatTurnId = randomUUID();
  const deductResult = await deductUserCredits({
    bearerToken: bearer,
    amount: 1,
    type: "AI_GENERATION_DEDUCTION",
    referenceId: chatTurnId,
  });

  if (!deductResult.ok) {
    if (deductResult.status === 403) {
      return Response.json({ error: "EMAIL_NOT_VERIFIED" }, { status: 403 });
    }
    if (deductResult.status === 402) {
      return Response.json({ error: "INSUFFICIENT_CREDITS" }, { status: 402 });
    }
    console.error("[api/chat] Credit pre-deduction failed", {
      userId: session.sub,
      referenceId: chatTurnId,
      status: deductResult.status,
    });
    return Response.json({ error: "INSUFFICIENT_CREDITS" }, { status: 402 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[api/chat] GEMINI_API_KEY is not configured.");
    return Response.json({ error: "AI service unavailable. Please try again." }, { status: 503 });
  }

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content.trim() }],
  }));

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: LAB_ASSISTANT_SYSTEM_INSTRUCTION,
        temperature: 0.7,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      console.error("[api/chat] Gemini returned empty response after deduction", {
        userId: session.sub,
        referenceId: chatTurnId,
      });
      return Response.json({ error: "AI_SERVICE_UNAVAILABLE" }, { status: 502 });
    }

    const validation = validateAiOutput(text);
    if (!validation.safe) {
      console.warn("[api/chat] Output policy violation:", validation.reason, {
        userId: session.sub,
        referenceId: chatTurnId,
      });
      return Response.json(
        { error: "Response blocked by content policy." },
        { status: 422 },
      );
    }

    return Response.json({ message: text });
  } catch (err) {
    console.error("[api/chat] Gemini failed after credit deduction — ops review for refund", {
      userId: session.sub,
      referenceId: chatTurnId,
      err,
    });
    return Response.json({ error: "AI_SERVICE_UNAVAILABLE" }, { status: 502 });
  }
}
