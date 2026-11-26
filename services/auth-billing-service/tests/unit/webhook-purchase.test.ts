/**
 * Step 7.5, database-free: the real HTTP endpoint, inbox and fulfilment code over a scripted database. It proves which statements
 * run, in what order and transaction, and what is answered. It does NOT prove locking, uniqueness or rollback in PostgreSQL:
 * tests/api/webhook.*.test.ts do that.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { CREDITS, PRICES, VARIANTS, orderCreatedEvent, sign, signedBody, type OrderOptions } from "../support/lemon";

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

const { createApp } = await import("../../src/app.js");
const { lemonOrderId, parseLemonSqueezyEvent, readLemonOrderFields } = await import("../../src/lib/lemonsqueezy.js");
const { processLemonSqueezyEvent } = await import("../../src/services/webhook.service.js");
const { processStoredWebhookEvent, storeWebhookEvent } = await import("../../src/services/webhookInbox.service.js");
const { resetInboxProvenanceCache } = await import("../../src/services/inboxProvenance.service.js");

const USER = randomUUID();
const EMAIL = "buyer@example.test";
let calls: Call[];
let override: (call: Call) => { rows: unknown[]; rowCount: number } | undefined;
let logs: ConsoleSpies;

const result = (...rows: unknown[]) => ({ rows, rowCount: rows.length });

beforeEach(() => {
  resetInboxProvenanceCache();
  calls = [];
  db.events = [];
  override = () => undefined;
  logs = spyConsole();
  db.handle = (call) => {
    calls.push(call);
    const overridden = override(call);
    if (overridden) return overridden;
    // The inbox provenance probe (F-2): this suite runs on the pre-022 schema unless a test says otherwise.
    if (/AS table_present/.test(call.sql)) return result({ table_present: true, has_ingested_by: false });
    if (/SET status = '(processed|failed)'/.test(call.sql)) return result({}); // the claimant still holds the claim: one row updated
    if (/SELECT 1 FROM users WHERE id/.test(call.sql)) return call.params[0] === USER ? result({}) : result();
    if (/FROM users WHERE lower/.test(call.sql)) return call.params[0] === EMAIL ? result({ id: USER }) : result();
    if (/INSERT INTO lemon_webhook_events/.test(call.sql)) return result({ id: "7", status: "processed" });
    if (/post_credit_transaction/.test(call.sql)) return result({ ledger_id: "41" });
    return result();
  };
});
afterEach(() => vi.unstubAllEnvs());

const ledgerWrites = () => calls.filter((c) => /post_credit_transaction/.test(c.sql));
const order = (opts: OrderOptions = {}) => orderCreatedEvent({ customData: { user_id: USER }, ...opts });
/** A deliberately malformed copy of a valid order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the helper edits arbitrary parts of a fixture to break it
function broken(edit: (event: any) => void, opts: OrderOptions = {}): ReturnType<typeof order> {
  const event = structuredClone(order(opts));
  edit(event);
  return event;
}
const post = (raw: string, signature?: string) => {
  const req = request(createApp()).post("/api/billing/webhooks/lemonsqueezy").set("Content-Type", "application/json");
  if (signature !== undefined) req.set("X-Signature", signature);
  return req.send(raw);
};

describe("HTTP gate", () => {
  it.each([
    ["no signature", undefined],
    ["an empty signature", ""],
    ["a malformed signature", "zz"],
    ["another secret's signature", sign("{}", "another-secret")],
  ])("%s → 401, no database call", async (_label, signature) => {
    expect((await post(JSON.stringify(order()), signature)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it.each(["{", "1", "null", "[]", '[{"meta":{}}]'])("validly signed body %s is not an event → 400, nothing stored", async (raw) => {
    expect((await post(raw, sign(raw))).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("a valid delivery is stored before the 200", async () => {
    const { raw, signature } = signedBody(order());
    expect((await post(raw, signature)).status).toBe(200);
    expect(calls[0]!.sql).toMatch(/INSERT INTO lemon_webhook_events/);
  });

  it("a storage failure → 503, never a 200, and its text is not answered", async () => {
    override = () => {
      throw new Error("database text");
    };
    const { raw, signature } = signedBody(order());
    const res = await post(raw, signature);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("database text");
  });

  it("not inserted and not found → 503: a delivery that is not in the inbox is never acknowledged", async () => {
    override = (c) => (/lemon_webhook_events/.test(c.sql) ? result() : undefined);
    const { raw, signature } = signedBody(order());
    expect((await post(raw, signature)).status).toBe(503);
  });
});

describe("inbox insert (C4: no UPDATE privilege needed)", () => {
  it("a new delivery is one DO NOTHING insert", async () => {
    const event = order();
    expect(await storeWebhookEvent(Buffer.from(signedBody(event).raw), event)).toEqual({ id: "7", status: "processed", inserted: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/ON CONFLICT ON CONSTRAINT uq_lemon_webhook_events_body DO NOTHING/);
    expect(calls[0]!.sql).not.toMatch(/DO UPDATE|xmax/);
  });

  it("a duplicate reads the stored row by the same hash and reports it as not inserted", async () => {
    override = (c) => (/^\s*INSERT/.test(c.sql) ? result() : result({ id: "3", status: "pending" }));
    const event = order();
    expect(await storeWebhookEvent(Buffer.from(signedBody(event).raw), event)).toEqual({ id: "3", status: "pending", inserted: false });
    expect(calls[1]!.sql).toMatch(/^SELECT id::text, status FROM lemon_webhook_events WHERE body_sha256 = \$1$/);
    expect(calls[1]!.params[0]).toEqual(calls[0]!.params[0]);
  });
});

describe("typed order fields", () => {
  it("order ids: text and safe integers only, never a stringified object", () => {
    expect([lemonOrderId("12"), lemonOrderId(12), lemonOrderId("a-b_c")]).toEqual(["12", "12", "a-b_c"]);
    for (const bad of [null, undefined, "", {}, [], ["1"], true, 1.5, NaN, 2 ** 60, "a b", "\u0000", "x".repeat(65)]) {
      expect(lemonOrderId(bad)).toBeNull();
    }
  });

  it("amounts must be non-negative int4 integers; anything else is no candidate", () => {
    for (const bad of ["500", -1, 5.5, 2_147_483_648, null, {}]) {
      expect(readLemonOrderFields(broken((e) => (e.data.attributes.total = bad)))!.totalCents).toBeNull();
    }
    expect(readLemonOrderFields(order())).toMatchObject({ totalCents: 500, variantId: String(VARIANTS.starter) });
  });

  it("an array is not an event", () => {
    expect(() => parseLemonSqueezyEvent(Buffer.from("[]"))).toThrow(/Invalid Lemon Squeezy webhook payload/);
  });
});

describe("purchase crediting", () => {
  it.each(["starter", "pro", "enterprise"] as const)("variant → %s: that user, that pack's credits, one ledger call in one transaction", async (pkg) => {
    const event = order({ variantId: VARIANTS[pkg], total: PRICES[pkg] });
    expect(await processLemonSqueezyEvent(event)).toMatchObject({ processed: true, userId: USER, creditAmount: CREDITS[pkg], ledgerId: "41" });
    expect(ledgerWrites()).toEqual([
      expect.objectContaining({ tx: true, params: [USER, CREDITS[pkg], `ls_order_${event.data.id}`, "lemonsqueezy"] }),
    ]);
    expect(db.events).toEqual(["BEGIN", "COMMIT"]);
  });

  it("custom_data.package_id never selects the pack: the purchased variant does", async () => {
    const outcome = await processLemonSqueezyEvent(order({ customData: { user_id: USER, package_id: "enterprise" } }));
    expect(outcome).toMatchObject({ processed: true, packageId: "starter", creditAmount: CREDITS.starter });
  });

  it("custom_data credit amounts are ignored", async () => {
    const outcome = await processLemonSqueezyEvent(order({ customData: { user_id: USER, credits: 999999, amount: 999999 } }));
    expect(outcome).toMatchObject({ processed: true, creditAmount: CREDITS.starter });
  });

  it.each<[string, ReturnType<typeof order>, string]>([
    ["unknown variant, package_id and price of a real pack", order({ variantId: 424242, customData: { user_id: USER, package_id: "starter" } }), "unresolved_package"],
    ["no variant, package_id of a real pack", order({ variantId: null, customData: { user_id: USER, package_id: "starter" } }), "unresolved_package"],
    ["a variant that is an object", broken((e) => (e.data.attributes.first_order_item.variant_id = { id: 1 })), "unresolved_package"],
    ["a pending order", order({ status: "pending" }), "order_not_paid"],
    ["a failed order", order({ status: "failed" }), "order_not_paid"],
    ["a confirmed full refund", broken((e) => Object.assign(e.data.attributes, { status: "refunded", refunded: true, refunded_amount: 500 })), "order_refunded"],
    ["a wrong amount", order({ total: 499 }), "amount_mismatch"],
    ["amounts as text", broken((e) => Object.assign(e.data.attributes, { total: "500", subtotal: "500", first_order_item: { variant_id: VARIANTS.starter, price: "500" } })), "amount_mismatch"],
    ["another currency", order({ currency: "EUR" }), "currency_mismatch"],
    ["a currency that is not text", broken((e) => (e.data.attributes.currency = ["USD"])), "currency_mismatch"],
    ["another store", broken((e) => (e.data.attributes.store_id = 99999)), "store_mismatch"],
    ["no user association", order({ customData: {}, email: "ghost@example.test" }), "missing_user"],
    ["an e-mail that is not text", broken((e) => (e.data.attributes.user_email = 5), { customData: {} }), "missing_user"],
    ["custom_data that is text", broken((e) => ((e.meta.custom_data = "user_id"), (e.data.attributes.user_email = "ghost@example.test"))), "missing_user"],
    ["no order id", broken((e) => delete e.data.id), "malformed_payload"],
    ["an order id that is an object", broken((e) => (e.data.id = { a: 1 })), "malformed_payload"],
    ["no attributes", broken((e) => delete e.data.attributes), "malformed_payload"],
    ["no data", broken((e) => delete e.data), "malformed_payload"],
    ["test_mode as text", broken((e) => (e.data.attributes.test_mode = "true")), "malformed_payload"],
    ["an unsupported event", order({ eventName: "subscription_created" }), "ignored_event_type"],
    ["no meta", broken((e) => delete e.meta), "ignored_event_type"],
  ])("%s → %s: no transaction, no ledger call", async (_label, event, reason) => {
    expect(await processLemonSqueezyEvent(event)).toMatchObject({ processed: false, reason });
    expect(ledgerWrites()).toEqual([]);
    expect(db.events).toEqual([]);
  });

  it("production refuses a test-mode order", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const event = broken((e) => (e.data.attributes.test_mode = true));
    expect(await processLemonSqueezyEvent(event)).toMatchObject({ processed: false, reason: "test_mode_order" });
  });

  it("the order e-mail is used when user_id is unusable, and user_id is not logged", async () => {
    const outcome = await processLemonSqueezyEvent(order({ customData: { user_id: "not-a-uuid-SECRET" }, email: EMAIL }));
    expect(outcome).toMatchObject({ processed: true, userId: USER });
    expect(logs.lines().join("\n")).not.toContain("SECRET");
  });

  it("an unresolved package does not log custom_data", async () => {
    await processLemonSqueezyEvent(order({ variantId: 424242, customData: { user_id: USER, note: "PRIVATE" } }));
    expect(logs.lines().join("\n")).not.toContain("PRIVATE");
  });

  it("a pending checkout is completed only for the credited user, in the crediting transaction", async () => {
    const pendingId = randomUUID();
    await processLemonSqueezyEvent(order({ customData: { user_id: USER, pending_order_id: pendingId } }));
    const update = calls.find((c) => /UPDATE pending_checkout_orders/.test(c.sql))!;
    expect(update.sql).toMatch(/id = \$1 AND user_id = \$2/);
    expect(update).toMatchObject({ params: [pendingId, USER], tx: true });
  });
});

describe("duplicates and failures", () => {
  it("an order already in the ledger is not credited again, whatever the event's body (inside the transaction: site 4)", async () => {
    override = (c) => (c.tx && /FROM credit_ledger_transactions/.test(c.sql) ? result({ id: "12", user_id: USER, amount: 50, provider: "lemonsqueezy" }) : undefined);
    expect(await processLemonSqueezyEvent(order())).toMatchObject({ processed: false, reason: "already_processed", ledgerId: "12" });
    expect(ledgerWrites()).toEqual([]);
  });

  it("an account anonymised after it was resolved is not credited: missing_user, no balance or ledger write", async () => {
    override = (c) => (c.tx && /FROM users WHERE id = \$1 AND anonymised_at IS NULL FOR SHARE/.test(c.sql) ? result() : undefined);
    expect(await processLemonSqueezyEvent(order())).toMatchObject({ processed: false, reason: "missing_user" });
    expect(calls.filter((c) => /INSERT|UPDATE|post_credit/.test(c.sql))).toEqual([]);
  });

  it("the unique-reference violation of a lost race rolls back and is already_processed", async () => {
    override = (c) => {
      if (/post_credit_transaction/.test(c.sql)) {
        throw Object.assign(new Error("dup"), { code: "23505", constraint: "uq_credit_ledger_provider_reference" });
      }
      // The first lookup (ledger-first, site 5) finds nothing; the one after the lost race (site 3) finds the winner's row.
      if (!c.tx && /FROM credit_ledger_transactions/.test(c.sql)) {
        return calls.filter((x) => !x.tx && /FROM credit_ledger_transactions/.test(x.sql)).length > 1
          ? result({ id: "12", user_id: USER, amount: 50, provider: "lemonsqueezy" })
          : result();
      }
      return undefined;
    };
    expect(await processLemonSqueezyEvent(order())).toMatchObject({ processed: false, reason: "already_processed", ledgerId: "12" });
    expect(db.events).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it.each([
    ["another unique violation", { code: "23505", constraint: "something_else" }],
    ["a connection loss", { code: "08006" }],
  ])("%s propagates: never reported as processed", async (_label, fields) => {
    override = (c) => {
      if (/post_credit_transaction/.test(c.sql)) throw Object.assign(new Error("x"), fields);
      return undefined;
    };
    await expect(processLemonSqueezyEvent(order())).rejects.toMatchObject(fields);
    expect(db.events).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("a failure after the ledger call (the pending-order update) rolls the credit back too", async () => {
    override = (c) => {
      if (/UPDATE pending_checkout_orders/.test(c.sql)) throw new Error("x");
      return undefined;
    };
    await expect(processLemonSqueezyEvent(order({ customData: { user_id: USER, pending_order_id: randomUUID() } }))).rejects.toThrow();
    expect(db.events).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("a failed stored event is marked failed (retryable), never processed; the retry credits it", async () => {
    const payload = JSON.stringify(order());
    let fail = true;
    override = (c) => {
      if (/SET status = 'processing'/.test(c.sql)) return result({ payload, attempts: 1, provider_order_id: "1" });
      if (fail && /post_credit_transaction/.test(c.sql)) throw Object.assign(new Error("x"), { code: "08006" });
      return undefined;
    };
    expect(await processStoredWebhookEvent("7")).toBe("failed");
    expect(calls.some((c) => /SET status = 'failed'/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /SET status = 'processed'/.test(c.sql))).toBe(false);

    fail = false;
    calls = [];
    expect(await processStoredWebhookEvent("7")).toBe("processed");
    expect(ledgerWrites()).toHaveLength(1);
    expect(calls.find((c) => /SET status = 'processed'/.test(c.sql))!.params[1]).toBe("credited");
  });

  it("an event claimed elsewhere is skipped: nothing but the claim runs", async () => {
    expect(await processStoredWebhookEvent("7")).toBe("skipped");
    expect(calls.filter((c) => !/AS table_present/.test(c.sql))).toHaveLength(1);
  });
});
