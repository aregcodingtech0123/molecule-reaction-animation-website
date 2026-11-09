/**
 * Phase 2C step 4: the two background workers in src/index.ts live only in the entry point, so the real process is what runs here.
 *
 * Real server errors without touching what parallel suites share: a schema of its own holds an erroring function and view under
 * the names the workers use, and only this child has it first in its search_path. The workers' SQL is unchanged and unqualified.
 */
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestPool } from "../support/db";
import { DEVELOPMENT_VARS, startService, strongSecret } from "../support/service-process";

const MARKER = "SENSITIVE-DB-MARKER-92ab";
const SCHEMA = `step4_worker_fault_${randomBytes(4).toString("hex")}`;
const RAISE = `RAISE EXCEPTION '${MARKER} in message' USING ERRCODE = 'XX000', DETAIL = '${MARKER} in detail', HINT = '${MARKER} in hint';`;

let db: pg.Pool;
beforeAll(async () => {
  db = createTestPool();
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(`CREATE FUNCTION ${SCHEMA}.release_expired_ai_holds() RETURNS int LANGUAGE plpgsql AS $$ BEGIN ${RAISE} END $$`);
  await db.query(`CREATE FUNCTION ${SCHEMA}.fault() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN ${RAISE} END $$`);
  // The fault is in a column the worker's WHERE reads. In a view's own WHERE, a constant `status` lets the planner fold the
  // worker's filter to false, and the fault would never run.
  await db.query(`CREATE VIEW ${SCHEMA}.lemon_webhook_events AS SELECT gen_random_uuid() AS id, CASE WHEN ${SCHEMA}.fault() THEN 'pending'::text END AS status, 0 AS attempts, now() AS received_at, now() AS claimed_at`);
});
afterAll(async () => {
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await db.end();
});

function urlWithFaultSchema(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${SCHEMA},public`);
  return url.toString();
}

describe("the background workers log a real server error without its text", () => {
  it("the expired-hold sweeper and the stored-webhook retry: the labels and the SQLSTATE stay, and the workers keep running", async () => {
    const svc = await startService({
      ...DEVELOPMENT_VARS,
      SETTLEMENT_CAPABILITY_SECRET: strongSecret(),
      DATABASE_URL: urlWithFaultSchema(),
      AI_HOLD_SWEEP_INTERVAL_MS: "100",
      WEBHOOK_RETRY_INTERVAL_MS: "100",
    });
    try {
      expect((await svc.firstHealth())?.status, svc.output()).toBe(200);
      await svc.waitForOutput(/Expired-hold sweep failed[\s\S]*Expired-hold sweep failed/);
      await svc.waitForOutput(/Stored-event retry failed[\s\S]*Stored-event retry failed/);
    } finally {
      await svc.stop();
    }
    const output = svc.output();
    expect(output).not.toContain(MARKER);
    expect(output).toMatch(/Expired-hold sweep failed:?\s*\{[^}]*sqlstate: 'XX000'/);
    expect(output).toMatch(/Stored-event retry failed:?\s*\{[^}]*sqlstate: 'XX000'/);
  }, 60_000);
});
