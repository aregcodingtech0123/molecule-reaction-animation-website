/**
 * Capture commits in the billing service, but the BFF never receives the answer, then retries (Phase 2B.1).
 * The real BFF talks over real HTTP to a loopback proxy in front of the real Express service and test DB; only
 * @google/genai is mocked. The proxy forwards everything unchanged. Settlement is authorised by the reservation's
 * capability, so a retry still reports the original capture after the session is gone.
 */
import type http from "node:http";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { balanceOf, createTestPool, createUser, ledgerOf, ledgerSum } from "../../services/auth-billing-service/tests/support/db";
import { interceptClientQueries, sqlStateFault } from "../../services/auth-billing-service/tests/support/pg-fault";
import { callGateway, sessionCookie } from "../support/bff";
import { startAuthBillingService, startFakeUpstream, type RunningService } from "../support/express-server";

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: gemini.generateContent } };
  }),
}));

import { POST } from "@/app/api/chat/route";

type User = { id: string; email: string };

const ANSWER = "Water is H₂O.";
const START_BALANCE = 2;

let service: RunningService;
let db: pg.Pool;
let cleanups: Array<() => void | Promise<void>> = [];
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
  gemini.generateContent.mockResolvedValue({ text: ANSWER });
});
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

async function funded(): Promise<User> {
  const u = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, START_BALANCE]);
  return u;
}

function chat(token: string) {
  const headers = new Headers({ "content-type": "application/json", cookie: sessionCookie(token) });
  const body = JSON.stringify({ messages: [{ role: "user", content: "What is water?" }] });
  return POST(new Request("http://localhost:3000/api/chat", { method: "POST", headers, body }));
}

const holdsOf = async (userId: string) =>
  (await db.query<{ status: string; ledger_id: string | null }>(`SELECT status, ledger_id::text FROM ai_credit_holds WHERE user_id = $1`, [userId])).rows;
const debitsOf = async (userId: string) => (await ledgerOf(db, userId)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION");
const errorLines = () =>
  vi.mocked(console.error).mock.calls.map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

async function expectChargedOnce(userId: string) {
  const holds = await holdsOf(userId);
  expect(holds).toHaveLength(1);
  expect(holds[0]!.status).toBe("captured");
  expect(await debitsOf(userId)).toEqual([expect.objectContaining({ amount: -1, id: holds[0]!.ledger_id })]);
  expect(await balanceOf(db, userId)).toBe(START_BALANCE - 1);
  expect(await ledgerSum(db, userId)).toBe(START_BALANCE - 1);
}

type Forwarded = { status: number; body: { data?: { captured?: boolean; alreadyProcessed?: boolean; ledgerId?: string; balance?: number }; code?: string } };

/**
 * Proxy between the BFF and the real billing service. The first /capture is forwarded (so it commits), then
 * `afterCommit` runs, then `lose` makes sure the BFF never receives that response. Later calls pass straight through.
 */
async function billingLosingFirstCaptureResponse(lose: (res: http.ServerResponse) => void, afterCommit: () => Promise<void> = async () => undefined) {
  const consumes: Forwarded[] = [];
  const captures: Forwarded[] = [];
  const proxy = await startFakeUpstream(async (req, body, res) => {
    const path = req.url ?? "";
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string" && !["host", "connection", "content-length"].includes(k)) headers[k] = v;
    }
    const upstream = await fetch(`${service.origin}/api/billing${path}`, { method: req.method, headers, body });
    const text = await upstream.text();
    const seen: Forwarded = { status: upstream.status, body: JSON.parse(text) };
    if (path.endsWith("/consume")) consumes.push(seen);
    if (path.endsWith("/capture")) {
      captures.push(seen);
      if (captures.length === 1) {
        await afterCommit();
        return lose(res);
      }
    }
    res.writeHead(upstream.status, { "content-type": "application/json" }).end(text);
  });
  process.env.BILLING_SERVICE_URL = proxy.origin;
  cleanups.push(() => proxy.close());
  return { consumes, captures };
}

const LOSSES: Array<[string, (res: http.ServerResponse) => void, number | null]> = [
  ["the connection drops", (res) => res.socket?.destroy(), null],
  ["the response never arrives (BFF call timeout)", () => undefined, 1_500],
];

const REVOCATIONS: Array<[string, (u: User, token: string) => Promise<void>]> = [
  [
    "logout",
    async (_u, token) => {
      await callGateway("auth", "logout", { method: "POST", cookie: sessionCookie(token) });
    },
  ],
  [
    "a token_version bump",
    async (u) => {
      await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [u.id]);
    },
  ],
];

describe("capture committed, response lost, session still valid", () => {
  it.each(LOSSES)("%s: the retry reports the original capture, one debit, no second generation", async (_name, lose, callTimeoutMs) => {
    if (callTimeoutMs) vi.stubEnv("BILLING_CALL_TIMEOUT_MS", String(callTimeoutMs));
    const u = await funded();
    const { consumes, captures } = await billingLosingFirstCaptureResponse(lose);

    const res = await chat(tokenFor(u));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: ANSWER, balance: START_BALANCE - 1 });
    expect(captures).toHaveLength(2);
    expect(captures[0]).toMatchObject({ status: 200, body: { data: { captured: true, alreadyProcessed: false } } });
    expect(captures[1]).toMatchObject({ status: 200, body: { data: { captured: true, alreadyProcessed: true, ledgerId: captures[0]!.body.data!.ledgerId } } });
    expect(consumes).toHaveLength(1);
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
    await expectChargedOnce(u.id);
    expect(errorLines().filter((l) => l.includes("CAPTURE_FAILED"))).toEqual([]);
  });
});

describe("capture committed, session revoked, response lost", () => {
  async function scenario(revoke: (u: User, token: string) => Promise<void>) {
    const u = await funded();
    const token = tokenFor(u);
    const seen: { meStatus?: number } = {};
    const proxy = await billingLosingFirstCaptureResponse(
      (res) => res.socket?.destroy(),
      async () => {
        await revoke(u, token);
        seen.meStatus = (await fetch(`${service.origin}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })).status;
      },
    );
    const res = await chat(token);
    return { u, res, seen, ...proxy };
  }

  it.each(REVOCATIONS)("%s: the money stays right: one debit, reservation captured, nothing new reserved or generated", async (_name, revoke) => {
    const { u, res, seen, consumes, captures } = await scenario(revoke);

    expect(seen.meStatus).toBe(401);
    expect(captures.length).toBeGreaterThanOrEqual(2);
    expect(captures[0]).toMatchObject({ status: 200, body: { data: { captured: true, alreadyProcessed: false } } });
    expect(res.status).toBe(200);
    expect(consumes).toHaveLength(1);
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
    await expectChargedOnce(u.id);
  });

  it.each(REVOCATIONS)("%s: a revoked session does not invalidate the settlement retry, which reports the original capture", async (_name, revoke) => {
    const { res, captures } = await scenario(revoke);

    expect(captures[1]).toMatchObject({ status: 200, body: { data: { captured: true, alreadyProcessed: true, ledgerId: captures[0]!.body.data!.ledgerId } } });
    expect(await res.json()).toEqual({ message: ANSWER, balance: START_BALANCE - 1 });
    expect(errorLines().filter((l) => l.includes("CAPTURE_FAILED"))).toEqual([]);
  });
});

describe("a transient database failure during capture, seen end to end", () => {
  function faultOnce(pattern: RegExp, sqlState: string) {
    const state = { fired: false };
    cleanups.push(
      interceptClientQueries((q) => {
        if (state.fired || !pattern.test(q.sql)) return null;
        state.fired = true;
        return q.proceed(sqlStateFault(sqlState));
      }),
    );
    return state;
  }

  it("before the debit: the service answers 5xx, the BFF retries, the turn is charged once", async () => {
    const u = await funded();
    // Armed inside the model call: /consume runs the same hold query.
    let fault: { fired: boolean } | undefined;
    gemini.generateContent.mockImplementation(async () => {
      fault = faultOnce(/SELECT status, amount, operation_type/, "40001");
      return { text: ANSWER };
    });

    const res = await chat(tokenFor(u));

    expect(fault?.fired).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: ANSWER, balance: START_BALANCE - 1 });
    await expectChargedOnce(u.id);
  });

  it("inside the debit: the turn is still charged once, not lost to a terminal capture_failed", async () => {
    const u = await funded();
    let fault: { fired: boolean } | undefined;
    gemini.generateContent.mockImplementation(async () => {
      fault = faultOnce(/post_credit_transaction/, "40001");
      return { text: ANSWER };
    });

    const res = await chat(tokenFor(u));

    expect(fault?.fired).toBe(true);
    expect(await res.json()).toEqual({ message: ANSWER, balance: START_BALANCE - 1 });
    await expectChargedOnce(u.id);
  });
});
