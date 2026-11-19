/**
 * Step 7.4, E.17: a failed model call must not put the provider's error text into the logs.
 *
 * Database-free: the route runs for real, but the session, rate limiter, billing client and @google/genai are mocked, so no
 * service, database or network is involved. Every console method is captured, and every logged argument is rendered with
 * util.inspect (depth unlimited, hidden properties shown), so a message, stack or body that is merely nested inside an
 * object or an Error is found as well.
 */
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  refundOperationCredits: vi.fn(),
  settleOperation: vi.fn(),
  consumeCreditsForOperation: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: mocks.generateContent } };
  }),
}));
vi.mock("@/lib/auth/resolve-session-token", () => ({ resolveSessionTokenFromRequest: () => "bearer-placeholder" }));
vi.mock("@/lib/auth/verify-jwt", () => ({
  isJwtConfigured: () => true,
  verifyJwtToken: async () => ({ sub: "user-e17" }),
}));
vi.mock("@/lib/rateLimit/chatLimiter", () => ({ checkChatRateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
vi.mock("@/lib/billing/server-billing", () => ({
  AI_OPERATION_COSTS: { AI_CHAT_QUERY: 1 },
  deliveryTrackingEnabled: () => false,
  recordDeliveryAttempt: vi.fn(),
  consumeCreditsForOperation: mocks.consumeCreditsForOperation,
  refundOperationCredits: mocks.refundOperationCredits,
  settleOperation: mocks.settleOperation,
}));

import { POST } from "@/app/api/chat/route";

/** Deliberately distinctive: none of these can occur in the route's own log text. */
const MESSAGE_SENTINEL = "E17-SENTINEL-PROVIDER-MESSAGE-7f3a9c";
const STACK_SENTINEL = "E17-SENTINEL-PROVIDER-STACK-b81d04";
const BODY_SENTINEL = "E17-SENTINEL-PROVIDER-BODY-5e62ad";
const SENTINELS = [MESSAGE_SENTINEL, STACK_SENTINEL, BODY_SENTINEL];

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;
let logged: unknown[][] = [];

/** A provider-shaped failure that carries all three sentinels in every place a logger could find them. */
function providerError(name: string, status: number): Error {
  const err = new Error(`provider said: ${MESSAGE_SENTINEL}`, { cause: { responseBody: BODY_SENTINEL } });
  err.name = name;
  err.stack = `${name}: provider said: ${MESSAGE_SENTINEL}\n    at ${STACK_SENTINEL} (provider.js:1:1)`;
  Object.assign(err, { status, response: { body: BODY_SENTINEL }, requestBody: BODY_SENTINEL });
  return err;
}

const render = (calls: unknown[][]) => calls.map((args) => args.map((a) => inspect(a, { depth: null, showHidden: true })).join(" ")).join("\n");

function chatRequest(): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "What is water?" }] }),
  });
}

beforeEach(() => {
  logged = [];
  for (const method of CONSOLE_METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  }
  vi.stubEnv("GEMINI_API_KEY", "unit-test-placeholder");
  mocks.consumeCreditsForOperation.mockResolvedValue({
    ok: true,
    status: 200,
    capabilities: { captureCapabilityToken: "capture-placeholder", refundCapabilityToken: "refund-placeholder" },
  });
  mocks.refundOperationCredits.mockResolvedValue({ outcome: "released" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("the detector", () => {
  it("finds all three sentinels in a raw provider error (so a passing run below means something)", () => {
    const rendered = render([["[api/chat] Gemini failed", { err: providerError("ApiError", 500) }]]);
    for (const sentinel of SENTINELS) expect(rendered).toContain(sentinel);
  });
});

describe("POST /api/chat when the model call fails", () => {
  it.each([
    ["an ApiError with a status", () => providerError("ApiError", 503), { errorName: "ApiError", status: 503 }],
    ["an error whose name is not in the allow-list", () => providerError(`Custom-${MESSAGE_SENTINEL}`, 500), { errorName: "other", status: 500 }],
    ["a thrown string", () => `raw string ${MESSAGE_SENTINEL} ${BODY_SENTINEL}`, { errorName: "non_object" }],
    ["an error with a non-numeric status", () => Object.assign(providerError("ApiError", 500), { status: `HTTP ${MESSAGE_SENTINEL}` }), { errorName: "ApiError" }],
  ])("logs only allow-listed fields for %s", async (_label, makeError, expectedFields) => {
    mocks.generateContent.mockRejectedValue(makeError());

    const res = await POST(chatRequest());

    // Behaviour is unchanged: 502, and the reservation is released with the same reason.
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "AI_SERVICE_UNAVAILABLE" });
    expect(mocks.refundOperationCredits).toHaveBeenCalledWith(expect.objectContaining({ reason: "ai_generation_error" }));
    expect(mocks.settleOperation).not.toHaveBeenCalled();

    // The failure was logged, with exactly the approved fields.
    const failure = logged.find((args) => String(args[0]).includes("Gemini failed"));
    expect(failure, "the Gemini failure must still be logged").toBeDefined();
    const fields = failure![1] as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(["errorName", "referenceId", "userId", ...Object.keys(expectedFields).filter((k) => k === "status")].sort());
    expect(fields).toMatchObject({ userId: "user-e17", ...expectedFields });
    expect(typeof fields.referenceId).toBe("string");

    // And nothing anywhere in any logged argument contains the provider's text.
    const rendered = render(logged);
    for (const sentinel of SENTINELS) expect(rendered, `log output contains ${sentinel}`).not.toContain(sentinel);
    for (const args of logged) {
      for (const arg of args) expect(arg instanceof Error, "an Error object was logged").toBe(false);
    }
  });
});
