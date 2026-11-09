/**
 * Phase 2C step 4.1, finding B: a failed fulfilment must not put database text in `last_error` or in the log. `last_error` is read
 * by people (db:reconcile, the runbook's SELECT), and nothing compares it, so it holds a fixed description. The state machine around
 * it (status, attempts, retries, the give-up alert, once-per-order crediting) is what these tests hold still.
 */
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { MAX_AUTOMATIC_ATTEMPTS, retryStoredWebhookEvents } from "../../src/services/webhookInbox.service.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, waitFor } from "../support/db";
import { newOrderId, orderCreatedEvent, signedBody } from "../support/lemon";
import { everythingLogged, payloadOf, raiseOnPoolQuery, rejectPoolQuery } from "../support/marked-errors";

const MARKER = "SENSITIVE-INBOX-MARKER-5d21";
const FULFILMENT_QUERY = /FROM users WHERE id/;

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
});

function deliver(event: unknown) {
  const { raw, signature } = signedBody(event);
  return request(app).post("/api/billing/webhooks/lemonsqueezy").set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
}
const stored = async (orderId: string) =>
  (await db.query<{ id: string; status: string; attempts: number; outcome: string | null; last_error: string | null }>(
    `SELECT id::text, status, attempts, outcome, last_error FROM lemon_webhook_events WHERE provider_order_id = $1`,
    [orderId],
  )).rows;
const age = (orderId: string) => db.query(`UPDATE lemon_webhook_events SET received_at = NOW() - INTERVAL '11 minutes' WHERE provider_order_id = $1`, [orderId]);

/** Deliver one purchase with fulfilment failing as `fail()` arranges, and wait until the failure is recorded. */
async function failedDelivery(fail: () => { mockRestore(): void }) {
  const buyer = await createUser(db);
  const orderId = newOrderId();
  const broken = fail();
  try {
    expect((await deliver(orderCreatedEvent({ orderId, customData: { user_id: buyer.id, package_id: "starter" } }))).status).toBe(200);
    await waitFor(async () => (await stored(orderId))[0]?.status === "failed");
    await logs.waitForLine("Processing failed");
  } finally {
    broken.mockRestore();
  }
  return { buyer, orderId };
}

describe("a real database error during fulfilment", () => {
  it("nothing of its message, DETAIL or HINT is stored or logged; a fixed description and the identifiers remain", async () => {
    const { buyer, orderId } = await failedDelivery(() => raiseOnPoolQuery(FULFILMENT_QUERY, MARKER));

    const [row] = await stored(orderId);
    expect(row!.last_error).not.toContain(MARKER);
    expect(row!.last_error).toBe("Database error (SQLSTATE XX000)");
    expect(row).toMatchObject({ status: "failed", attempts: 1, outcome: null });

    expect(everythingLogged(logs)).not.toContain(MARKER);
    expect(payloadOf(logs, "Processing failed")).toMatchObject({
      storedEventId: row!.id,
      orderId,
      attempt: 1,
      error: "Database error (SQLSTATE XX000)",
      sqlstate: "XX000",
      severity: "ERROR",
    });
    expect(await balanceOf(db, buyer.id)).toBe(0);
  });

  it("the retry is unchanged: not within the grace, then processed, last_error cleared, credited exactly once", async () => {
    const { buyer, orderId } = await failedDelivery(() => raiseOnPoolQuery(FULFILMENT_QUERY, MARKER));

    await retryStoredWebhookEvents();
    expect((await stored(orderId))[0]).toMatchObject({ status: "failed", attempts: 1 });

    await age(orderId);
    await retryStoredWebhookEvents();
    expect((await stored(orderId))[0]).toMatchObject({ status: "processed", attempts: 2, outcome: "credited", last_error: null });
    expect(await balanceOf(db, buyer.id)).toBe(50);
    expect(await ledgerOf(db, buyer.id)).toHaveLength(1);
  });

  it(`after ${MAX_AUTOMATIC_ATTEMPTS} attempts: the same give-up alert, without the text; the worker stops and the replay still credits`, async () => {
    const { buyer, orderId } = await failedDelivery(() => raiseOnPoolQuery(FULFILMENT_QUERY, MARKER));
    await db.query(`UPDATE lemon_webhook_events SET attempts = $2 WHERE provider_order_id = $1`, [orderId, MAX_AUTOMATIC_ATTEMPTS - 1]);
    await age(orderId);

    const broken = raiseOnPoolQuery(FULFILMENT_QUERY, MARKER);
    try {
      await retryStoredWebhookEvents();
    } finally {
      broken.mockRestore();
    }
    await logs.waitForLine("FAILED background credit allocation");
    expect((await stored(orderId))[0]).toMatchObject({ status: "failed", attempts: MAX_AUTOMATIC_ATTEMPTS, last_error: "Database error (SQLSTATE XX000)" });
    expect(payloadOf(logs, "FAILED background credit allocation")).toMatchObject({ orderId, attempt: MAX_AUTOMATIC_ATTEMPTS, sqlstate: "XX000" });
    expect(everythingLogged(logs)).not.toContain(MARKER);

    expect(await retryStoredWebhookEvents()).toEqual({ processed: 0, failed: 0, skipped: 0 });
    await retryStoredWebhookEvents({ all: true });
    expect((await stored(orderId))[0]).toMatchObject({ status: "processed", outcome: "credited", last_error: null });
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });
});

describe("other failures", () => {
  it("a socket error, whose message names the host: the operator's fixed hint is stored, the message is not", async () => {
    const { orderId } = await failedDelivery(() =>
      rejectPoolQuery(FULFILMENT_QUERY, () => Object.assign(new Error(`connect ECONNREFUSED ${MARKER}:5432`), { code: "ECONNREFUSED", syscall: "connect" })),
    );
    const [row] = await stored(orderId);
    expect(row!.last_error).toBe("PostgreSQL is not running or not listening on the configured host:port.");
    expect(payloadOf(logs, "Processing failed")).toMatchObject({ sqlstate: "ECONNREFUSED", syscall: "connect", reason: "connect_socket_error" });
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("a known driver message stays as its fixed text, even when more text comes with it", async () => {
    const { orderId } = await failedDelivery(() => rejectPoolQuery(FULFILMENT_QUERY, () => new Error(`timeout exceeded when trying to connect ${MARKER}`)));
    expect((await stored(orderId))[0]!.last_error).toBe("timeout exceeded when trying to connect");
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("a bug, not a database error: its type is stored, and the frames that locate it are logged without its message", async () => {
    const { orderId } = await failedDelivery(() => rejectPoolQuery(FULFILMENT_QUERY, () => new TypeError(`${MARKER} first line\n    at ${MARKER} (fake.ts:1:1)`)));
    expect((await stored(orderId))[0]!.last_error).toBe("Unexpected error (TypeError)");
    const payload = payloadOf(logs, "Processing failed");
    expect(payload).toMatchObject({ errorName: "TypeError", sqlstate: null });
    expect((payload.stack as string[]).length).toBeGreaterThan(0);
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("something thrown that is not an Error: nothing of its content", async () => {
    const { orderId } = await failedDelivery(() => rejectPoolQuery(FULFILMENT_QUERY, () => `${MARKER} a thrown string`));
    expect((await stored(orderId))[0]!.last_error).toBe("Unexpected error (string)");
    expect(everythingLogged(logs)).not.toContain(MARKER);
  });

  it("the service's own messages keep their wording: a stored body that is not JSON, and a missing payload", async () => {
    const notJson = newOrderId();
    const noPayload = newOrderId();
    await db.query(`INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status) VALUES (sha256(convert_to($1, 'UTF8')), 'order_created', $2, $1, 'failed')`, [`not json ${MARKER} ${notJson}`, notJson]);
    await db.query(`INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status) VALUES (sha256(convert_to($1, 'UTF8')), 'order_created', $1, NULL, 'pending')`, [noPayload]);

    await retryStoredWebhookEvents({ all: true });

    expect((await stored(notJson))[0]).toMatchObject({ status: "failed", attempts: 1, last_error: "Invalid Lemon Squeezy webhook JSON." });
    expect((await stored(noPayload))[0]).toMatchObject({ status: "failed", attempts: 1, last_error: "stored payload is missing" });
    expect(everythingLogged(logs)).not.toContain(MARKER);
    await db.query(`DELETE FROM lemon_webhook_events WHERE provider_order_id = ANY($1)`, [[notJson, noPayload]]);
  });
});
