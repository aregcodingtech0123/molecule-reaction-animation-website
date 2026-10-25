/**
 * SEC-16 (BFF half): every model call is bounded — output tokens, total prompt size — and the service's
 * daily caps reach the browser as distinct, non-charging answers. Real Express + test DB; @google/genai mocked.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { createTestPool, createUser } from "../../services/auth-billing-service/tests/support/db";
import { sessionCookie } from "../support/bff";
import { startAuthBillingService, type RunningService } from "../support/express-server";

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: gemini.generateContent } };
  }),
}));

import { POST } from "@/app/api/chat/route";

let service: RunningService;
let db: pg.Pool;
beforeAll(async () => {
  service = await startAuthBillingService();
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await service.close();
});
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.env.AUTH_SERVICE_URL = `${service.origin}/api/auth`;
  process.env.BILLING_SERVICE_URL = `${service.origin}/api/billing`;
  process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
  gemini.generateContent.mockReset();
  gemini.generateContent.mockResolvedValue({ text: "Water is H2O." });
});

async function funded(balance = 10) {
  const u = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, balance]);
  return u;
}
type Msg = { role: "user" | "assistant"; content: string };
const chat = (u: { id: string; email: string }, messages: Msg[] = [{ role: "user", content: "What is water?" }]) =>
  POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie(tokenFor(u)) },
      body: JSON.stringify({ messages }),
    }),
  );
const balanceOf = async (id: string) => (await db.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [id])).rows[0].balance;
const sentConfig = () => gemini.generateContent.mock.calls.at(-1)![0] as { contents: Array<{ role: string; parts: Array<{ text: string }> }>; config: Record<string, unknown> };

describe("model call bounds (SEC-16)", () => {
  it("output is capped: maxOutputTokens 2048 by default, GEMINI_MAX_OUTPUT_TOKENS overrides, nonsense falls back", async () => {
    const u = await funded();
    expect((await chat(u)).status).toBe(200);
    expect(sentConfig().config.maxOutputTokens).toBe(2048);
    vi.stubEnv("GEMINI_MAX_OUTPUT_TOKENS", "512");
    await chat(u);
    expect(sentConfig().config.maxOutputTokens).toBe(512);
    vi.stubEnv("GEMINI_MAX_OUTPUT_TOKENS", "-1");
    await chat(u);
    expect(sentConfig().config.maxOutputTokens).toBe(2048);
  });

  it("the prompt is bounded: oldest turns are dropped to fit 32 000 characters; the newest user turn always stays", async () => {
    const u = await funded();
    const long = (i: number, role: Msg["role"]) => ({ role, content: `${i}:`.padEnd(7_900, "x") });
    const history: Msg[] = Array.from({ length: 24 }, (_, i) => long(i, i % 2 === 0 ? "user" : "assistant"));
    history[23] = { role: "user", content: "final question".padEnd(7_900, "?") };
    expect((await chat(u, history)).status).toBe(200);
    const { contents } = sentConfig();
    const chars = contents.reduce((n, c) => n + c.parts[0]!.text.length, 0);
    expect(chars).toBeLessThanOrEqual(32_000);
    expect(contents.at(-1)!.parts[0]!.text.startsWith("final question")).toBe(true);
    expect(contents.length).toBeLessThan(24);
  });

  it("a short conversation is passed through unchanged", async () => {
    const u = await funded();
    const history: Msg[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "What is water?" },
    ];
    await chat(u, history);
    expect(sentConfig().contents.map((c) => [c.role, c.parts[0]!.text])).toEqual([
      ["user", "Hi"],
      ["model", "Hello"],
      ["user", "What is water?"],
    ]);
  });
});

describe("daily caps reach the browser without a charge or a model call (SEC-16)", () => {
  it("per-user cap → 429 AI_DAILY_LIMIT with Retry-After", async () => {
    vi.stubEnv("AI_DAILY_TURNS_PER_USER", "1");
    const u = await funded();
    expect((await chat(u)).status).toBe(200);
    gemini.generateContent.mockClear();
    const res = await chat(u);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("AI_DAILY_LIMIT");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(body.retryAfter).toBe(Number(res.headers.get("retry-after")));
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(await balanceOf(u.id)).toBe(9);
  });

  it("global cap → 503 AI_CAPACITY_REACHED", async () => {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours'`);
    vi.stubEnv("AI_DAILY_TURNS_GLOBAL", String(Math.max(1, rows[0].n)));
    const u = await funded();
    const res = await chat(u);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("AI_CAPACITY_REACHED");
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(await balanceOf(u.id)).toBe(10);
  });
});
