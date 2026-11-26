/**
 * The V8 consumer (contract 5.2, P4.2, X3, Q7, Q-T3, I-6 ii) over a scripted database. Proves which statements run and how each
 * outcome and error is recorded; it does NOT prove the SQL, credit_verified_purchase or PostgreSQL behaviour (DB campaign).
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { orderCreatedEvent } from "../support/lemon";

interface Call {
  sql: string;
  params: unknown[];
}

const db = vi.hoisted(() => ({
  handle: ((): { rows: unknown[]; rowCount: number } => ({ rows: [], rowCount: 0 })) as (call: { sql: string; params: unknown[] }) => { rows: unknown[]; rowCount: number },
}));

vi.mock("../../src/db/index.js", async (importOriginal) => {
  const run = async (sql: string, params: unknown[] = []) => db.handle({ sql, params });
  return {
    ...(await importOriginal<typeof import("../../src/db/index.js")>()),
    pool: { query: run },
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => fn({ query: run }),
  };
});

const receipts = vi.hoisted(() => ({ queue: vi.fn() }));
vi.mock("../../src/services/webhook.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/webhook.service.js")>()),
  queuePurchaseReceipt: receipts.queue,
}));

const {
  CLEANUP_INTERVAL_MS,
  POLICY_INCOMPLETE_LOG_CODE,
  V8_READINESS_SQL,
  checkConsumerReadiness,
  clearPayloadsThroughFunction,
  consumeIngestedEvent,
  consumeIngestedWebhookEvents,
  consumerReadinessProblems,
  getConsumerReadiness,
  resetConsumerReadiness,
  throttled,
} = await import("../../src/services/v8Consumer.service.js");
const READY = { table_present: true, columns_found: 14, guard_triggers: 2, policy_present: true, can_read_policy: true, credit_fn: true, can_credit: true, clear_fn: true, can_clear: true };

const USER = randomUUID();
let calls: Call[];
let claim: Record<string, unknown> | null;
let fn: Record<string, unknown> | (() => never);
let override: (call: Call) => { rows: unknown[]; rowCount: number } | undefined;
let logs: ConsoleSpies;
const result = (...rows: unknown[]) => ({ rows, rowCount: rows.length });

const payloadOf = (attrs: Record<string, unknown> = {}, eventName = "order_created") => {
  const e = structuredClone(orderCreatedEvent({ eventName, customData: { user_id: USER } }));
  Object.assign(e.data.attributes as Record<string, unknown>, { test_mode: false, ...attrs });
  return JSON.stringify(e);
};
const claimed = (over: Record<string, unknown> = {}) => ({
  event_name: "order_created",
  eligible: true,
  payload: payloadOf(),
  attempts: 1,
  provider_order_id: "4242",
  order_total_cents: 500,
  order_currency: "USD",
  ...over,
});

beforeEach(() => {
  resetConsumerReadiness();
  receipts.queue.mockClear();
  calls = [];
  claim = claimed();
  fn = { o_outcome: "credited", o_ledger_id: "41", o_user_id: USER, o_credits: 50 };
  override = () => undefined;
  logs = spyConsole();
  db.handle = (call) => {
    calls.push(call);
    const o = override(call);
    if (o) return o;
    if (/SET status = '(processed|failed)'/.test(call.sql)) return result({}); // the claimant still holds the claim: one row updated
    if (/AS columns_found/.test(call.sql)) return result(READY);
    if (/FROM ledger_policy WHERE singleton/.test(call.sql)) return result({ lemon_store_id: "11111", allow_test_mode: false });
    if (/SET status = 'processing'/.test(call.sql)) return claim ? result(claim) : result();
    if (/FROM credit_verified_purchase\(\$1\)/.test(call.sql)) {
      if (typeof fn === "function") fn();
      return result(fn);
    }
    if (/INSERT INTO lemon_order_refunds/.test(call.sql)) return result({});
    return result();
  };
});

const processedWith = () => calls.find((c) => /SET status = 'processed'/.test(c.sql))?.params[1];
const failedWith = () => calls.find((c) => /SET status = 'failed'/.test(c.sql))?.params[1];
const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error("server text user@example.test"), { severity: "ERROR", code, ...extra });

describe("eligible order_created: only credit_verified_purchase decides", () => {
  it.each(["credited", "already_processed", "missing_user", "unresolved_package", "amount_mismatch", "store_mismatch", "test_mode_order", "currency_mismatch"])(
    "outcome %s → processed with that label",
    async (outcome) => {
      fn = { o_outcome: outcome, o_ledger_id: null, o_user_id: null, o_credits: null };
      expect(await consumeIngestedEvent("7")).toBe("processed");
      expect(processedWith()).toBe(outcome);
      expect(calls.find((c) => /credit_verified_purchase/.test(c.sql))!.params).toEqual(["7"]);
    },
  );

  it("the function is the only credit path: no ledger statement and no post_credit_transaction from the consumer", async () => {
    await consumeIngestedEvent("7");
    expect(calls.filter((c) => /post_credit_transaction|INSERT INTO credit_ledger|FROM credit_ledger_transactions/.test(c.sql))).toEqual([]);
  });

  it("policy_incomplete stays failed and counted, with its own log code (Q7)", async () => {
    fn = { o_outcome: "policy_incomplete", o_ledger_id: null, o_user_id: null, o_credits: null };
    expect(await consumeIngestedEvent("7")).toBe("failed");
    expect(failedWith()).toMatch(/^policy_incomplete/);
    expect(processedWith()).toBeUndefined();
    expect(logs.lines().join("\n")).toContain(POLICY_INCOMPLETE_LOG_CODE);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["MS001", {}, "review:historical_credit_ambiguous"],
    ["MS002", {}, "review:blocked_by_review_decision"],
    ["MS003", {}, "review:refund_before_credit"],
    ["23505", { constraint: "uq_credit_ledger_provider_reference" }, "retry:ledger_reference_race"],
  ])("%s from the function → failed with %s, never server text", async (code, extra, lastError) => {
    fn = () => {
      throw pgError(code, extra);
    };
    expect(await consumeIngestedEvent("7")).toBe("failed");
    expect(failedWith()).toBe(lastError);
    expect(logs.lines().join("\n")).not.toContain("user@example.test");
  });

  it("42501 (trust failure or missing grant) → failed with the fixed hint", async () => {
    fn = () => {
      throw pgError("42501");
    };
    await consumeIngestedEvent("7");
    expect(failedWith()).toBe("Permission denied for the database or schema.");
  });

  it("an unknown outcome is never recorded as processed", async () => {
    fn = { o_outcome: "something_new", o_ledger_id: null, o_user_id: null, o_credits: null };
    expect(await consumeIngestedEvent("7")).toBe("failed");
    expect(processedWith()).toBeUndefined();
  });
});

describe("not eligible: labels from the shared state reader (N-2)", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["paid but not verified at ingest", {}, "not_eligible"],
    ["pending", { status: "pending" }, "order_not_paid"],
    ["confirmed full refund", { status: "refunded", refunded: true, refunded_amount: 500 }, "order_refunded"],
  ])("%s → processed %s, the function is not called", async (_l, attrs, label) => {
    claim = claimed({ eligible: false, payload: payloadOf(attrs) });
    expect(await consumeIngestedEvent("7")).toBe("processed");
    expect(processedWith()).toBe(label);
    expect(calls.some((c) => /credit_verified_purchase/.test(c.sql))).toBe(false);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["partial refund", { status: "partial_refund", refunded: false, refunded_amount: 100 }, "review:partial_refund"],
    ["fraudulent", { status: "fraudulent" }, "review:fraudulent_status"],
    ["paid flagged refunded", { refunded: true }, "review:payment_state_unknown"],
  ])("%s → review stop %s", async (_l, attrs, description) => {
    claim = claimed({ eligible: false, payload: payloadOf(attrs) });
    expect(await consumeIngestedEvent("7")).toBe("failed");
    expect(failedWith()).toBe(description);
  });
});

describe("other events, payload_cleared, claims and passes", () => {
  it("order_refunded goes to the refund recorder", async () => {
    claim = claimed({ event_name: "order_refunded", eligible: false, payload: payloadOf({ status: "refunded", refunded: true, refunded_amount: 500 }, "order_refunded") });
    expect(await consumeIngestedEvent("7")).toBe("processed");
    expect(processedWith()).toBe("refund_recorded");
    expect(calls.some((c) => /INSERT INTO lemon_order_refunds/.test(c.sql))).toBe(true);
  });

  it("another event is processed as ignored", async () => {
    claim = claimed({ event_name: "subscription_created", eligible: false });
    await consumeIngestedEvent("7");
    expect(processedWith()).toBe("ignored_event_type");
  });

  it("a claimed event whose payload was cleared becomes review:payload_cleared, even when eligible; nothing is credited", async () => {
    claim = claimed({ payload: null });
    expect(await consumeIngestedEvent("7")).toBe("failed");
    expect(failedWith()).toBe("review:payload_cleared");
    expect(calls.some((c) => /credit_verified_purchase/.test(c.sql))).toBe(false);
  });

  it("not claimable → skipped, nothing else runs", async () => {
    claim = null;
    expect(await consumeIngestedEvent("7")).toBe("skipped");
    expect(calls).toHaveLength(1);
  });

  it("the claim takes only ingested rows and skips review stops and closed events (SQL text; semantics need PostgreSQL)", async () => {
    await consumeIngestedEvent("7");
    const sql = calls[0]!.sql;
    expect(sql).toMatch(/ingested_by <> current_user/);
    expect(sql).toMatch(/status = 'failed' AND reviewed_at IS NULL AND COALESCE\(last_error, ''\) NOT LIKE 'review:%'/);
  });

  it("selection: pending at once (no grace), failed only after 60 s per row and below 10 attempts; replay ignores both", async () => {
    override = (c) => (/SELECT id::text FROM lemon_webhook_events/.test(c.sql) ? result({ id: "1" }, { id: "2" }) : undefined);
    await consumeIngestedWebhookEvents({ all: true });
    const select = calls.find((c) => /SELECT id::text FROM lemon_webhook_events/.test(c.sql))!;
    expect(select.params).toEqual([true, 10, 100]);
    expect(select.sql).toMatch(/status = 'pending' AND \(\$1 OR attempts < \$2\)/);
    expect(select.sql).toMatch(/attempts < \$2 AND claimed_at < NOW\(\) - INTERVAL '60 seconds'/);
    expect(select.sql).not.toMatch(/received_at </);
  });

  it("a failing claim does not stop the pass", async () => {
    let n = 0;
    override = (c) => {
      if (/SELECT id::text FROM lemon_webhook_events/.test(c.sql)) return result({ id: "1" }, { id: "2" });
      if (/SET status = 'processing'/.test(c.sql) && n++ === 0) throw pgError("42501");
      return undefined;
    };
    expect(await consumeIngestedWebhookEvents()).toEqual({ processed: 1, failed: 1, skipped: 0 });
  });

  it("payload clean-up goes through the V8 owner function with the 30-day retention", async () => {
    override = (c) => (/clear_processed_webhook_payloads/.test(c.sql) ? result({ n: 3 }) : undefined);
    expect(await clearPayloadsThroughFunction()).toBe(3);
    expect(calls[0]!.sql).toMatch(/clear_processed_webhook_payloads\(INTERVAL '30 days'\)/);
  });
});

describe("F-4: readiness of the V8 schema; no fallback to legacy", () => {
  it("a pass on a schema without the V8 objects consumes nothing and says why", async () => {
    override = (c) => (/AS columns_found/.test(c.sql) ? result({ ...READY, columns_found: 0, guard_triggers: 0, credit_fn: false, clear_fn: false }) : undefined);
    const r = await consumeIngestedWebhookEvents();
    expect(r).toMatchObject({ processed: 0, failed: 0, skipped: 0 });
    expect(r.notReady).toEqual([
      "inbox columns of migration 022 (V8) are missing",
      "review-column guard triggers of migration 022 (V8) are missing",
      "function credit_verified_purchase is missing",
      "function clear_processed_webhook_payloads is missing",
    ]);
    expect(calls.filter((c) => /lemon_webhook_events/.test(c.sql) && !/AS columns_found/.test(c.sql))).toEqual([]);
    expect(calls.some((c) => /post_credit_transaction|SET status = 'processing'/.test(c.sql))).toBe(false);
  });

  it("missing privileges are named, never silently tolerated", () => {
    expect(consumerReadinessProblems({ ...READY, can_credit: false, can_clear: false, can_read_policy: false })).toEqual([
      "this role cannot read ledger_policy (grants S7/S10-R)",
      "this role cannot execute credit_verified_purchase (grants S7/S10-R)",
      "this role cannot execute clear_processed_webhook_payloads (grants S7/S10-R)",
    ]);
    expect(consumerReadinessProblems({ ...READY, table_present: false })).toEqual(["table lemon_webhook_events not found"]);
    expect(consumerReadinessProblems(undefined)).toEqual(["the readiness probe returned no answer"]);
    expect(consumerReadinessProblems(READY)).toEqual([]);
  });

  it("a failed probe is not ready, carries no database text, and is asked again at the next pass", async () => {
    override = (c) => {
      if (/AS columns_found/.test(c.sql)) throw new Error("secret connection string");
      return undefined;
    };
    expect((await consumeIngestedWebhookEvents()).notReady).toEqual(["the readiness probe failed (database unavailable?)"]);
    expect(JSON.stringify(getConsumerReadiness())).not.toContain("secret");
    expect(logs.lines().join("\n")).not.toContain("secret");
    override = () => undefined;
    expect((await consumeIngestedWebhookEvents()).notReady).toBeUndefined();
  });

  it("not ready is reported once per change, not on every poll", async () => {
    override = (c) => (/AS columns_found/.test(c.sql) ? result({ ...READY, credit_fn: false }) : undefined);
    for (let i = 0; i < 5; i++) await consumeIngestedWebhookEvents();
    expect(logs.lines().filter((l) => /NOT READY/.test(l))).toHaveLength(1);
  });

  it("ready is remembered: one probe for many passes; the state is visible to /health", async () => {
    expect(getConsumerReadiness()).toEqual({ ready: false, problems: ["not checked yet"] });
    await consumeIngestedWebhookEvents();
    await consumeIngestedWebhookEvents();
    expect(calls.filter((c) => /AS columns_found/.test(c.sql))).toHaveLength(1);
    expect(getConsumerReadiness()).toEqual({ ready: true, problems: [] });
  });

  it("the probe reads the catalogue only", () => {
    expect(V8_READINESS_SQL.trim()).toMatch(/^SELECT/);
    expect(V8_READINESS_SQL).not.toMatch(/INSERT|UPDATE|DELETE|CREATE|ALTER|GRANT|;/);
  });

  it("checkConsumerReadiness gives the same answer to every caller", async () => {
    expect(await checkConsumerReadiness()).toEqual({ ready: true, problems: [] });
  });
});

describe("F-3: the clean-up is throttled and stays behind the owner function", () => {
  it("runs once, then not again before the interval, then again", async () => {
    let t = 1_000;
    const fn = vi.fn(async () => 3);
    const run = throttled(fn, CLEANUP_INTERVAL_MS, () => t);
    expect(await run()).toBe(3);
    t += CLEANUP_INTERVAL_MS - 1;
    expect(await run()).toBeUndefined();
    t += 1;
    expect(await run()).toBe(3);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a failing run is not repeated before the interval (no error flood)", async () => {
    let t = 0;
    const fn = vi.fn(async () => {
      throw new Error("x");
    });
    const run = throttled(fn, CLEANUP_INTERVAL_MS, () => t);
    await expect(run()).rejects.toThrow();
    t += 5_000;
    expect(await run()).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("the documented interval is one hour and the clean-up is the V8 owner function", async () => {
    expect(CLEANUP_INTERVAL_MS).toBe(3_600_000);
    await clearPayloadsThroughFunction();
    expect(calls.at(-1)!.sql).toMatch(/SELECT clear_processed_webhook_payloads\(INTERVAL '30 days'\)/);
  });
});

describe("F-5 (contract 15.9): the claim's attempts value is the fencing token", () => {
  it("success and failure updates require status 'processing' and the exact attempts value the claim returned", async () => {
    claim = claimed({ attempts: 4 });
    await consumeIngestedEvent("7");
    expect(calls[0]!.sql).toMatch(/SET status = 'processing', attempts = attempts \+ 1, claimed_at = NOW\(\)/);
    expect(calls[0]!.sql).toMatch(/RETURNING event_name, eligible, payload, attempts,/);
    const done = calls.find((c) => /SET status = 'processed'/.test(c.sql))!;
    expect(done.sql).toMatch(/WHERE id = \$1 AND status = 'processing' AND attempts = \$3::int/);
    expect(done.params).toEqual(["7", "credited", 4]);
    expect(done.sql).not.toMatch(/claimed_at = \$3/);

    calls = [];
    fn = () => {
      throw pgError("08006");
    };
    claim = claimed({ attempts: 5 });
    await consumeIngestedEvent("7");
    const failed = calls.find((c) => /SET status = 'failed'/.test(c.sql))!;
    expect(failed.sql).toMatch(/WHERE id = \$1 AND status = 'processing' AND attempts = \$3::int/);
    expect(failed.params[2]).toBe(5);
  });

  it("a lost claim on the success path is skipped, not processed, and nothing else is written", async () => {
    override = (c) => (/SET status = 'processed'/.test(c.sql) ? { rows: [], rowCount: 0 } : undefined);
    expect(await consumeIngestedEvent("7")).toBe("skipped");
    expect(calls.filter((c) => /SET status = 'failed'/.test(c.sql))).toEqual([]);
    expect(logs.lines().join("\n")).toMatch(/Claim lost before the result was recorded/);
  });

  it("a lost claim on the failure path is now observable: logged and reported as skipped", async () => {
    fn = () => {
      throw pgError("08006");
    };
    override = (c) => (/SET status = 'failed'/.test(c.sql) ? { rows: [], rowCount: 0 } : undefined);
    expect(await consumeIngestedEvent("7")).toBe("skipped");
    expect(logs.lines().join("\n")).toMatch(/Claim lost before the failure was recorded/);
  });
});

describe("F-6: refund events are validated against the DATABASE policy", () => {
  const refundClaim = (attrs: Record<string, unknown> = {}) =>
    claimed({
      event_name: "order_refunded",
      eligible: false,
      payload: payloadOf({ status: "refunded", refunded: true, refunded_amount: 500, ...attrs }, "order_refunded"),
    });

  it("the policy is read from ledger_policy", async () => {
    claim = refundClaim();
    await consumeIngestedEvent("7");
    expect(calls.some((c) => /FROM ledger_policy WHERE singleton/.test(c.sql))).toBe(true);
    expect(processedWith()).toBe("refund_recorded");
  });

  it("another store than the policy's: labelled store_mismatch, nothing recorded", async () => {
    claim = refundClaim({ store_id: 99999 });
    await consumeIngestedEvent("7");
    expect(processedWith()).toBe("store_mismatch");
    expect(calls.some((c) => /INSERT INTO lemon_order_refunds/.test(c.sql))).toBe(false);
  });

  it("a test-mode refund when the policy does not allow test mode: test_mode_order, nothing recorded", async () => {
    claim = refundClaim({ test_mode: true });
    await consumeIngestedEvent("7");
    expect(processedWith()).toBe("test_mode_order");
    expect(calls.some((c) => /INSERT INTO lemon_order_refunds/.test(c.sql))).toBe(false);
  });

  it("the policy decides, not the environment: a store id that equals the policy is accepted", async () => {
    override = (c) => (/FROM ledger_policy WHERE singleton/.test(c.sql) ? result({ lemon_store_id: "424242", allow_test_mode: true }) : undefined);
    claim = refundClaim({ store_id: 424242, test_mode: true });
    await consumeIngestedEvent("7");
    expect(processedWith()).toBe("refund_recorded");
  });

  it.each<[string, { rows: unknown[]; rowCount: number }]>([
    ["no policy row", { rows: [], rowCount: 0 }],
    ["no store id in the policy", { rows: [{ lemon_store_id: null, allow_test_mode: false }], rowCount: 1 }],
  ])("%s: policy_incomplete, failed and counted, nothing recorded", async (_label, answer) => {
    override = (c) => (/FROM ledger_policy WHERE singleton/.test(c.sql) ? answer : undefined);
    claim = refundClaim();
    expect(await consumeIngestedEvent("7")).toBe("failed");
    expect(failedWith()).toMatch(/^policy_incomplete/);
    expect(logs.lines().join("\n")).toContain(POLICY_INCOMPLETE_LOG_CODE);
    expect(calls.some((c) => /INSERT INTO lemon_order_refunds/.test(c.sql))).toBe(false);
  });
});

describe("F-8: the receipt shows the pack's list price", () => {
  it("credits map to the pack's price, not the tax-inclusive order total; the currency is USD", async () => {
    claim = claimed({ order_total_cents: 595, order_subtotal_cents: 500 });
    fn = { o_outcome: "credited", o_ledger_id: "41", o_user_id: USER, o_credits: 50 };
    await consumeIngestedEvent("7");
    expect(receipts.queue).toHaveBeenCalledWith({ userId: USER, creditsAdded: 50, orderId: "4242", amountPaidCents: 500, currency: "USD" });
  });

  it("a pack unknown to the configuration falls back to the subtotal", async () => {
    claim = claimed({ order_total_cents: 595, order_subtotal_cents: 500 });
    fn = { o_outcome: "credited", o_ledger_id: "41", o_user_id: USER, o_credits: 12345 };
    await consumeIngestedEvent("7");
    expect(receipts.queue.mock.calls[0]![0].amountPaidCents).toBe(500);
  });

  it("no receipt for any other outcome", async () => {
    fn = { o_outcome: "already_processed", o_ledger_id: "41", o_user_id: USER, o_credits: 50 };
    await consumeIngestedEvent("7");
    expect(receipts.queue).not.toHaveBeenCalled();
  });
});

