/**
 * Phase 2C step 4: a hold must never exist without both of its tokens. settlement-capability.test.ts covers the mint failing
 * for the first token (no key). The harder case is the second token failing after the first was already signed, which no real
 * input can reach, so the signer alone is replaced here. The transaction, the database and the routes are real.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser } from "../support/db";

const mintFault = vi.hoisted(() => ({
  purpose: null as string | null,
  error: null as Error | null,
  signed: [] as string[],
}));

vi.mock("../../src/utils/settlementCapability.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/settlementCapability.js")>();
  return {
    ...actual,
    mintSettlementCapability: (...args: Parameters<typeof actual.mintSettlementCapability>) => {
      if (mintFault.purpose === args[0]) throw mintFault.error;
      const token = actual.mintSettlementCapability(...args);
      mintFault.signed.push(token);
      return token;
    },
  };
});

const { SettlementCapabilityConfigError, SettlementCapabilityInputError } = await vi.importActual<typeof import("../../src/utils/settlementCapability.js")>("../../src/utils/settlementCapability.js");

const app = createApp();
let db: pg.Pool;
let logs: ConsoleSpies;
beforeAll(() => {
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await closePool();
});
beforeEach(() => {
  logs = spyConsole();
  mintFault.purpose = null;
  mintFault.error = null;
  mintFault.signed.length = 0;
});
afterEach(() => {
  mintFault.purpose = null;
});

const consume = (u: { id: string; email: string }, referenceId: string) =>
  request(app)
    .post("/api/billing/consume")
    .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
    .set("Authorization", bearer(u))
    .send({ operationType: "ARCH_RENDER_STD", referenceId });

const holdCount = async (userId: string) => (await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE user_id = $1`, [userId])).rows[0].n as number;

describe("a mint failure rolls the reservation back", () => {
  it.each<[string, string, () => Error]>([
    ["the capture token: a configuration error", "capture", () => new SettlementCapabilityConfigError()],
    ["the refund token, after the capture token was signed: a configuration error", "refund", () => new SettlementCapabilityConfigError()],
    ["the refund token, after the capture token was signed: an input error", "refund", () => new SettlementCapabilityInputError("referenceId")],
  ])("%s", async (_label, purpose, makeError) => {
    const u = await createUser(db, { balance: 0, verified: true });
    await db.query(`SELECT post_credit_transaction($1, 10, 'SIGNUP_BONUS', 'signup')`, [u.id]);
    const referenceId = randomUUID();
    mintFault.purpose = purpose;
    mintFault.error = makeError();

    const res = await consume(u, referenceId);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Internal server error.", code: "INTERNAL_ERROR" });
    expect(res.text).not.toContain("msc1.");
    expect(await holdCount(u.id)).toBe(0);
    expect(await balanceOf(db, u.id)).toBe(10);

    const logged = inspect([logs.log.mock.calls, logs.warn.mock.calls, logs.error.mock.calls], { depth: 10, maxStringLength: null });
    expect(logged).toContain("UNHANDLED_ERROR");
    expect(logged).not.toContain("msc1.");
    for (const token of mintFault.signed) expect(logged).not.toContain(token);

    // Nothing was left behind: once the fault is gone, the same reference reserves normally.
    mintFault.purpose = null;
    const retry = await consume(u, referenceId);
    expect(retry.status).toBe(200);
    expect(await holdCount(u.id)).toBe(1);
  });
});
