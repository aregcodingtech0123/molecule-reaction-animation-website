/**
 * Phase 2C step 4: the whole capability flow through the real entry point, with fetch over a real socket, and the process's
 * real stdout and stderr as the log under test. No spy in between: if a token reached any logging path, including one no
 * test knows about, it is in this output. Runs under production rules too, because that is where it has to hold.
 *
 * The signing key is random per run and unknown to the test, so every token here really was minted by the child.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { createTestPool, createUser } from "../support/db";
import { CAPABILITY_FIELD } from "../support/settlement";
import { DEVELOPMENT_VARS, PRODUCTION_VARS, startService, strongSecret, type ServiceProcess } from "../support/service-process";

let db: pg.Pool;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
});

describe.each([
  ["production", PRODUCTION_VARS],
  ["development", DEVELOPMENT_VARS],
])("the real process, NODE_ENV=%s", (_mode, vars) => {
  it("reserve, capture, refund, repeats and refusals: the contract holds, and no token or secret reaches its output", async () => {
    const settlementSecret = strongSecret();
    const svc: ServiceProcess = await startService({ ...vars, SETTLEMENT_CAPABILITY_SECRET: settlementSecret });
    try {
      const health = await svc.firstHealth();
      expect(health?.status, svc.output()).toBe(200);

      const call = async (route: string, body: unknown, headers: Record<string, string> = { "X-Internal-Service-Key": TEST_ENV.INTERNAL_SERVICE_SECRET }) => {
        const res = await fetch(`${svc.url}/api/billing${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
        const text = await res.text();
        return { status: res.status, text, json: JSON.parse(text) as { data: Record<string, unknown> } };
      };

      const u = await createUser(db, { balance: 0, verified: true });
      await db.query(`SELECT post_credit_transaction($1, 20, 'SIGNUP_BONUS', 'signup')`, [u.id]);
      const session = bearer(u);
      const reserve = async () => {
        const referenceId = randomUUID();
        const res = await call("/consume", { operationType: "AI_CHAT_QUERY", referenceId }, { "X-Internal-Service-Key": TEST_ENV.INTERNAL_SERVICE_SECRET, Authorization: session });
        expect(res.status, res.text).toBe(200);
        return { referenceId, capture: res.json.data.captureCapabilityToken as string, refund: res.json.data.refundCapabilityToken as string };
      };
      const settle = (route: string, referenceId: string, token: string, headers?: Record<string, string>) => call(route, { referenceId, [CAPABILITY_FIELD]: token }, headers);

      // ── Capture, without any session, and its repeat ─────────────────────────────────────────────────
      const a = await reserve();
      const captured = await settle("/capture", a.referenceId, a.capture);
      expect(captured.status).toBe(200);
      expect(captured.json.data).toMatchObject({ captured: true, amount: 1, alreadyProcessed: false });
      const repeated = await settle("/capture", a.referenceId, a.capture);
      expect(repeated.status).toBe(200);
      expect(repeated.json.data).toMatchObject({ captured: true, alreadyProcessed: true, ledgerId: captured.json.data.ledgerId });
      expect((await settle("/refund", a.referenceId, a.refund)).json.data).toMatchObject({ refunded: false, outcome: "already_captured" });

      // ── Refund, without any session, and its repeat ──────────────────────────────────────────────────
      const b = await reserve();
      expect((await settle("/refund", b.referenceId, b.refund)).json.data).toMatchObject({ refunded: true, outcome: "released" });
      expect((await settle("/refund", b.referenceId, b.refund)).json.data).toMatchObject({ refunded: false, outcome: "already_released" });
      expect((await settle("/capture", b.referenceId, b.capture)).status).toBe(409);

      // ── Refusals: wrong purpose, tampered, garbage, wrong reference, and the internal key ───────────
      const c = await reserve();
      const tampered = `${c.capture.slice(0, -1)}${c.capture.endsWith("A") ? "B" : "A"}`;
      for (const [referenceId, token] of [
        [c.referenceId, c.refund],
        [c.referenceId, tampered],
        [c.referenceId, "not-a-token"],
        ["some-other-reference", c.capture],
      ] as const) {
        const refused = await settle("/capture", referenceId, token);
        expect(refused.status).toBe(403);
        expect(refused.json).toEqual({ success: false, error: "Settlement not authorized.", code: "SETTLEMENT_NOT_AUTHORIZED" });
      }
      expect((await settle("/capture", c.referenceId, c.capture, {})).status).toBe(404);
      expect((await settle("/capture", c.referenceId, c.capture, { "X-Internal-Service-Key": "wrong-key-0123456789-abcdefghijklmnopqrstuv" })).status).toBe(404);

      // ── Still held after all of that, and the genuine token still works ─────────────────────────────
      expect((await settle("/capture", c.referenceId, c.capture)).status).toBe(200);

      // ── The process's own output ────────────────────────────────────────────────────────────────────
      const output = svc.output();
      expect(output).toContain("SETTLEMENT_AUTH_REJECTED");
      expect(output).toContain("[credits] Captured");
      expect(output).not.toContain("msc1.");
      for (const token of [a.capture, a.refund, b.capture, b.refund, c.capture, c.refund, tampered]) {
        for (const part of token.split(".").slice(1)) expect(output).not.toContain(part);
      }
      for (const secret of [settlementSecret, TEST_ENV.INTERNAL_SERVICE_SECRET, TEST_ENV.JWT_SECRET, session.replace("Bearer ", "")]) {
        expect(output).not.toContain(secret);
      }
    } finally {
      await svc.stop();
    }
  }, 90_000);
});
