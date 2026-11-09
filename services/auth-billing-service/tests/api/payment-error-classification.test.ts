/**
 * Phase 2C step 4.1, finding C: an error is a payment-provider error because of its type, never because its free text contains
 * "Lemon". Real errors over real HTTP: a small Express app around the real error handler for the classification itself, and the
 * real routes for what the handler receives from them.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, stubExternal } from "../../../../scripts/test/network-guard.mjs";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { errorHandler } from "../../src/middlewares/errorHandler.js";
import { AppError, PaymentProviderError } from "../../src/types/index.js";
import { TEST_ENV } from "../setup/env";
import { bearer } from "../support/auth";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { createTestPool, createUser } from "../support/db";
import { everythingLogged, markedRaise, payloadOf } from "../support/marked-errors";

const MARKER = "SENSITIVE-PAY-MARKER-a07e";
const INTERNAL_ERROR = { success: false, error: "Internal server error.", code: "INTERNAL_ERROR" };
const PAYMENT_ERROR = { success: false, error: "PAYMENT_ERROR", message: "A payment error occurred. Please try again." };

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
});

/** The real handler answering one thrown value. */
function handlerAnswerTo(thrown: unknown) {
  const app = express();
  app.get("/x", (_req, _res, next) => next(thrown));
  app.use(errorHandler);
  return request(app).get("/x");
}
const realDatabaseError = (messagePrefix: string, sqlState = "XX000") => db.query(markedRaise(MARKER, sqlState, messagePrefix)).then(
  () => {
    throw new Error("the statement should have failed");
  },
  (err: unknown) => err,
);

describe("a typed payment-provider error takes the payment path", () => {
  it("400 with the existing body; logged as a payment error, by its code", async () => {
    const res = await handlerAnswerTo(new PaymentProviderError()).set("X-Request-Id", "req-1");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(PAYMENT_ERROR);
    expect(payloadOf(logs, "Payment provider error")).toEqual({ code: "PAYMENT_PROVIDER_ERROR", requestId: "req-1" });
  });

  it("an AppError from the Lemon integration keeps its own status and code: it never reached the payment path", async () => {
    const res = await handlerAnswerTo(new AppError(502, "Unable to create Lemon Squeezy checkout.", "LEMONSQUEEZY_CHECKOUT_FAILED"));
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ success: false, error: "Unable to create Lemon Squeezy checkout.", code: "LEMONSQUEEZY_CHECKOUT_FAILED" });
    expect(everythingLogged(logs)).not.toContain("Payment provider error");
  });

  it("the real checkout route, Lemon refusing: the AppError's 502, as before", async () => {
    stubExternal("api.lemonsqueezy.com", () => jsonResponse({ errors: [{ detail: "nope" }] }, 500));
    const user = await createUser(db);
    const res = await request(createApp()).post("/api/billing/checkout").set("Authorization", bearer(user)).send({ packageId: "starter" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("LEMONSQUEEZY_CHECKOUT_FAILED");
    expect(everythingLogged(logs)).not.toContain("Payment provider error");
  });
});

describe("free text does not make a payment error", () => {
  it.each(["Lemon ", "LEMONSQUEEZY "])("a real PostgreSQL error whose message contains %j: the generic 500, with no text logged", async (prefix) => {
    const res = await handlerAnswerTo(await realDatabaseError(prefix));
    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL_ERROR);
    expect(res.text).not.toContain(MARKER);
    expect(everythingLogged(logs)).not.toContain("Payment provider error");
    expect(everythingLogged(logs)).not.toContain(MARKER);
    expect(payloadOf(logs, "Unhandled error")).toMatchObject({ event: "UNHANDLED_ERROR", sqlstate: "XX000", severity: "ERROR" });
  });

  it("the same error from a real route, the legacy refund: the generic 500, with no text logged", async () => {
    const u = await createUser(db, { balance: 10, verified: true });
    const { default: pgModule } = await import("pg");
    const real = pgModule.Client.prototype.query;
    const broken = vi.spyOn(pgModule.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const sql = typeof args[0] === "string" ? args[0] : "";
      const sent = /SELECT status, amount, operation_type/.test(sql) ? [markedRaise(MARKER, "XX000", "Lemon ")] : args;
      return (real as (...a: unknown[]) => unknown).apply(this, sent) as never;
    });
    let res: request.Response;
    try {
      res = await request(createApp())
        .post("/api/billing/refund")
        .set("X-Internal-Service-Key", TEST_ENV.INTERNAL_SERVICE_SECRET)
        .set("Authorization", bearer(u))
        .send({ referenceId: randomUUID() });
    } finally {
      broken.mockRestore();
    }
    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL_ERROR);
    expect(everythingLogged(logs)).not.toContain("Payment provider error");
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("a plain Error that merely mentions Lemon: the generic 500; the frames stay, the text does not", async () => {
    const res = await handlerAnswerTo(new Error(`Lemon ${MARKER}`));
    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL_ERROR);
    expect(everythingLogged(logs)).not.toContain("Payment provider error");
    expect(everythingLogged(logs)).not.toContain(MARKER);
    expect((payloadOf(logs, "Unhandled error").stack as string[]).length).toBeGreaterThan(0);
  });

  it("a PostgreSQL error with the marker in DETAIL and HINT only: nothing in the log or the answer", async () => {
    const res = await handlerAnswerTo(await realDatabaseError("no provider word here "));
    expect(res.status).toBe(500);
    expect(res.text).not.toContain(MARKER);
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("the other classifications still come first: a transient SQLSTATE is a 503, with or without the word", async () => {
    const res = await handlerAnswerTo(await realDatabaseError("Lemon ", "40001"));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("TRANSIENT_DATABASE_ERROR");
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("a generic error keeps the safe generic answer", async () => {
    const res = await handlerAnswerTo(new Error(MARKER));
    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL_ERROR);
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });
});
