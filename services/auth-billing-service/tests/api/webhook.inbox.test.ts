/**
 * R19: the durable webhook inbox (migration 015, src/services/webhookInbox.service.ts). A delivery that was
 * acknowledged is never lost: processing that fails after storing is recorded and retried, a process that died
 * mid-way is taken over, `webhooks:replay` processes whatever is left, and crediting stays once per order.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import {
  MAX_AUTOMATIC_ATTEMPTS,
  clearOldWebhookPayloads,
  retryStoredWebhookEvents,
} from "../../src/services/webhookInbox.service.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { balanceOf, createTestPool, createUser, ledgerOf, waitFor } from "../support/db";
import { newOrderId, orderCreatedEvent, signedBody } from "../support/lemon";

const WEBHOOK = "/api/billing/webhooks/lemonsqueezy";
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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

async function deliver(event: unknown) {
  const { raw, signature } = signedBody(event);
  return request(app).post(WEBHOOK).set("Content-Type", "application/json").set("X-Signature", signature).send(raw);
}

const stored = async (orderId: string) =>
  (await db.query<{ id: string; status: string; attempts: number; outcome: string | null; last_error: string | null }>(
    `SELECT id::text, status, attempts, outcome, last_error FROM lemon_webhook_events WHERE provider_order_id = $1 ORDER BY id`,
    [orderId],
  )).rows;

/** Pool queries matching `pattern` fail (as if the database dropped them); everything else runs. */
function failQueries(pattern: RegExp) {
  const real = pg.Pool.prototype.query;
  return vi.spyOn(pg.Pool.prototype, "query").mockImplementation(function (this: pg.Pool, ...args: unknown[]) {
    const sql = typeof args[0] === "string" ? args[0] : "";
    if (pattern.test(sql)) return Promise.reject(new Error("timeout exceeded when trying to connect")) as never;
    return (real as (...a: unknown[]) => unknown).apply(this, args) as never;
  });
}

/** Make a stored event look older than the worker's 30 s grace (and any claim stale). */
const age = (orderId: string) =>
  db.query(
    `UPDATE lemon_webhook_events SET received_at = NOW() - INTERVAL '11 minutes',
       claimed_at = CASE WHEN claimed_at IS NULL THEN NULL ELSE NOW() - INTERVAL '11 minutes' END
     WHERE provider_order_id = $1`,
    [orderId],
  );

describe("webhook inbox (R19)", () => {
  it("processing that fails after the 200 is recorded, retried by the worker and credited exactly once", async () => {
    const buyer = await createUser(db);
    const orderId = newOrderId();
    const broken = failQueries(/FROM users WHERE id/); // fulfilment's first query
    try {
      expect((await deliver(orderCreatedEvent({ orderId, customData: { user_id: buyer.id, package_id: "starter" } }))).status).toBe(200);
      await logs.waitForLine(/Processing failed — the event is stored and will be retried \(attempt 1 of 10\)/);
    } finally {
      broken.mockRestore();
    }
    expect(await stored(orderId)).toEqual([
      expect.objectContaining({ status: "failed", attempts: 1, last_error: "timeout exceeded when trying to connect" }),
    ]);
    expect(await balanceOf(db, buyer.id)).toBe(0);

    // Not yet: the worker leaves events younger than its grace period to the immediate processing.
    await retryStoredWebhookEvents();
    expect((await stored(orderId))[0]!.status).toBe("failed");
    await age(orderId);
    await retryStoredWebhookEvents();
    expect(await stored(orderId)).toEqual([expect.objectContaining({ status: "processed", attempts: 2, outcome: "credited", last_error: null })]);
    expect(await balanceOf(db, buyer.id)).toBe(50);

    // A second pass finds nothing to do.
    await age(orderId);
    expect(await retryStoredWebhookEvents()).toEqual({ processed: 0, failed: 0, skipped: 0 });
    expect(await ledgerOf(db, buyer.id)).toHaveLength(1);
  });

  it(`after ${MAX_AUTOMATIC_ATTEMPTS} failed attempts the worker gives up with the FAILED alert; webhooks:replay still processes it`, async () => {
    const buyer = await createUser(db);
    const orderId = newOrderId();
    const broken = failQueries(/FROM users WHERE id/);
    try {
      expect((await deliver(orderCreatedEvent({ orderId, customData: { user_id: buyer.id, package_id: "starter" } }))).status).toBe(200);
      await waitFor(async () => (await stored(orderId))[0]?.status === "failed");
      await db.query(`UPDATE lemon_webhook_events SET attempts = $2 WHERE provider_order_id = $1`, [orderId, MAX_AUTOMATIC_ATTEMPTS - 1]);
      await age(orderId);
      await retryStoredWebhookEvents();
      await logs.waitForLine(new RegExp(`FAILED background credit allocation — stored event gave up after ${MAX_AUTOMATIC_ATTEMPTS} attempts`));
    } finally {
      broken.mockRestore();
    }
    // The worker no longer touches it…
    expect(await retryStoredWebhookEvents()).toEqual({ processed: 0, failed: 0, skipped: 0 });
    expect(await balanceOf(db, buyer.id)).toBe(0);
    // …the replay does (no attempt limit, no grace period).
    await retryStoredWebhookEvents({ all: true });
    expect(await stored(orderId)).toEqual([expect.objectContaining({ status: "processed", outcome: "credited" })]);
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });

  it("an event claimed by a process that died is taken over after 10 minutes, never sooner", async () => {
    const buyer = await createUser(db);
    const orderId = newOrderId();
    const { raw } = signedBody(orderCreatedEvent({ orderId, customData: { user_id: buyer.id, package_id: "starter" } }));
    await db.query(
      `INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status, attempts, received_at, claimed_at)
       VALUES (sha256(convert_to($1, 'UTF8')), 'order_created', $2, $1, 'processing', 1, NOW() - INTERVAL '1 minute', NOW() - INTERVAL '1 minute')`,
      [raw, orderId],
    );
    await retryStoredWebhookEvents({ all: true });
    expect((await stored(orderId))[0]!.status).toBe("processing"); // a live claim is left alone, even by the replay
    await age(orderId);
    await retryStoredWebhookEvents();
    expect(await stored(orderId)).toEqual([expect.objectContaining({ status: "processed", attempts: 2, outcome: "credited" })]);
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });

  it("the database fails right after the INSERT (the claim itself): still 200, the stored event is retried later", async () => {
    const buyer = await createUser(db);
    const orderId = newOrderId();
    const broken = failQueries(/SET status = 'processing'/);
    try {
      expect((await deliver(orderCreatedEvent({ orderId, customData: { user_id: buyer.id, package_id: "starter" } }))).status).toBe(200);
      await logs.waitForLine(/Processing deferred — the event is stored and will be retried/);
    } finally {
      broken.mockRestore();
    }
    expect(await stored(orderId)).toEqual([expect.objectContaining({ status: "pending", attempts: 0 })]);
    await age(orderId);
    await retryStoredWebhookEvents();
    expect(await stored(orderId)).toEqual([expect.objectContaining({ status: "processed", attempts: 1, outcome: "credited" })]);
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });

  it("a stored event without its payload cannot be processed: it fails with a clear error instead of being dropped", async () => {
    const orderId = newOrderId();
    await db.query(
      `INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status)
       VALUES (sha256(convert_to($1, 'UTF8')), 'order_created', $1, NULL, 'pending')`,
      [orderId],
    );
    await retryStoredWebhookEvents({ all: true });
    expect(await stored(orderId)).toEqual([expect.objectContaining({ status: "failed", attempts: 1, last_error: "stored payload is missing" })]);
    await db.query(`DELETE FROM lemon_webhook_events WHERE provider_order_id = $1`, [orderId]);
  });

  it("two identical deliveries at the same time: one stored event, credited once", async () => {
    const buyer = await createUser(db);
    const orderId = newOrderId();
    const event = orderCreatedEvent({ orderId, customData: { user_id: buyer.id, package_id: "starter" } });
    const responses = await Promise.all([deliver(event), deliver(event)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    await waitFor(async () => (await stored(orderId))[0]?.status === "processed");
    expect(await stored(orderId)).toHaveLength(1);
    expect(await balanceOf(db, buyer.id)).toBe(50);
    expect(await ledgerOf(db, buyer.id)).toHaveLength(1);
  });

  it("the payload (buyer e-mail) is cleared 30 days after processing; unfinished events keep theirs", async () => {
    const orderId = newOrderId();
    const insert = (hash: string, status: string, processedDaysAgo: number | null) =>
      db.query(
        `INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status, processed_at)
         VALUES (decode($1, 'hex'), 'order_created', $2, '{"user_email":"x@example.test"}', $3,
                 CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() - make_interval(days => $4::int) END)`,
        [hash, orderId, status, processedDaysAgo],
      );
    const suffix = orderId.padStart(8, "0");
    await insert(`a1${suffix}`, "processed", 31);
    await insert(`a2${suffix}`, "processed", 29);
    await insert(`a3${suffix}`, "failed", null);
    expect(await clearOldWebhookPayloads()).toBeGreaterThanOrEqual(1);
    const { rows } = await db.query(
      `SELECT status, payload IS NULL AS cleared FROM lemon_webhook_events WHERE provider_order_id = $1 ORDER BY id`,
      [orderId],
    );
    expect(rows).toEqual([
      { status: "processed", cleared: true },
      { status: "processed", cleared: false },
      { status: "failed", cleared: false },
    ]);
  });
});

describe("npm run webhooks:replay (src/scripts/replayWebhooks.ts)", () => {
  /** The replay entry point, with the test environment and never the developer's real .env. */
  function replay() {
    const noDotenv = pathToFileURL(path.join(serviceRoot, "../../scripts/test/no-dotenv.mjs")).href;
    const res = spawnSync(process.execPath, ["--import", "tsx", "--import", noDotenv, path.join(serviceRoot, "src/scripts/replayWebhooks.ts")], {
      cwd: serviceRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: "test" },
    });
    return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
  }

  it("processes stored events that are not done and exits 0; exits 2 while one still fails", async () => {
    const buyer = await createUser(db);
    const orderId = newOrderId();
    const insert = (body: string) =>
      db.query(
        `INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status, attempts, last_error)
         VALUES (sha256(convert_to($1, 'UTF8')), 'order_created', $2, $1, 'failed', $3, 'earlier failure')`,
        [body, orderId, MAX_AUTOMATIC_ATTEMPTS],
      );
    await insert(signedBody(orderCreatedEvent({ orderId, customData: { user_id: buyer.id, package_id: "starter" } })).raw);
    const ok = replay();
    expect(ok.out).toMatch(/\[webhooks:replay\] \d+ processed, 0 still failing/);
    expect(ok.code).toBe(0);
    expect(await stored(orderId)).toEqual([expect.objectContaining({ status: "processed", outcome: "credited" })]);
    expect(await balanceOf(db, buyer.id)).toBe(50);

    // A stored event that cannot be processed (its payload is not JSON) keeps failing: exit 2.
    const bad = newOrderId();
    await db.query(
      `INSERT INTO lemon_webhook_events (body_sha256, event_name, provider_order_id, payload, status)
       VALUES (sha256(convert_to($1, 'UTF8')), 'order_created', $2, $1, 'failed')`,
      [`not json ${bad}`, bad],
    );
    const failing = replay();
    expect(failing.code).toBe(2);
    expect(failing.out).toMatch(/[1-9]\d* still failing/);
    expect(await stored(bad)).toEqual([expect.objectContaining({ status: "failed", last_error: "Invalid Lemon Squeezy webhook JSON." })]);
    await db.query(`DELETE FROM lemon_webhook_events WHERE provider_order_id = $1`, [bad]);
  });
});
