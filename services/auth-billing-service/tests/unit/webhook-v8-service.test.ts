/**
 * Step 7.5, V8 contract on the current schema, database-free: ledger-first and the Q2/N-1 historical lookup (sites 3 to 5), Q8,
 * the shared state reader in the purchase path, refund-before-credit, the refund recorder from state with the evidence
 * comparison, review stops in the inbox and the Q-T3 claim guard. The database is scripted: these tests prove which statements
 * run, in what order and with which answers; they do NOT prove locking, uniqueness or SQL semantics in PostgreSQL.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spyConsole } from "../support/console";
import { CREDITS, orderCreatedEvent, type OrderOptions } from "../support/lemon";

interface Call {
  sql: string;
  params: unknown[];
  tx: boolean;
}

const db = vi.hoisted(() => ({
  handle: ((): { rows: unknown[]; rowCount: number } => ({ rows: [], rowCount: 0 })) as (call: { sql: string; params: unknown[]; tx: boolean }) => { rows: unknown[]; rowCount: number },
  events: [] as string[],
}));

vi.mock("../../src/db/index.js", async (importOriginal) => {
  const run = (tx: boolean) => async (sql: string, params: unknown[] = []) => db.handle({ sql, params, tx });
  return {
    ...(await importOriginal<typeof import("../../src/db/index.js")>()),
    pool: { query: run(false) },
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
      db.events.push("BEGIN");
      try {
        const result = await fn({ query: run(true) });
        db.events.push("COMMIT");
        return result;
      } catch (err) {
        db.events.push("ROLLBACK");
        throw err;
      }
    },
  };
});

const { processLemonSqueezyEvent } = await import("../../src/services/webhook.service.js");
const { processStoredWebhookEvent, retryStoredWebhookEvents } = await import("../../src/services/webhookInbox.service.js");
const { resetInboxProvenanceCache } = await import("../../src/services/inboxProvenance.service.js");

const USER = randomUUID();
const OTHER = randomUUID();
let calls: Call[];
let override: (call: Call) => { rows: unknown[]; rowCount: number } | undefined;

const result = (...rows: unknown[]) => ({ rows, rowCount: rows.length });
const LEDGER = /FROM credit_ledger_transactions/;
const keyed = (id: string, user: string, amount: number) => ({ id, user_id: user, amount, provider: "lemonsqueezy" });
const historical = (id: string, user: string, amount: number) => ({ id, user_id: user, amount, provider: null });

beforeEach(() => {
  resetInboxProvenanceCache();
  calls = [];
  db.events = [];
  override = () => undefined;
  spyConsole();
  db.handle = (call) => {
    calls.push(call);
    const overridden = override(call);
    if (overridden) return overridden;
    // The inbox provenance probe (F-2): this suite runs on the pre-022 schema unless a test says otherwise.
    if (/AS table_present/.test(call.sql)) return result({ table_present: true, has_ingested_by: false });
    if (/SET status = '(processed|failed)'/.test(call.sql)) return result({}); // the claimant still holds the claim
    if (/SELECT 1 FROM users WHERE id/.test(call.sql)) return call.params[0] === USER ? result({}) : result();
    if (/FOR SHARE/.test(call.sql)) return result({});
    if (/post_credit_transaction/.test(call.sql)) return result({ ledger_id: "41" });
    return result();
  };
});

const order = (opts: OrderOptions = {}, attrs: Record<string, unknown> = {}) => {
  const event = structuredClone(orderCreatedEvent({ customData: { user_id: USER }, ...opts }));
  Object.assign(event.data.attributes as Record<string, unknown>, attrs);
  return event;
};
const refund = (attrs: Record<string, unknown> = {}) =>
  order({ eventName: "order_refunded" }, { status: "refunded", refunded: true, refunded_amount: 500, refunded_amount_usd: 500, refunded_at: "2026-10-20T10:00:00.000Z", test_mode: false, ...attrs });
const ledgerWrites = () => calls.filter((c) => /post_credit_transaction/.test(c.sql));
const refundInserts = () => calls.filter((c) => /INSERT INTO lemon_order_refunds/.test(c.sql));

describe("ledger-first and the historical lookup (contract 5.1, Q2 B, N-1, Q8)", () => {
  it("site 5: a provider-keyed row answers already_processed with ITS user and amount, before any user or package work", async () => {
    override = (c) => (!c.tx && LEDGER.test(c.sql) ? result(keyed("12", OTHER, 250)) : undefined);
    const event = order();
    expect(await processLemonSqueezyEvent(event)).toMatchObject({
      processed: false, reason: "already_processed", ledgerId: "12", userId: OTHER, creditAmount: 250, orderId: event.data.id,
    });
    expect(calls).toHaveLength(1);
    expect(db.events).toEqual([]);
  });

  it("the lookup is one statement on the exact reference: provider-keyed or provider-less positive ADMIN_ADJUSTMENT, no LIMIT, no ORDER BY", async () => {
    const event = order();
    await processLemonSqueezyEvent(event);
    const lookup = calls.find((c) => LEDGER.test(c.sql))!;
    expect(lookup.params).toEqual(["lemonsqueezy", `ls_order_${event.data.id}`]);
    expect(lookup.sql).toMatch(/reference_id = \$2/);
    expect(lookup.sql).toMatch(/provider IS NULL AND transaction_type = 'ADMIN_ADJUSTMENT' AND amount > 0/);
    expect(lookup.sql).not.toMatch(/LIMIT|ORDER BY|LIKE/);
  });

  it("exactly one historical manual credit: already_processed with that row's user and amount", async () => {
    override = (c) => (LEDGER.test(c.sql) ? result(historical("7", OTHER, 50)) : undefined);
    expect(await processLemonSqueezyEvent(order())).toMatchObject({ reason: "already_processed", ledgerId: "7", userId: OTHER, creditAmount: 50 });
    expect(ledgerWrites()).toEqual([]);
  });

  it("the provider-keyed row takes precedence over historical rows", async () => {
    override = (c) => (LEDGER.test(c.sql) ? result(historical("7", OTHER, 50), historical("8", OTHER, 50), keyed("12", USER, 250)) : undefined);
    expect(await processLemonSqueezyEvent(order())).toMatchObject({ reason: "already_processed", ledgerId: "12", userId: USER, creditAmount: 250 });
  });

  it("more than one historical credit and no provider-keyed row: a review stop, nothing chosen, nothing credited", async () => {
    override = (c) => (LEDGER.test(c.sql) ? result(historical("7", OTHER, 50), historical("8", USER, 50)) : undefined);
    await expect(processLemonSqueezyEvent(order())).rejects.toMatchObject({ message: "review:historical_credit_ambiguous" });
    expect(db.events).toEqual([]);
    expect(ledgerWrites()).toEqual([]);
  });

  it("site 4: ambiguity found inside the crediting transaction rolls it back", async () => {
    override = (c) => (c.tx && LEDGER.test(c.sql) ? result(historical("7", OTHER, 50), historical("8", USER, 50)) : undefined);
    await expect(processLemonSqueezyEvent(order())).rejects.toMatchObject({ message: "review:historical_credit_ambiguous" });
    expect(db.events).toEqual(["BEGIN", "ROLLBACK"]);
    expect(ledgerWrites()).toEqual([]);
  });

  it("site 4: a credit found inside the transaction answers with the ledger row's user and amount (Q8), not this event's", async () => {
    override = (c) => (c.tx && LEDGER.test(c.sql) ? result(keyed("12", OTHER, 700)) : undefined);
    expect(await processLemonSqueezyEvent(order())).toMatchObject({ reason: "already_processed", ledgerId: "12", userId: OTHER, creditAmount: 700 });
  });

  it("no credit at all: the purchase proceeds and credits once", async () => {
    expect(await processLemonSqueezyEvent(order())).toMatchObject({ processed: true, userId: USER, creditAmount: CREDITS.starter });
    expect(ledgerWrites()).toHaveLength(1);
  });
});

describe("payment state in the purchase path (shared reader, N-2, OP-16 C)", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["a partial refund", { status: "partial_refund", refunded: false, refunded_amount: 100 }, "review:partial_refund"],
    ["a fraudulent order", { status: "fraudulent" }, "review:fraudulent_status"],
    ["paid but flagged refunded", { refunded: true }, "review:payment_state_unknown"],
    ["paid with refunded absent", { refunded: undefined }, "review:payment_state_unknown"],
    ["an unknown status", { status: "chargeback" }, "review:payment_state_unknown"],
    ["no status", { status: undefined }, "review:payment_state_unknown"],
  ])("%s → review stop %s, never credited", async (_label, attrs, description) => {
    await expect(processLemonSqueezyEvent(order({}, attrs))).rejects.toMatchObject({ message: description });
    expect(ledgerWrites()).toEqual([]);
    expect(db.events).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["pending", { status: "pending" }, "order_not_paid"],
    ["failed payment", { status: "failed" }, "order_not_paid"],
    ["a confirmed full refund", { status: "refunded", refunded: true, refunded_amount: 500 }, "order_refunded"],
  ])("%s → label %s (processed, no credit)", async (_label, attrs, reason) => {
    expect(await processLemonSqueezyEvent(order({}, attrs))).toMatchObject({ processed: false, reason });
    expect(ledgerWrites()).toEqual([]);
  });
});

describe("refund before credit (contract P6.2)", () => {
  it("a refund already recorded for the order stops the credit for review", async () => {
    override = (c) => (/FROM lemon_order_refunds WHERE provider_order_id/.test(c.sql) ? result({}) : undefined);
    const event = order();
    await expect(processLemonSqueezyEvent(event)).rejects.toMatchObject({ message: "review:refund_before_credit" });
    expect(calls.find((c) => /FROM lemon_order_refunds/.test(c.sql))!.params).toEqual([event.data.id]);
    expect(ledgerWrites()).toEqual([]);
    expect(db.events).toEqual([]);
  });

  it("an order already credited is answered by the ledger first, refund or not", async () => {
    override = (c) => (LEDGER.test(c.sql) ? result(keyed("12", USER, 50)) : /lemon_order_refunds/.test(c.sql) ? result({}) : undefined);
    expect(await processLemonSqueezyEvent(order())).toMatchObject({ reason: "already_processed" });
  });
});

describe("refund recorder (contract P3.3, P3.4)", () => {
  it("a confirmed full refund: one row, order_status and fully_refunded from the state", async () => {
    override = (c) => (/INSERT INTO lemon_order_refunds/.test(c.sql) ? result({}) : undefined);
    expect(await processLemonSqueezyEvent(refund())).toMatchObject({ processed: true, reason: "refund_recorded" });
    expect(refundInserts()[0]!.params.slice(1, 4)).toEqual(["refunded", true, 500]);
  });

  it("a confirmed partial refund is recorded as partial, never as full", async () => {
    override = (c) => (/INSERT INTO lemon_order_refunds/.test(c.sql) ? result({}) : undefined);
    await processLemonSqueezyEvent(refund({ status: "partial_refund", refunded: false, refunded_amount: 200 }));
    expect(refundInserts()[0]!.params.slice(1, 4)).toEqual(["partial_refund", false, 200]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["a refund event saying paid", { status: "paid", refunded: false, refunded_amount: 0 }, "review:refund_event_state_mismatch"],
    ["status refunded with refunded false", { refunded: false }, "review:payment_state_unknown"],
    ["no refunded amount", { refunded_amount: undefined }, "review:payment_state_unknown"],
    ["a negative refunded amount", { refunded_amount: -5 }, "review:payment_state_unknown"],
    ["fraudulent", { status: "fraudulent" }, "review:fraudulent_status"],
  ])("%s → %s, nothing stored", async (_label, attrs, description) => {
    await expect(processLemonSqueezyEvent(refund(attrs))).rejects.toMatchObject({ message: description });
    expect(refundInserts()).toEqual([]);
  });

  it("the same refund again with the same evidence: already_recorded", async () => {
    override = (c) =>
      /SELECT refunded_amount_usd/.test(c.sql)
        ? result({ refunded_amount_usd: 500, currency: "USD", refunded_at: new Date("2026-10-20T10:00:00.000Z"), test_mode: false })
        : undefined;
    expect(await processLemonSqueezyEvent(refund())).toMatchObject({ processed: false, reason: "already_recorded" });
  });

  it.each<[string, Record<string, unknown>]>([
    ["refunded_at", { refunded_at: new Date("2026-10-21T10:00:00.000Z") }],
    ["refunded_amount_usd", { refunded_amount_usd: 499 }],
    ["currency", { currency: "EUR" }],
    ["test_mode", { test_mode: true }],
  ])("the same key with a different %s: first row kept, review stop", async (_label, stored) => {
    override = (c) =>
      /SELECT refunded_amount_usd/.test(c.sql)
        ? result({ refunded_amount_usd: 500, currency: "USD", refunded_at: new Date("2026-10-20T10:00:00.000Z"), test_mode: false, ...stored })
        : undefined;
    await expect(processLemonSqueezyEvent(refund())).rejects.toMatchObject({ message: "review:refund_evidence_conflict" });
    expect(calls.filter((c) => /UPDATE|DELETE/.test(c.sql))).toEqual([]);
  });
});

describe("inbox: review stops, payload_cleared and the Q-T3 claim guard", () => {
  const claimed = (payload: string | null) => (c: Call) =>
    /SET status = 'processing'/.test(c.sql) ? result({ payload, attempts: 1, provider_order_id: "1" }) : undefined;

  it("a review stop is stored failed with its fixed description and never processed", async () => {
    const payload = JSON.stringify(order({}, { status: "fraudulent" }));
    override = claimed(payload);
    expect(await processStoredWebhookEvent("7")).toBe("failed");
    const failed = calls.find((c) => /SET status = 'failed'/.test(c.sql))!;
    expect(failed.params.slice(0, 2)).toEqual(["7", "review:fraudulent_status"]);
    expect(calls.some((c) => /SET status = 'processed'/.test(c.sql))).toBe(false);
  });

  it("a claimed event whose payload was cleared becomes review:payload_cleared; nothing is reconstructed or credited", async () => {
    override = claimed(null);
    expect(await processStoredWebhookEvent("7")).toBe("failed");
    expect(calls.find((c) => /SET status = 'failed'/.test(c.sql))!.params.slice(0, 2)).toEqual(["7", "review:payload_cleared"]);
    expect(calls.filter((c) => LEDGER.test(c.sql) || /lemon_order_refunds|post_credit/.test(c.sql))).toEqual([]);
  });

  it("the claim, the retry selection and the replay exclude closed events and open review stops (SQL text; semantics need PostgreSQL)", async () => {
    await processStoredWebhookEvent("7");
    await retryStoredWebhookEvents({ all: true });
    const guard = /status = 'failed' AND reviewed_at IS NULL AND COALESCE\(last_error, ''\) NOT LIKE 'review:%'/;
    const claim = calls.find((c) => /SET status = 'processing'/.test(c.sql))!;
    const select = calls.find((c) => /SELECT id::text FROM lemon_webhook_events/.test(c.sql))!;
    for (const sql of [claim.sql, select.sql]) {
      expect(sql).toMatch(guard);
      expect(sql).not.toMatch(/status IN \('pending', 'failed'\)/);
    }
  });
});
