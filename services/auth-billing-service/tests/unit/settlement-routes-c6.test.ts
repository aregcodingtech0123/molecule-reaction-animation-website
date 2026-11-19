/**
 * Step 7.4, C6: /capture and /refund have one path, the capability. Database-free: the settlement service and the database
 * readiness check are mocked, so nothing here touches PostgreSQL. What it proves is the wiring and the request handling in
 * front of the service; what the service then does with a valid capability is proven by the database-backed suites
 * (tests/api/settlement-*.test.ts), not here.
 *
 *  1. Router wiring: one route per path, with no session middleware.
 *  2. Middleware: a missing and an invalid capability get the same 403.
 *  3. Controller: user and reference come from the claims only; no claims, no service call.
 *  4. Ordering: the internal key is checked before the capability (404 before 403), through the real app.
 */
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/middlewares/requireDatabase.js", () => ({ requireDatabase: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../src/services/aiCredits.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/aiCredits.service.js")>()),
  captureOperation: vi.fn(),
  releaseOperation: vi.fn(),
}));

import { createApp } from "../../src/app.js";
import * as billingController from "../../src/controllers/billing.controller.js";
import { requireAuth } from "../../src/middlewares/requireAuth.js";
import { requireDatabase } from "../../src/middlewares/requireDatabase.js";
import { requireInternalService } from "../../src/middlewares/requireInternalService.js";
import { requireSettlementCapability } from "../../src/middlewares/requireSettlementCapability.js";
import { requireVerified } from "../../src/middlewares/requireVerified.js";
import { internalBillingRouter } from "../../src/routes/billing.routes.js";
import { captureOperation, releaseOperation } from "../../src/services/aiCredits.service.js";
import { mintSettlementCapability, type SettlementClaims } from "../../src/utils/settlementCapability.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { CAPABILITY_FIELD, TEST_SETTLEMENT_KEYS, claimsOf } from "../support/settlement";

const NOT_AUTHORIZED = { success: false, error: "Settlement not authorized.", code: "SETTLEMENT_NOT_AUTHORIZED" };
const NOT_FOUND = { success: false, error: "Route not found." };

const userId = randomUUID();
const referenceId = randomUUID();
const now = Math.floor(Date.now() / 1000);
const mint = (purpose: "capture" | "refund") =>
  mintSettlementCapability(purpose, { userId, referenceId, amount: 1, operationType: "AI_CHAT_QUERY", createdAtSeconds: now, reservationExpiresAtSeconds: now + 600 }, TEST_SETTLEMENT_KEYS);

beforeEach(() => {
  vi.mocked(captureOperation).mockReset();
  vi.mocked(releaseOperation).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("1. router wiring: only the capability routes remain", () => {
  type Layer = { handle: unknown };
  type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Layer[] } };
  const postRoutes = (path: string) =>
    (internalBillingRouter.stack as unknown as RouteLayer[]).filter((l) => l.route?.path === path && l.route.methods.post).map((l) => l.route!);

  it.each([
    ["/capture", billingController.captureCredits],
    ["/refund", billingController.refundCredits],
  ])("%s has exactly one POST route: key, capability, database readiness, controller; no session middleware", (path, controller) => {
    const routes = postRoutes(path);
    expect(routes).toHaveLength(1);
    const handlers = routes[0]!.stack.map((l) => l.handle);
    expect(handlers).toHaveLength(4);
    expect(handlers[0]).toBe(requireInternalService);
    expect(typeof handlers[1]).toBe("function"); // the capability middleware (a closure over its purpose and options)
    expect(handlers[2]).toBe(requireDatabase);
    expect(handlers[3]).toBe(controller);
    expect(handlers).not.toContain(requireAuth);
    expect(handlers).not.toContain(requireVerified);
  });

  it("/consume keeps its session chain (C6 removes the legacy settlement paths only)", () => {
    const [consume] = postRoutes("/consume");
    expect(consume!.stack.map((l) => l.handle)).toEqual([requireInternalService, requireDatabase, requireAuth, requireVerified, billingController.consumeCredits]);
  });
});

describe("2. middleware: a missing and an invalid capability are the same 403", () => {
  const run = (body: unknown, purpose: "capture" | "refund" = "capture", url = `/api/billing/${purpose}`) => {
    const req = { body, originalUrl: url } as unknown as Request;
    const next = vi.fn();
    requireSettlementCapability(purpose, { required: true })(req, {} as Response, next as NextFunction);
    return { req, next };
  };
  const refusalOf = (next: ReturnType<typeof vi.fn>) => {
    expect(next).toHaveBeenCalledTimes(1);
    const [arg] = next.mock.calls[0]!;
    expect(arg).not.toBe("route"); // never a fall-through to another route
    return arg as { statusCode: number; code: string; message: string };
  };

  it.each<[string, unknown]>([
    ["no body at all", undefined],
    ["a null body", null],
    ["a string body", "settlementCapability"],
    ["an array body", [1, 2]],
    ["an empty object", {}],
    ["a body with a reference only", { referenceId }],
    ["an inherited field only", Object.create({ [CAPABILITY_FIELD]: mint("capture") })],
  ])("missing: %s", (_label, body) => {
    const { req, next } = run(body);
    expect(refusalOf(next)).toMatchObject({ statusCode: 403, code: "SETTLEMENT_NOT_AUTHORIZED", message: "Settlement not authorized." });
    expect((req as { settlement?: unknown }).settlement).toBeUndefined();
  });

  it.each<[string, () => Record<string, unknown>]>([
    ["an empty string", () => ({ referenceId, [CAPABILITY_FIELD]: "" })],
    ["garbage", () => ({ referenceId, [CAPABILITY_FIELD]: "not-a-capability" })],
    ["a non-string", () => ({ referenceId, [CAPABILITY_FIELD]: { token: mint("capture") } })],
    ["a token of the other purpose", () => ({ referenceId, [CAPABILITY_FIELD]: mint("refund") })],
    ["a token for another reference", () => ({ referenceId: randomUUID(), [CAPABILITY_FIELD]: mint("capture") })],
    ["a token with an altered signature", () => ({ referenceId, [CAPABILITY_FIELD]: `${mint("capture").slice(0, -4)}AAAA` })],
  ])("invalid: %s gives exactly the missing-capability answer", (_label, makeBody) => {
    const missing = refusalOf(run({ referenceId }).next);
    const { next } = run(makeBody());
    expect(refusalOf(next)).toMatchObject({ statusCode: missing.statusCode, code: missing.code, message: missing.message });
  });

  it("a valid capability passes and sets the verified claims", () => {
    const { req, next } = run({ referenceId, [CAPABILITY_FIELD]: mint("capture") });
    expect(next).toHaveBeenCalledWith();
    expect((req as { settlement?: SettlementClaims }).settlement).toMatchObject({ sub: userId, ref: referenceId, pur: "capture" });
  });

  it("the missing-capability log names the path without its query string, and never the token", () => {
    const token = mint("capture");
    run(undefined, "capture", `/api/billing/capture?${CAPABILITY_FIELD}=${token}`);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("capability_missing");
    expect(logged).toContain("/api/billing/capture");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("settlementCapability=");
  });
});

describe("3. controller: the claims decide the user and the reference; no fallback", () => {
  const call = async (fn: typeof billingController.captureCredits, req: Record<string, unknown>) => {
    const res = { json: vi.fn() };
    const next = vi.fn();
    await fn(req as unknown as Request, res as unknown as Response, next);
    return { res, next };
  };
  // A session and a body that name someone else: the old fallbacks would have used them.
  const session = { user: { sub: "session-user", email: "session@example.test" } };
  const claims = claimsOf(mint("capture"));

  it.each([
    ["captureCredits", billingController.captureCredits, captureOperation],
    ["refundCredits", billingController.refundCredits, releaseOperation],
  ])("%s without claims: the uniform 403 and no service call, even with a session and a body reference", async (_name, fn, service) => {
    const { res, next } = await call(fn, { ...session, body: { referenceId: "body-reference", reason: "x" } });
    expect(service).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: "SETTLEMENT_NOT_AUTHORIZED" }));
  });

  it("captureCredits with claims: the service gets claims.sub and claims.ref, not the session or the body", async () => {
    vi.mocked(captureOperation).mockResolvedValue({ captured: true } as never);
    const { res, next } = await call(billingController.captureCredits, { ...session, settlement: claims, body: { referenceId: "body-reference" } });
    expect(captureOperation).toHaveBeenCalledExactlyOnceWith(claims.sub, claims.ref, claims);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { captured: true } });
    expect(next).not.toHaveBeenCalled();
  });

  it("refundCredits with claims: claims.sub and claims.ref, and only the reason comes from the body (default kept)", async () => {
    vi.mocked(releaseOperation).mockResolvedValue({ refunded: true } as never);
    await call(billingController.refundCredits, { ...session, settlement: claims, body: { referenceId: "body-reference", reason: "ai_generation_error" } });
    expect(releaseOperation).toHaveBeenLastCalledWith(claims.sub, claims.ref, "ai_generation_error", claims);
    await call(billingController.refundCredits, { ...session, settlement: claims, body: {} });
    expect(releaseOperation).toHaveBeenLastCalledWith(claims.sub, claims.ref, "ai_operation_failed", claims);
    await call(billingController.refundCredits, { ...session, settlement: claims });
    expect(releaseOperation).toHaveBeenLastCalledWith(claims.sub, claims.ref, "ai_operation_failed", claims);
  });

  it("a service failure still goes to next(), as before", async () => {
    const failure = new Error("boom");
    vi.mocked(captureOperation).mockRejectedValue(failure);
    const { next } = await call(billingController.captureCredits, { settlement: claims });
    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe("4. ordering: the internal key is checked before the capability (through the real app)", () => {
  const app = createApp();
  const withKey = (path: string) => request(app).post(path).set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET);
  const withoutKey = (path: string) => request(app).post(path);

  describe.each([
    ["/api/billing/capture", "capture" as const, captureOperation],
    ["/api/billing/refund", "refund" as const, releaseOperation],
  ])("%s", (path, purpose, service) => {
    it("no key or a wrong key → the 404 of an unknown route, whatever the body (capability or not)", async () => {
      const valid = { referenceId, [CAPABILITY_FIELD]: mint(purpose) };
      for (const res of [
        await withoutKey(path).send({ referenceId }),
        await withoutKey(path).send(valid),
        await withoutKey(path).set("Authorization", bearer({ id: userId, email: "u@example.test" })).send({ referenceId }),
        await request(app).post(path).set("X-Internal-Service-Key", "wrong-key-0123456789-abcdefghijklmnopqrstuv").send(valid),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(NOT_FOUND);
      }
      expect(service).not.toHaveBeenCalled();
    });

    it("the key but no capability → the uniform 403, even with a valid session", async () => {
      for (const res of [
        await withKey(path).send({ referenceId }),
        await withKey(path).set("Authorization", bearer({ id: userId, email: "u@example.test" })).send({ referenceId }),
        await withKey(path).send({ referenceId, [CAPABILITY_FIELD]: "garbage" }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual(NOT_AUTHORIZED);
      }
      expect(service).not.toHaveBeenCalled();
    });

    it("the key and a valid capability → the request reaches the service with the claims", async () => {
      vi.mocked(service).mockResolvedValue({ ok: true } as never);
      const res = await withKey(path).send({ referenceId, [CAPABILITY_FIELD]: mint(purpose) });
      expect(res.status).toBe(200);
      expect(service).toHaveBeenCalledTimes(1);
      expect(vi.mocked(service).mock.calls[0]![0]).toBe(userId);
    });
  });
});
