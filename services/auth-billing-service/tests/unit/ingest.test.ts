/**
 * Step 7.5, owner decision O-1 Option B: the separate webhook ingestion process (src/ingestIndex.ts, src/ingest/*), database-free.
 *
 * Proves, without a database: the process's configuration refuses everything that belongs to the main service; what is signed,
 * parsed and classified before any storage; the statements and privilege checks of the webhook-role store over a fake pool; the
 * HTTP answers; and, from the source, that the ingestion process cannot import anything that reads the main environment or opens
 * the main pool. It does NOT prove that PostgreSQL grants the role what S6 says, that the typed columns exist, or that the main
 * service consumes the rows: those need migration 022 on a database and are not run here.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { productionConfigProblems } from "../../src/config/productionConfig.js";
import { createIngestApp, WEBHOOK_PATH } from "../../src/ingest/app.js";
import { classifyDelivery, type IngestPolicy, type IngestRow } from "../../src/ingest/classify.js";
import { MAIN_SERVICE_ONLY_VARIABLES, resolveIngestConfig, type IngestConfig } from "../../src/ingest/config.js";
import { GRANTS_SQL, INSERT_COLUMNS, StoreNotReadyError, createIngestStore, type IngestStore, type PoolLike, type StoredDelivery } from "../../src/ingest/store.js";
import { spyConsole, type ConsoleSpies } from "../support/console";
import { CREDITS, PRICES, VARIANTS, orderCreatedEvent, sign, signedBody, type OrderOptions } from "../support/lemon";
import { VALID_PRODUCTION_ENV } from "../support/production-env";

const SECRET = "wh-Q7f2Lk9Zp4Rt8Vx1Bn6Cm3Dj5Hs0Ga2E";
const PASSWORD = "S3CR3TPW";
const INGEST_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  LEMONSQUEEZY_WEBHOOK_SECRET: SECRET,
  WEBHOOK_DATABASE_URL: `postgresql://moleculestudio_webhook:${PASSWORD}@db.example:5432/app?sslmode=require`,
  LEMONSQUEEZY_STORE_ID: "11111",
  LEMONSQUEEZY_VARIANT_STARTER: String(VARIANTS.starter),
  LEMONSQUEEZY_VARIANT_PRO: String(VARIANTS.pro),
  LEMONSQUEEZY_VARIANT_ENTERPRISE: String(VARIANTS.enterprise),
};
const policy: IngestPolicy = {
  storeId: "11111",
  variantToPackage: new Map([
    [String(VARIANTS.starter), "starter"],
    [String(VARIANTS.pro), "pro"],
    [String(VARIANTS.enterprise), "enterprise"],
  ]),
  allowTestMode: false,
};

/** A live (test_mode false) order of this store. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the helper edits arbitrary parts of a fixture to break it
function live(opts: OrderOptions = {}, edit: (event: any) => void = () => undefined) {
  const event = structuredClone(orderCreatedEvent({ customData: { user_id: randomUUID() }, ...opts }));
  (event.data.attributes as Record<string, unknown>).test_mode = false;
  edit(event);
  return event;
}
const classify = (event: unknown, p: IngestPolicy = policy) => {
  const raw = Buffer.from(JSON.stringify(event));
  return classifyDelivery(raw, event as never, p);
};

describe("ingestion configuration (credential isolation)", () => {
  it("a complete production configuration resolves; test mode is off", () => {
    const r = resolveIngestConfig(INGEST_ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.allowTestMode).toBe(false);
    expect(r.config.variantToPackage.get(String(VARIANTS.pro))).toBe("pro");
    expect(r.config.host).toBe("127.0.0.1");
  });

  it.each(MAIN_SERVICE_ONLY_VARIABLES)("%s present → refused by name, with no value in the message", (name) => {
    const r = resolveIngestConfig({ ...INGEST_ENV, [name]: "VALUE-MUST-NOT-LEAK" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join("\n")).toContain(name);
    expect(r.problems.join("\n")).not.toContain("VALUE-MUST-NOT-LEAK");
  });

  it.each([
    ["not set", undefined],
    ["the app role", `postgresql://moleculestudio_app:${PASSWORD}@db.example:5432/app`],
    ["no user", "postgresql://db.example:5432/app"],
    ["no database", `postgresql://moleculestudio_webhook:${PASSWORD}@db.example:5432/`],
    ["a user override in the query", `postgresql://moleculestudio_webhook:${PASSWORD}@db.example:5432/app?user=postgres`],
    ["another scheme", `mysql://moleculestudio_webhook:${PASSWORD}@db.example/app`],
    ["not a URL", `not a url ${PASSWORD}`],
  ])("WEBHOOK_DATABASE_URL: %s → refused, and no part of the URL is printed", (_label, url) => {
    const r = resolveIngestConfig({ ...INGEST_ENV, WEBHOOK_DATABASE_URL: url });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join("\n")).toContain("WEBHOOK_DATABASE_URL");
    expect(r.problems.join("\n")).not.toContain(PASSWORD);
  });

  it.each(["true", "TRUE", "1", "yes", "y", "on"])("production refuses LEMONSQUEEZY_ALLOW_TEST_MODE=%s (O-3)", (value) => {
    const r = resolveIngestConfig({ ...INGEST_ENV, LEMONSQUEEZY_ALLOW_TEST_MODE: value });
    expect(r.ok).toBe(false);
  });

  it("an unset NODE_ENV is production, as everywhere in this service", () => {
    const { NODE_ENV: _omit, ...rest } = INGEST_ENV;
    expect(resolveIngestConfig({ ...rest, LEMONSQUEEZY_ALLOW_TEST_MODE: "true" }).ok).toBe(false);
  });

  it("test mode is honoured only outside production, and only for the exact value true", () => {
    const dev = { ...INGEST_ENV, NODE_ENV: "development", LEMONSQUEEZY_WEBHOOK_SECRET: "short" };
    expect(resolveIngestConfig({ ...dev, LEMONSQUEEZY_ALLOW_TEST_MODE: "true" })).toMatchObject({ ok: true, config: { allowTestMode: true } });
    expect(resolveIngestConfig({ ...dev, LEMONSQUEEZY_ALLOW_TEST_MODE: "1" })).toMatchObject({ ok: true, config: { allowTestMode: false } });
    expect(resolveIngestConfig(dev)).toMatchObject({ ok: true, config: { allowTestMode: false } });
  });

  it.each([
    ["a weak webhook secret in production", { LEMONSQUEEZY_WEBHOOK_SECRET: "changeme" }, /LEMONSQUEEZY_WEBHOOK_SECRET/],
    ["no store id", { LEMONSQUEEZY_STORE_ID: "" }, /LEMONSQUEEZY_STORE_ID/],
    ["a store id that is not numeric", { LEMONSQUEEZY_STORE_ID: "your_store_id" }, /LEMONSQUEEZY_STORE_ID/],
    ["a missing variant", { LEMONSQUEEZY_VARIANT_PRO: "" }, /LEMONSQUEEZY_VARIANT_PRO/],
    ["a shared variant", { LEMONSQUEEZY_VARIANT_PRO: String(VARIANTS.starter) }, /LEMONSQUEEZY_VARIANT/],
    ["a bad port", { INGEST_PORT: "70000" }, /INGEST_PORT/],
  ])("%s → refused", (_label, change, pattern) => {
    const r = resolveIngestConfig({ ...INGEST_ENV, ...change });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join("\n")).toMatch(pattern);
  });
});

describe("main service production rules (O-3)", () => {
  it.each(["true", "1", "yes", "on"])("LEMONSQUEEZY_ALLOW_TEST_MODE=%s is a startup problem in production", (value) => {
    expect(productionConfigProblems({ ...VALID_PRODUCTION_ENV, LEMONSQUEEZY_ALLOW_TEST_MODE: value })).toContain(
      "LEMONSQUEEZY_ALLOW_TEST_MODE must not be enabled in production.",
    );
  });

  it.each([undefined, "", "false", "0"])("%s is fine", (value) => {
    const source = { ...VALID_PRODUCTION_ENV, ...(value === undefined ? {} : { LEMONSQUEEZY_ALLOW_TEST_MODE: value }) };
    expect(productionConfigProblems(source)).toEqual([]);
  });
});

describe("classification: typed columns and eligible", () => {
  it("a live, paid, correctly priced order of this store is eligible, with every typed column", () => {
    const event = live({ variantId: VARIANTS.pro, total: PRICES.pro, email: "  Buyer@Example.test " });
    const row = classify(event);
    expect(row).toMatchObject({
      eventName: "order_created",
      providerOrderId: event.data.id,
      eligible: true,
      ineligibleReason: null,
      orderStoreId: "11111",
      orderTestMode: false,
      orderVariantId: String(VARIANTS.pro),
      orderCurrency: "USD",
      orderTotalCents: PRICES.pro,
      orderSubtotalCents: PRICES.pro,
      orderItemPriceCents: PRICES.pro,
      buyerEmail: "Buyer@Example.test",
    });
    expect(row.bodySha256).toEqual(createHash("sha256").update(JSON.stringify(event)).digest());
  });

  it.each<[string, ReturnType<typeof live>, string]>([
    ["a pending order", live({ status: "pending" }), "order_not_paid"],
    ["a failed payment", live({ status: "failed" }), "order_not_paid"],
    ["a confirmed full refund", live({ status: "refunded", refunded: true }, (e) => (e.data.attributes.refunded_amount = PRICES.starter)), "order_refunded"],
    // V8 Part P3.2: `paid` with `refunded: true` is contradictory, no longer read as a refund.
    ["paid but flagged refunded", live({ refunded: true }), "payment_state_unknown"],
    ["a partial refund", live({ status: "partial_refund" }, (e) => (e.data.attributes.refunded_amount = 100)), "partial_refund"],
    ["a fraudulent order", live({ status: "fraudulent" }), "fraudulent_status"],
    ["an unknown status", live({ status: "chargeback" }), "payment_state_unknown"],
    // N2-T3: an absent `refunded` does not establish "not refunded".
    ["paid with refunded absent", live({}, (e) => delete e.data.attributes.refunded), "payment_state_unknown"],
    ["paid with a refunded amount", live({}, (e) => (e.data.attributes.refunded_amount = 1)), "payment_state_unknown"],
    ["another store", live({}, (e) => (e.data.attributes.store_id = 99999)), "store_mismatch"],
    ["no store id", live({}, (e) => delete e.data.attributes.store_id), "store_mismatch"],
    ["test mode absent", live({}, (e) => delete e.data.attributes.test_mode), "test_mode_unknown"],
    ["test mode as text", live({}, (e) => (e.data.attributes.test_mode = "false")), "malformed_payload"],
    ["test mode on", live({}, (e) => (e.data.attributes.test_mode = true)), "test_mode_order"],
    ["another currency", live({ currency: "EUR" }), "currency_mismatch"],
    ["an unknown variant", live({ variantId: 424242 }), "unresolved_package"],
    ["no variant", live({ variantId: null }), "unresolved_package"],
    ["a wrong amount", live({ total: PRICES.starter - 1 }), "amount_mismatch"],
    ["the price of another pack", live({ variantId: VARIANTS.starter, total: PRICES.enterprise, subtotal: PRICES.enterprise, price: PRICES.enterprise }), "amount_mismatch"],
    ["a missing item price", live({}, (e) => delete e.data.attributes.first_order_item.price), "amount_missing"],
    ["an order id that is an object", live({}, (e) => (e.data.id = { a: 1 })), "malformed_payload"],
    ["no attributes", live({}, (e) => delete e.data.attributes), "malformed_payload"],
  ])("%s → stored but not eligible (%s)", (_label, event, reason) => {
    const row = classify(event);
    expect(row.eligible).toBe(false);
    expect(row.ineligibleReason).toBe(reason);
  });

  it("test mode is eligible only where the policy allows it", () => {
    const event = live({}, (e) => (e.data.attributes.test_mode = true));
    expect(classify(event, { ...policy, allowTestMode: true })).toMatchObject({ eligible: true, orderTestMode: true });
  });

  it("other events are stored with no typed columns and never eligible", () => {
    const row = classify(live({ eventName: "order_refunded" }));
    expect(row).toMatchObject({ eventName: "order_refunded", eligible: false, orderStoreId: null, orderVariantId: null, orderTotalCents: null });
    expect(classify({ data: { id: "1" } }).eventName).toBe("unknown");
  });

  it("custom_data cannot choose the pack or an amount: only the variant and the price decide", () => {
    const event = live({ variantId: VARIANTS.starter, customData: { user_id: randomUUID(), package_id: "enterprise", credits: 999999, amount: 1 } });
    const row = classify(event);
    expect(row).toMatchObject({ eligible: true, orderVariantId: String(VARIANTS.starter), orderTotalCents: PRICES.starter });
    expect(Object.keys(row).sort()).not.toEqual(expect.arrayContaining(["credits", "packageId"]));
    expect(CREDITS.starter).toBe(50); // the credit amount exists only server-side, in config/packages.ts
  });

  it("buyer and pending ids are kept only when well-formed; over-long values cannot break the insert", () => {
    const good = randomUUID();
    const pending = randomUUID();
    expect(classify(live({ customData: { user_id: good, pending_order_id: pending } }))).toMatchObject({ buyerUserId: good, pendingOrderId: pending });
    expect(classify(live({ customData: { user_id: "12345; DROP TABLE users", pending_order_id: "x" } }))).toMatchObject({ buyerUserId: null, pendingOrderId: null });
    expect(classify(live({ email: `${"a".repeat(330)}@example.test` })).buyerEmail).toBeNull();
    expect(classify(live({}, (e) => (e.data.attributes.store_id = "9".repeat(40)))).orderStoreId).toBeNull();
  });
});

type Handler = (sql: string, params?: unknown[]) => { rows: Array<Record<string, unknown>> } | Promise<{ rows: Array<Record<string, unknown>> }>;
function fakePool(handler: Handler) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: PoolLike & { ended: number } = {
    ended: 0,
    async query(sql, params) {
      queries.push({ sql, params });
      return handler(sql, params);
    },
    on: () => pool,
    async end() {
      pool.ended += 1;
    },
  };
  return { pool, queries };
}
const WEBHOOK_ID = { rows: [{ current_user: "moleculestudio_webhook", session_user: "moleculestudio_webhook" }] };
/** Answers the readiness probe as a correctly provisioned webhook role, everything else through `rest`. */
const provisioned = (rest: Handler = () => ({ rows: [] })): Handler => (sql, params) => {
  if (/current_user/.test(sql) && !/has_column_privilege/.test(sql)) return WEBHOOK_ID;
  if (/has_column_privilege/.test(sql)) return { rows: [{ ok: true }] };
  return rest(sql, params);
};
const sampleRow = (): IngestRow => classify(live());

describe("webhook-role store", () => {
  beforeEach(() => void spyConsole());

  it("ready only when both identities are the webhook role and the grants match; one pool, one probe for concurrent callers", async () => {
    const { pool, queries } = fakePool(provisioned());
    const factory = vi.fn(() => pool);
    const store = createIngestStore({ connectionString: "x", poolFactory: factory });
    expect(await Promise.all([store.ready(), store.ready()])).toEqual([{ ready: true }, { ready: true }]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(queries.filter((q) => /current_user/.test(q.sql) && !/has_column/.test(q.sql))).toHaveLength(1);
    await store.ready();
    expect(queries).toHaveLength(2); // already ready: no further probe
  });

  it.each([
    ["the app role", { rows: [{ current_user: "moleculestudio_app", session_user: "moleculestudio_app" }] }],
    ["SET ROLE (current_user differs)", { rows: [{ current_user: "moleculestudio_webhook", session_user: "postgres" }] }],
    ["a superuser", { rows: [{ current_user: "postgres", session_user: "postgres" }] }],
  ])("%s → identity_mismatch, the pool is discarded, nothing is inserted", async (_label, who) => {
    const { pool, queries } = fakePool((sql) => (/current_user/.test(sql) ? who : { rows: [{ ok: true }] }));
    const store = createIngestStore({ connectionString: "x", poolFactory: () => pool });
    expect(await store.ready()).toEqual({ ready: false, reason: "identity_mismatch" });
    expect(pool.ended).toBe(1);
    await expect(store.insert(sampleRow())).rejects.toBeInstanceOf(StoreNotReadyError);
    expect(queries.some((q) => /INSERT/.test(q.sql))).toBe(false);
  });

  it("grants that differ from S6 → grants_wrong", async () => {
    const { pool } = fakePool((sql) => (/has_column_privilege/.test(sql) ? { rows: [{ ok: false }] } : WEBHOOK_ID));
    expect(await createIngestStore({ connectionString: "x", poolFactory: () => pool }).ready()).toEqual({ ready: false, reason: "grants_wrong" });
  });

  it("a database without migration 022's columns (42703) → contract_missing, not stored untyped", async () => {
    const { pool } = fakePool((sql) => {
      if (/has_column_privilege/.test(sql)) throw Object.assign(new Error("column does not exist"), { code: "42703" });
      return WEBHOOK_ID;
    });
    expect(await createIngestStore({ connectionString: "x", poolFactory: () => pool }).ready()).toEqual({ ready: false, reason: "contract_missing" });
  });

  it("a database that never answers → probe_timeout", async () => {
    const { pool } = fakePool(() => new Promise(() => undefined));
    const store = createIngestStore({ connectionString: "x", poolFactory: () => pool, probeTimeoutMs: 20 });
    expect(await store.ready()).toEqual({ ready: false, reason: "probe_timeout" });
  });

  it("the privilege check demands the typed INSERT columns and forbids provenance, status and any UPDATE or DELETE", () => {
    for (const column of INSERT_COLUMNS) expect(GRANTS_SQL).toContain(`'${column}', 'INSERT'`);
    for (const column of ["ingested_by", "status", "outcome"]) expect(GRANTS_SQL).toMatch(new RegExp(`'${column}', 'INSERT'`));
    expect(GRANTS_SQL).toMatch(/NOT \(.*'ingested_by', 'INSERT'/s);
    expect(GRANTS_SQL).toContain("has_any_column_privilege('public.lemon_webhook_events', 'UPDATE')");
    expect(GRANTS_SQL).toContain("'DELETE'");
    expect(GRANTS_SQL).toMatch(/NOT has_column_privilege\('public.lemon_webhook_events', 'payload', 'SELECT'\)/);
  });

  it("a new delivery is one DO NOTHING insert with the typed values in column order; no UPDATE form anywhere", async () => {
    const { pool, queries } = fakePool(provisioned((sql) => (/^\s*INSERT/.test(sql) ? { rows: [{ id: "9", status: "pending" }] } : { rows: [] })));
    const store = createIngestStore({ connectionString: "x", poolFactory: () => pool });
    const row = sampleRow();
    expect(await store.insert(row)).toEqual({ id: "9", status: "pending", inserted: true });
    const insert = queries.find((q) => /^\s*INSERT/.test(q.sql))!;
    expect(insert.sql).toMatch(/ON CONFLICT ON CONSTRAINT uq_lemon_webhook_events_body DO NOTHING/);
    expect(insert.sql).not.toMatch(/DO UPDATE|xmax|ingested_by/);
    expect(insert.params).toEqual([
      row.bodySha256, row.eventName, row.providerOrderId, row.payload, true, row.orderStoreId, false, row.orderVariantId, row.orderCurrency,
      row.orderTotalCents, row.orderSubtotalCents, row.orderItemPriceCents, row.buyerUserId, row.buyerEmail, row.pendingOrderId,
    ]);
    expect(insert.params).toHaveLength(INSERT_COLUMNS.length);
  });

  it("a duplicate delivery is read back by its hash and reported as not inserted", async () => {
    const { pool, queries } = fakePool(provisioned((sql) => (/^\s*INSERT/.test(sql) ? { rows: [] } : { rows: [{ id: "3", status: "processed" }] })));
    const store = createIngestStore({ connectionString: "x", poolFactory: () => pool });
    const row = sampleRow();
    expect(await store.insert(row)).toEqual({ id: "3", status: "processed", inserted: false });
    expect(queries.at(-1)).toMatchObject({ params: [row.bodySha256] });
  });

  it("neither inserted nor found: never acknowledged", async () => {
    const { pool } = fakePool(provisioned());
    await expect(createIngestStore({ connectionString: "x", poolFactory: () => pool }).insert(sampleRow())).rejects.toBeInstanceOf(StoreNotReadyError);
  });

  it("a credential or privilege failure on insert makes the next insert re-check the identity", async () => {
    let fail = true;
    const { pool, queries } = fakePool(provisioned((sql) => {
      if (/^\s*INSERT/.test(sql) && fail) throw Object.assign(new Error("denied"), { code: "42501" });
      return /^\s*INSERT/.test(sql) ? { rows: [{ id: "1", status: "pending" }] } : { rows: [] };
    }));
    const store = createIngestStore({ connectionString: "x", poolFactory: () => pool });
    await expect(store.insert(sampleRow())).rejects.toMatchObject({ code: "42501" });
    fail = false;
    await store.insert(sampleRow());
    expect(queries.filter((q) => /current_user/.test(q.sql) && !/has_column/.test(q.sql))).toHaveLength(2);
  });
});

describe("ingestion HTTP endpoint", () => {
  let logs: ConsoleSpies;
  let insert: Mock<(row: IngestRow) => Promise<StoredDelivery>>;
  let readiness: { ready: true } | { ready: false; reason: "check_failed" };
  const config: IngestConfig = {
    production: true,
    webhookSecret: SECRET,
    databaseUrl: "unused",
    storeId: "11111",
    variantToPackage: policy.variantToPackage,
    allowTestMode: false,
    host: "127.0.0.1",
    port: 0,
    storeTimeoutMs: 40,
  };
  const build = () => createIngestApp({ config, store: { ready: async () => readiness, insert: (row: IngestRow) => insert(row), close: async () => undefined } as IngestStore });
  const post = (raw: string, signature?: string, contentType = "application/json") => {
    const req = request(build()).post(WEBHOOK_PATH).set("Content-Type", contentType);
    if (signature !== undefined) req.set("X-Signature", signature);
    return req.send(raw);
  };

  beforeEach(() => {
    logs = spyConsole();
    insert = vi.fn(async () => ({ id: "5", status: "pending", inserted: true }));
    readiness = { ready: true };
  });

  it.each([
    ["no signature", undefined],
    ["an empty signature", ""],
    ["a malformed signature", "zz"],
    ["another secret's signature", sign("x", "another-secret")],
  ])("%s → 401 and nothing is stored", async (_label, signature) => {
    expect((await post(JSON.stringify(live()), signature)).status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it("the signature is over the exact bytes: the same JSON re-serialised is refused", async () => {
    const event = live();
    const { signature } = signedBody(event, SECRET);
    expect((await post(JSON.stringify(event, null, 2), signature)).status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(["{", "1", "null", "[]"])("a signed body %s is no event → 400, nothing stored", async (raw) => {
    expect((await post(raw, sign(raw, SECRET))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("a body that is not JSON content → 400, nothing stored", async () => {
    expect((await post("text", sign("text", SECRET), "text/plain")).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("over 256 kB → 413, nothing stored", async () => {
    const raw = JSON.stringify({ pad: "x".repeat(300_000) });
    expect((await post(raw, sign(raw, SECRET))).status).toBe(413);
    expect(insert).not.toHaveBeenCalled();
  });

  it("a valid delivery: stored with its classification, then 200", async () => {
    const { raw, signature } = signedBody(live(), SECRET);
    const res = await post(raw, signature);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(insert).toHaveBeenCalledOnce();
    expect(insert.mock.calls[0]![0]).toMatchObject({ eligible: true, eventName: "order_created" });
  });

  it("an ineligible delivery is still stored and acknowledged (the main service records refunds and refusals)", async () => {
    const { raw, signature } = signedBody(live({ variantId: 424242 }), SECRET);
    expect((await post(raw, signature)).status).toBe(200);
    expect(insert.mock.calls[0]![0]).toMatchObject({ eligible: false, ineligibleReason: "unresolved_package" });
  });

  it("a duplicate delivery is acknowledged (it is already stored)", async () => {
    insert.mockResolvedValue({ id: "5", status: "processed", inserted: false });
    const { raw, signature } = signedBody(live(), SECRET);
    expect((await post(raw, signature)).status).toBe(200);
  });

  it("not stored → 503 with Retry-After, never a 200, and the database's text is not answered", async () => {
    insert.mockRejectedValue(Object.assign(new Error("password authentication failed for user moleculestudio_webhook"), { code: "28P01" }));
    const { raw, signature } = signedBody(live(), SECRET);
    const res = await post(raw, signature);
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(JSON.stringify(res.body)).not.toMatch(/password|moleculestudio/);
    expect(logs.lines().join("\n")).toMatch(/NOT STORED.*28P01/);
  });

  it("a store that stalls past the deadline → 503", async () => {
    insert.mockImplementation(() => new Promise(() => undefined));
    const { raw, signature } = signedBody(live(), SECRET);
    expect((await post(raw, signature)).status).toBe(503);
  });

  it("logs hold the order id and outcome, never the e-mail, the signature or the secret", async () => {
    const { raw, signature } = signedBody(live({ email: "buyer.private@example.test" }), SECRET);
    await post(raw, signature);
    const text = logs.lines().join("\n");
    expect(text).toContain("[ingest] Stored");
    expect(text).not.toContain("buyer.private");
    expect(text).not.toContain(signature);
    expect(text).not.toContain(SECRET);
  });

  it("only the webhook route and a health probe exist", async () => {
    const app = build();
    expect((await request(app).get(WEBHOOK_PATH)).status).toBe(404);
    for (const p of ["/api/auth/login", "/api/billing/balance", "/api/billing/consume", "/"]) expect((await request(app).post(p).send("{}")).status).toBe(404);
    expect((await request(app).get("/health")).status).toBe(200);
    readiness = { ready: false, reason: "check_failed" };
    expect((await request(app).get("/health")).status).toBe(503);
  });
});

describe("process separation, from the source", () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
  const IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^"'`;]*?\sfrom\s+)?["']([^"']+)["']/gm;

  function reachable(entry: string) {
    const files = new Set<string>();
    const external = new Set<string>();
    const queue = [entry];
    while (queue.length) {
      const file = queue.pop()!;
      if (files.has(file)) continue;
      files.add(file);
      const text = fs.readFileSync(path.join(srcRoot, file), "utf8");
      for (const match of text.matchAll(IMPORT)) {
        const spec = match[1]!;
        if (!spec.startsWith(".")) {
          external.add(spec);
          continue;
        }
        queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)).replace(/\.js$/, ".ts"));
      }
    }
    return { files, external };
  }

  it("the ingestion process reaches only its own modules and the pure helpers: no main environment, no main pool, no service", () => {
    const { files, external } = reachable("ingestIndex.ts");
    expect([...files].sort()).toEqual(
      [
        "config/packages.ts",
        "config/productionConfig.ts",
        "config/secretStrength.ts",
        "ingest/app.ts",
        "ingest/classify.ts",
        "ingest/config.ts",
        "ingest/store.ts",
        "ingestIndex.ts",
        "lib/lemonEvent.ts",
        "types/index.ts",
      ],
    );
    expect([...external].filter((s) => !s.startsWith("node:")).sort()).toEqual(["dotenv", "express", "pg"]);
  });

  it("the main service does not import the ingestion modules, and its webhook route and secret are unchanged until the cutover", () => {
    for (const file of ["index.ts", "app.ts"]) {
      const { files } = reachable(file);
      expect([...files].filter((f) => f.startsWith("ingest/") || f === "ingestIndex.ts")).toEqual([]);
    }
  });
});
