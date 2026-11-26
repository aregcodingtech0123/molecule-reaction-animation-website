/**
 * db:reconcile section `webhook_uncredited` over a scripted client: what is printed and when it is skipped. The query itself runs
 * on PostgreSQL in tests/db/webhook-missing-user.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { UNCREDITED_PURCHASES_SQL, reportUncreditedPurchases } from "../../scripts/lib/uncredited-purchases.mjs";

function run(present: boolean, orders: unknown[]) {
  const client = { query: vi.fn(async (sql: string) => ({ rows: sql === UNCREDITED_PURCHASES_SQL ? orders : [{ present }] })) };
  const out = { log: vi.fn(), table: vi.fn() };
  return { client, out, count: reportUncreditedPurchases(client, out as unknown as Console) as Promise<number> };
}

describe("reportUncreditedPurchases", () => {
  it("nothing waiting: one OK line", async () => {
    const { out, count } = run(true, []);
    expect(await count).toBe(0);
    expect(out.log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/OK — no paid order/));
    expect(out.table).not.toHaveBeenCalled();
  });

  it("orders waiting: counted and printed", async () => {
    const rows = [{ provider_order_id: "1", outcome: "amount_mismatch" }, { provider_order_id: "2", outcome: "unresolved_package" }];
    const { out, count } = run(true, rows);
    expect(await count).toBe(2);
    expect(out.log.mock.calls[0]![0]).toMatch(/2 paid order\(s\).*\(webhook_uncredited\)/);
    expect(out.table).toHaveBeenCalledWith(rows);
  });

  it("before migration 018 the section is skipped", async () => {
    const { client, out, count } = run(false, [{ provider_order_id: "1" }]);
    expect(await count).toBe(0);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(out.log).not.toHaveBeenCalled();
  });

  it("the query only reads, names both refusals and never touches the payload", () => {
    expect(UNCREDITED_PURCHASES_SQL.trim()).toMatch(/^SELECT/);
    expect(UNCREDITED_PURCHASES_SQL).not.toMatch(/payload|INSERT|UPDATE|DELETE|;/);
    expect(UNCREDITED_PURCHASES_SQL).toMatch(/'unresolved_package', 'amount_mismatch'/);
  });
});
