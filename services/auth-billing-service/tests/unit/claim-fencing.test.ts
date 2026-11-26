/**
 * F-5 (owner decision, contract 15.9): both consumers fence their result with the `attempts` value their own claim produced.
 * A small in-memory model of ONE inbox row stands in for the database: it applies the claim (status -> processing, attempts + 1)
 * and accepts a result update only when status is 'processing' and attempts equals the token, like the SQL predicate. It proves
 * how the application uses the token in every interleaving the test drives; it does NOT prove PostgreSQL row locking, statement
 * atomicity or concurrent execution (DB campaign FZ-1, C-T2).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spyConsole, type ConsoleSpies } from "../support/console";

interface Call {
  sql: string;
  params: unknown[];
}
const db = vi.hoisted(() => ({
  handle: ((): { rows: unknown[]; rowCount: number } => ({ rows: [], rowCount: 0 })) as (call: { sql: string; params: unknown[] }) => {
    rows: unknown[];
    rowCount: number;
  },
}));
vi.mock("../../src/db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/index.js")>()),
  pool: { query: async (sql: string, params: unknown[] = []) => db.handle({ sql, params }) },
}));

const { processStoredWebhookEvent, retryStoredWebhookEvents, MAX_AUTOMATIC_ATTEMPTS } = await import("../../src/services/webhookInbox.service.js");
const { consumeIngestedEvent, consumeIngestedWebhookEvents, resetConsumerReadiness } = await import("../../src/services/v8Consumer.service.js");
const { resetInboxProvenanceCache } = await import("../../src/services/inboxProvenance.service.js");

const READY = { table_present: true, columns_found: 14, guard_triggers: 2, policy_present: true, can_read_policy: true, credit_fn: true, can_credit: true, clear_fn: true, can_clear: true };
const IGNORED = JSON.stringify({ meta: { event_name: "subscription_created" }, data: { id: "1", attributes: {} } });
const BROKEN = "{ not json";

interface Row {
  status: string;
  attempts: number;
  stale: boolean;
}
let row: Row;
let calls: Call[];
let payload: string;
/** Runs just before a result update is applied: lets a test make another worker take the row in between. */
let beforeResult: (() => void) | null;
let logs: ConsoleSpies;
const result = (...rows: unknown[]) => ({ rows, rowCount: rows.length });

beforeEach(() => {
  resetInboxProvenanceCache();
  resetConsumerReadiness();
  logs = spyConsole();
  calls = [];
  payload = IGNORED;
  beforeResult = null;
  row = { status: "pending", attempts: 0, stale: false };
  db.handle = (call) => {
    calls.push(call);
    if (/AS columns_found/.test(call.sql)) return result(READY); // before the provenance probe: both select `AS table_present`
    if (/AS table_present/.test(call.sql)) return result({ table_present: true, has_ingested_by: true });
    if (/SELECT id::text FROM lemon_webhook_events/.test(call.sql)) return result({ id: "7" });
    if (/SET status = 'processing', attempts = attempts \+ 1/.test(call.sql)) {
      const claimable = row.status === "pending" || row.status === "failed" || (row.status === "processing" && row.stale);
      if (!claimable) return result();
      row = { status: "processing", attempts: row.attempts + 1, stale: false };
      return result({ payload, attempts: row.attempts, provider_order_id: "1", event_name: "subscription_created", eligible: false });
    }
    const finish = /SET status = '(processed|failed)'/.exec(call.sql);
    if (finish) {
      beforeResult?.();
      beforeResult = null;
      if (!/AND status = 'processing' AND attempts = \$3::int/.test(call.sql)) throw new Error("unfenced result update");
      if (row.status !== "processing" || row.attempts !== call.params[2]) return result();
      row = { ...row, status: finish[1]! };
      return result({});
    }
    return result();
  };
});

/** Another worker reclaims the row as stale: a new claim, attempts + 1. */
const anotherWorkerReclaims = () => {
  row = { status: "processing", attempts: row.attempts + 1, stale: false };
};

const PATHS: Array<[string, (id: string) => Promise<string>]> = [
  ["legacy consumer", processStoredWebhookEvent],
  ["V8 consumer", consumeIngestedEvent],
];

describe.each(PATHS)("%s", (_name, consumeOne) => {
  it("the initial claim increments attempts and that value is the token of the result update", async () => {
    expect(await consumeOne("7")).toBe("processed");
    const done = calls.find((c) => /SET status = 'processed'/.test(c.sql))!;
    expect(done.params[2]).toBe(1);
    expect(row).toMatchObject({ status: "processed", attempts: 1 });
  });

  it("a stale claimant cannot overwrite a newer claim on the success path", async () => {
    beforeResult = anotherWorkerReclaims;
    expect(await consumeOne("7")).toBe("skipped");
    expect(row).toEqual({ status: "processing", attempts: 2, stale: false }); // the newer claim is intact
    expect(logs.lines().join("\n")).toMatch(/Claim lost before the result was recorded/);
  });

  it("a stale claimant cannot overwrite a newer claim on the failure path", async () => {
    payload = BROKEN;
    beforeResult = anotherWorkerReclaims;
    expect(await consumeOne("7")).toBe("skipped");
    expect(row).toEqual({ status: "processing", attempts: 2, stale: false });
    expect(logs.lines().join("\n")).toMatch(/Claim lost before the failure was recorded/);
  });

  it("the newer claimant finishes with its own token", async () => {
    beforeResult = anotherWorkerReclaims;
    await consumeOne("7"); // the old claimant loses
    row.stale = true; // later the newer claim is itself reclaimed and finished by a third worker
    expect(await consumeOne("7")).toBe("processed");
    expect(row).toMatchObject({ status: "processed", attempts: 3 });
  });

  it("an ordinary failure is recorded with the claimant's token and stays retryable", async () => {
    payload = BROKEN;
    expect(await consumeOne("7")).toBe("failed");
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(await consumeOne("7")).toBe("failed");
    expect(row.attempts).toBe(2);
  });

  it("a token is never reused: every claim yields a larger attempts value", async () => {
    payload = BROKEN;
    const tokens: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      await consumeOne("7");
      tokens.push(calls.filter((c) => /SET status = 'failed'/.test(c.sql)).at(-1)!.params[2]);
    }
    expect(tokens).toEqual([1, 2, 3, 4]);
  });
});

describe("both consumers apply the same fencing rule", () => {
  const fence = (sql: string) => sql.replace(/\s+/g, " ").match(/WHERE id = \$1 AND status = 'processing' AND attempts = \$3::int/)?.[0];

  it("identical WHERE clause on success and failure in both consumers, and no claimed_at token anywhere", async () => {
    await processStoredWebhookEvent("7");
    row = { status: "pending", attempts: 0, stale: false };
    await consumeIngestedEvent("7");
    payload = BROKEN;
    row = { status: "pending", attempts: 0, stale: false };
    await processStoredWebhookEvent("7");
    row = { status: "pending", attempts: 0, stale: false };
    await consumeIngestedEvent("7");
    const results = calls.filter((c) => /SET status = '(processed|failed)'/.test(c.sql));
    expect(results).toHaveLength(4);
    expect(new Set(results.map((c) => fence(c.sql)))).toEqual(new Set(["WHERE id = $1 AND status = 'processing' AND attempts = $3::int"]));
    expect(results.some((c) => /claimed_at = \$/.test(c.sql))).toBe(false);
  });
});

describe("replay and retry keep the fencing and the attempt policy", () => {
  it("the legacy replay (all: true) and the V8 replay go through the same fenced claim", async () => {
    await retryStoredWebhookEvents({ all: true });
    row = { status: "pending", attempts: 0, stale: false };
    await consumeIngestedWebhookEvents({ all: true });
    const results = calls.filter((c) => /SET status = 'processed'/.test(c.sql));
    expect(results).toHaveLength(2);
    for (const c of results) expect(c.sql).toMatch(/AND attempts = \$3::int/);
  });

  it("the automatic selections still pass the unchanged attempt limit (10); the replay ignores it", async () => {
    await retryStoredWebhookEvents();
    await consumeIngestedWebhookEvents();
    await retryStoredWebhookEvents({ all: true });
    const selects = calls.filter((c) => /SELECT id::text FROM lemon_webhook_events/.test(c.sql));
    expect(MAX_AUTOMATIC_ATTEMPTS).toBe(10);
    expect(selects.map((c) => c.params.slice(0, 2))).toEqual([
      [false, 10],
      [false, 10],
      [true, 10],
    ]);
  });
});
