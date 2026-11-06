/**
 * Settlement must not depend on the user's session staying alive (Phase 2A, ADR-01).
 * Real Express service + real test DB; only @google/genai is mocked. These tests do not name the settlement
 * credential, so they stay valid whichever way Phase 2C authenticates it.
 *
 * Revocation happens inside the mocked model call: after the reservation, before settlement.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { balanceOf, createTestPool, createUser, ledgerOf, ledgerSum } from "../../services/auth-billing-service/tests/support/db";
import { callGateway, sessionCookie } from "../support/bff";
import { startAuthBillingService, type RunningService } from "../support/express-server";
import { itKnownDefect } from "../support/known-defect";

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: gemini.generateContent } };
  }),
}));

import { POST } from "@/app/api/chat/route";

type User = { id: string; email: string };

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
});

async function funded(balance: number): Promise<User> {
  const u = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, balance]);
  return u;
}

async function holdsOf(userId: string) {
  const { rows } = await db.query<{ reference_id: string; status: string; ledger_id: string | null; settle_reason: string | null }>(
    `SELECT reference_id, status, ledger_id::text, settle_reason FROM ai_credit_holds WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows;
}

function chat(token: string) {
  const headers = new Headers({ "content-type": "application/json", cookie: sessionCookie(token) });
  const body = JSON.stringify({ messages: [{ role: "user", content: "What is water?" }] });
  return POST(new Request("http://localhost:3000/api/chat", { method: "POST", headers, body }));
}

const errorLines = () =>
  vi.mocked(console.error).mock.calls.map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

const REVOCATIONS: Array<[string, (u: User, token: string) => Promise<void>]> = [
  [
    "logout",
    async (_u, token) => {
      await callGateway("auth", "logout", { method: "POST", cookie: sessionCookie(token) });
    },
  ],
  [
    "a token_version bump (password reset, Google takeover)",
    async (u) => {
      await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [u.id]);
    },
  ],
];

const ANSWER = "Water is H₂O.";

/** The model call revokes the session, then answers. No expect() in here: the route would catch it as a model error. */
function revokeThenAnswer(revoke: () => Promise<void>) {
  gemini.generateContent.mockImplementation(async () => {
    await revoke();
    return { text: ANSWER };
  });
}

describe("harness: the scenario really reaches 'reserved, then revoked, before settlement'", () => {
  it.each(REVOCATIONS)("%s during generation", async (_name, revoke) => {
    const u = await funded(2);
    const token = tokenFor(u);
    const seen: { holdDuringGeneration?: string; meStatus?: number; meCode?: string } = {};
    gemini.generateContent.mockImplementation(async () => {
      seen.holdDuringGeneration = (await holdsOf(u.id))[0]?.status;
      await revoke(u, token);
      const me = await fetch(`${service.origin}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      seen.meStatus = me.status;
      seen.meCode = ((await me.json()) as { code?: string }).code;
      return { text: ANSWER };
    });

    const res = await chat(token);

    expect(seen).toEqual({ holdDuringGeneration: "held", meStatus: 401, meCode: "TOKEN_REVOKED" });
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});

describe("a reservation authorised before revocation can still be settled", () => {
  // Phase 2C must make these pass.
  itKnownDefect.each(REVOCATIONS)("%s during generation: the valid answer is delivered and charged exactly once", async (_name, revoke) => {
    const u = await funded(2);
    const token = tokenFor(u);
    revokeThenAnswer(() => revoke(u, token));

    const res = await chat(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: ANSWER, balance: 1 });
    const holds = await holdsOf(u.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ status: "captured" });
    const debits = (await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION");
    expect(debits).toEqual([expect.objectContaining({ amount: -1, reference_id: holds[0]!.reference_id, id: holds[0]!.ledger_id })]);
    expect(await balanceOf(db, u.id)).toBe(1);
    expect(await ledgerSum(db, u.id)).toBe(1);
    expect(errorLines().filter((l) => l.includes("CAPTURE_FAILED"))).toEqual([]);
  });

  // Today this path fails safe (the hold expires uncharged) but keeps the credit reserved until the TTL.
  itKnownDefect.each(REVOCATIONS)("%s, then the model fails: the reservation is released at once, never charged", async (_name, revoke) => {
    const u = await funded(2);
    const token = tokenFor(u);
    gemini.generateContent.mockImplementation(async () => {
      await revoke(u, token);
      throw new Error("boom");
    });

    const res = await chat(token);

    expect(res.status).toBe(502);
    expect(await holdsOf(u.id)).toEqual([expect.objectContaining({ status: "released", settle_reason: "ai_generation_error", ledger_id: null })]);
    expect((await ledgerOf(db, u.id)).filter((r) => r.transaction_type === "CREDIT_CONSUMPTION")).toEqual([]);
    expect(await balanceOf(db, u.id)).toBe(2);
    expect(errorLines().filter((l) => l.includes("RELEASE_FAILED"))).toEqual([]);
  });
});

describe("a revoked session cannot start anything new", () => {
  it.each(REVOCATIONS)("a new turn after %s during the previous turn → 401, no new reservation, no model call", async (_name, revoke) => {
    const u = await funded(5);
    const token = tokenFor(u);
    revokeThenAnswer(() => revoke(u, token));
    await chat(token);
    const holdsBefore = await holdsOf(u.id);
    expect(holdsBefore).toHaveLength(1);
    gemini.generateContent.mockClear();

    const res = await chat(token);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect((await holdsOf(u.id)).map((h) => h.reference_id)).toEqual(holdsBefore.map((h) => h.reference_id));
  });
});
