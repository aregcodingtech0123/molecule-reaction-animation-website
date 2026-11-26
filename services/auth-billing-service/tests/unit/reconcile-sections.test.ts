/**
 * db:reconcile V8 sections over a scripted client: grouping, counting and remedies of unprocessed events (P6.3, G-R1 B, F-7) are
 * real behaviour here; the SQL of sites 6 and 7, of the provenance classification and of the authoritative refund state can only be
 * proved on PostgreSQL (N1-T2, N1-T4, M-3: DB campaign, not run), so these tests pin its composition only.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MISSING_USER_SQL,
  REFUNDS_SQL,
  REMEDY,
  UNPROCESSED_SQL,
  UNPROCESSED_V8_SQL,
  orderCreditedSql,
  reportUnprocessedEvents,
  unprocessedSql,
} from "../../scripts/lib/reconcile-sections.mjs";
import { UNCREDITED_PURCHASES_SQL } from "../../scripts/lib/uncredited-purchases.mjs";

interface Probe {
  present: boolean;
  v8: boolean;
  prov: boolean;
}
function run(probe: Probe, events: Record<string, unknown>[]) {
  const client = { query: vi.fn(async (sql: string) => ({ rows: /to_regprocedure/.test(sql) ? [probe] : events })) };
  const out = { log: vi.fn(), table: vi.fn() };
  return { client, out, count: reportUnprocessedEvents(client, out as unknown as Console) as Promise<number> };
}
const PRE: Probe = { present: true, v8: false, prov: false };
const V8: Probe = { present: true, v8: true, prov: true };
const ev = (id: string, last_error: string | null, closed_disposition: string | null = null, provenance: string | null = null) => ({
  id,
  status: "failed",
  last_error,
  closed_disposition,
  provenance,
});
const logged = (out: { log: { mock: { calls: unknown[][] } } }) => out.log.mock.calls.map((c) => String(c[0]));

describe("reportUnprocessedEvents (P6.3)", () => {
  it("before migration 015 the section is skipped", async () => {
    const { client, count } = run({ ...PRE, present: false }, [ev("1", "x")]);
    expect(await count).toBe(0);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("current schema: the plain query; review stops and ordinary failures are listed apart, and both count", async () => {
    const { client, out, count } = run(PRE, [ev("1", "Database error (SQLSTATE 08006)"), ev("2", "review:partial_refund"), ev("3", null)]);
    expect(await count).toBe(3);
    expect(client.query.mock.calls[1]![0]).toBe(UNPROCESSED_SQL);
    expect(logged(out).some((l) => /2 stored Lemon webhook event\(s\) not processed \(webhook_unprocessed\)/.test(l))).toBe(true);
    expect(logged(out).some((l) => /1 stored Lemon webhook event\(s\) stopped for review \(webhook_review\)/.test(l))).toBe(true);
    expect(out.table.mock.calls[0]![0].map((r: { id: string }) => r.id)).toEqual(["1", "3"]);
    expect(out.table.mock.calls[1]![0]).toEqual([{ id: "2", status: "failed", last_error: "review:partial_refund" }]);
  });

  it("V8 schema: the joined query; closed events are counted by disposition, never listed, and do not count", async () => {
    const { client, out, count } = run(V8, [
      ev("1", "review:fraudulent_status", "do_not_credit", "v8_ingested"),
      ev("2", "review:partial_refund", "resolved", "legacy"),
      ev("3", "review:payment_state_unknown", null, "v8_ingested"),
    ]);
    expect(await count).toBe(1);
    expect(client.query.mock.calls[1]![0]).toBe(UNPROCESSED_V8_SQL);
    expect(out.table).toHaveBeenCalledTimes(1);
    expect(logged(out).at(-1)).toMatch(/info — 2 event\(s\) closed by a review decision \(not listed\): \{"do_not_credit":1,"resolved":1\}/);
  });

  it("a reopened event (marker cleared, Q-D1) is an ordinary failure until it is claimed again", async () => {
    const { out, count } = run(V8, [ev("4", null, null, "v8_ingested")]);
    expect(await count).toBe(1);
    expect(logged(out)[0]).toMatch(/webhook_unprocessed/);
  });

  it("nothing waiting: one OK line, exit count 0", async () => {
    const { out, count } = run(V8, [ev("1", "review:x", "resolved", "v8_ingested")]);
    expect(await count).toBe(0);
    expect(logged(out)[0]).toMatch(/^\[reconcile\] OK/);
  });
});

describe("G-R1 B: legacy and V8-ingested failures are told apart, each with a remedy that can work", () => {
  it("legacy and V8 rows are listed in separate groups, each with its own remedy", async () => {
    const { out, count } = run(V8, [ev("1", "Database error", null, "legacy"), ev("2", "Database error", null, "v8_ingested"), ev("3", "x", null, "legacy")]);
    expect(await count).toBe(3);
    const lines = logged(out);
    expect(lines.some((l) => l.includes(`2: ${REMEDY.failure_legacy}`))).toBe(true);
    expect(lines.some((l) => l.includes(`1: ${REMEDY.failure_v8}`))).toBe(true);
    expect(out.table.mock.calls.map((c) => c[0].map((r: { id: string }) => r.id))).toEqual([["1", "3"], ["2"]]);
    expect(out.table.mock.calls[0]![0][0]).toHaveProperty("provenance", "legacy");
  });

  it("a legacy row is never sent to a replay that cannot process it; a V8 row is never sent to a legacy replay", () => {
    expect(REMEDY.failure_legacy).toMatch(/does NOT process them/);
    expect(REMEDY.failure_legacy).toMatch(/F3 procedure with the old build/);
    expect(REMEDY.failure_legacy).not.toMatch(/WEBHOOK_INGEST_MODE=external/);
    expect(REMEDY.failure_v8).toMatch(/WEBHOOK_INGEST_MODE=external/);
    expect(REMEDY.failure_v8).toMatch(/legacy. mode never takes them/);
  });

  it("before the provenance column exists the single, plain remedy is used and no provenance column is printed", async () => {
    const { out } = run(PRE, [ev("1", "x")]);
    await new Promise((r) => setImmediate(r));
    expect(logged(out).some((l) => l.includes(REMEDY.failure_plain))).toBe(true);
    expect(out.table.mock.calls[0]![0][0]).not.toHaveProperty("provenance");
  });

  it("the provenance SQL: trusted ingest roles are V8-ingested, everything else legacy; before the column it is NULL", () => {
    expect(UNPROCESSED_V8_SQL).toMatch(/CASE WHEN e\.ingested_by = ANY\(ARRAY\[pg_get_userbyid\(.*'moleculestudio_webhook'\]\) THEN 'v8_ingested' ELSE 'legacy' END AS provenance/s);
    expect(UNPROCESSED_SQL).toMatch(/NULL::text AS provenance/);
    expect(unprocessedSql({ v8: false, prov: true })).toMatch(/ingested_by/);
    expect(unprocessedSql({ v8: false, prov: true })).toMatch(/NULL::text AS closed_disposition/);
  });
});

describe("F-7: review stops before the V8 migration", () => {
  it("say that no close or reopen procedure exists yet, keep the event listed (exit 2) and forbid hand edits; no SQL is invented", async () => {
    const { out, count } = run(PRE, [ev("2", "review:partial_refund")]);
    expect(await count).toBe(1);
    const line = logged(out).find((l) => /webhook_review/.test(l))!;
    expect(line).toContain(REMEDY.review_pre_v8);
    expect(REMEDY.review_pre_v8).toMatch(/no supported close or reopen procedure/);
    expect(REMEDY.review_pre_v8).toMatch(/do not edit the row by hand/);
    expect(REMEDY.review_pre_v8).not.toMatch(/UPDATE|SET |reviewed_at/);
  });

  it("on the V8 schema the remedy is the owner tool", async () => {
    const { out } = run(V8, [ev("2", "review:partial_refund", null, "v8_ingested")]);
    await new Promise((r) => setImmediate(r));
    expect(logged(out).find((l) => /webhook_review/.test(l))).toContain("npm run db:review-event");
  });
});

describe("contract 5.1 in reconcile SQL (sites 6 and 7)", () => {
  const credited = orderCreditedSql("X.provider_order_id");

  it("credited = a provider-keyed row OR exactly one eligible historical row; equality on the whole reference, no LIMIT/ORDER BY/LIKE", () => {
    expect(credited).toMatch(/l\.provider = 'lemonsqueezy' AND l\.reference_id = 'ls_order_' \|\| X\.provider_order_id/);
    expect(credited).toMatch(/h\.provider IS NULL AND h\.transaction_type = 'ADMIN_ADJUSTMENT' AND h\.amount > 0\) = 1\)/);
    expect(credited).not.toMatch(/LIMIT|ORDER BY|LIKE/);
  });

  it("both sites use the same definition and keep ambiguous orders listed with their historical count", () => {
    expect(UNCREDITED_PURCHASES_SQL).toContain(`NOT ${orderCreditedSql("e.provider_order_id")}`);
    expect(MISSING_USER_SQL).toContain(`NOT ${orderCreditedSql("m.provider_order_id")}`);
    for (const sql of [UNCREDITED_PURCHASES_SQL, MISSING_USER_SQL]) expect(sql).toMatch(/AS historical_manual_credits/);
    expect(UNCREDITED_PURCHASES_SQL).toMatch(/'not_eligible', 'unresolved_package', 'amount_mismatch', 'invalid_package_id'/);
  });

  it("authoritative refund state: full refund first, then the largest partial; listed while any row is unreviewed", () => {
    expect(REFUNDS_SQL).toMatch(/ORDER BY r\.provider_order_id, \(r\.order_status = 'refunded'\) DESC, r\.refunded_amount DESC/);
    expect(REFUNDS_SQL).toMatch(/WHERE EXISTS \(SELECT 1 FROM lemon_order_refunds u WHERE u\.provider_order_id = r\.provider_order_id AND u\.reviewed_at IS NULL\)/);
  });

  it("every section query only reads and never selects the stored message", () => {
    for (const sql of [MISSING_USER_SQL, REFUNDS_SQL, UNPROCESSED_SQL, UNPROCESSED_V8_SQL, UNCREDITED_PURCHASES_SQL]) {
      expect(sql.trim()).toMatch(/^SELECT/);
      expect(sql).not.toMatch(/payload|buyer_email|INSERT|UPDATE|DELETE|;/);
    }
  });
});
