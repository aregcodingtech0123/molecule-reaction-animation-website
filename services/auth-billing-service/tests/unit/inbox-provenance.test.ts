/**
 * G-R1 Option B / F-2: the legacy claim, retry and replay never take rows stored by the ingestion process. The schema is probed
 * (ingested_by exists only from migration 022); a failed probe never means "take every row". The database is a scripted fake: the
 * tests prove WHICH statements are issued with WHICH predicate and what happens when the probe fails. They do not prove how
 * PostgreSQL evaluates the predicate (that needs the database campaign, M-4 and the legacy-versus-ingested case).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spyConsole } from "../support/console";

interface Call {
  sql: string;
  params: unknown[];
}
const db = vi.hoisted(() => ({
  handle: ((): { rows: unknown[]; rowCount: number } => ({ rows: [], rowCount: 0 })) as (call: { sql: string; params: unknown[] }) => { rows: unknown[]; rowCount: number },
}));

vi.mock("../../src/db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/index.js")>()),
  pool: { query: async (sql: string, params: unknown[] = []) => db.handle({ sql, params }) },
}));

const { PRE_022_TTL_MS, inboxProvenance, legacyPartitionSql, resetInboxProvenanceCache } = await import("../../src/services/inboxProvenance.service.js");
const { processStoredWebhookEvent, retryStoredWebhookEvents, CLAIMABLE_FAILED } = await import("../../src/services/webhookInbox.service.js");

let calls: Call[];
let schema: "pre-022" | "v8" | "probe-fails" | "malformed" | "no-table";
const result = (...rows: unknown[]) => ({ rows, rowCount: rows.length });
const isProbe = (c: Call) => /AS table_present/.test(c.sql);
const statements = () => calls.filter((c) => !isProbe(c));

beforeEach(() => {
  resetInboxProvenanceCache();
  calls = [];
  schema = "pre-022";
  spyConsole();
  db.handle = (call) => {
    calls.push(call);
    if (isProbe(call)) {
      if (schema === "probe-fails") throw new Error("connection terminated");
      if (schema === "malformed") return result();
      if (schema === "no-table") return result({ table_present: false, has_ingested_by: false });
      return result({ table_present: true, has_ingested_by: schema === "v8" });
    }
    return result();
  };
});

const LEGACY = "ingested_by = current_user";

describe("pre-022 schema: compatible, nothing to partition", () => {
  it("the claim and the selection carry no reference to ingested_by (a column that does not exist there)", async () => {
    await processStoredWebhookEvent("7");
    await retryStoredWebhookEvents();
    for (const c of statements()) expect(c.sql).not.toMatch(/ingested_by/);
    expect(statements()[0]!.sql).toMatch(/WHERE id = \$1 AND TRUE\b/);
    expect(statements()[1]!.sql).toMatch(/WHERE TRUE AND \(/);
  });

  it("pending, retryable failed and stale rows remain claimable and selectable (unchanged status rules, Q-T3 guard kept)", async () => {
    await processStoredWebhookEvent("7");
    const sql = statements()[0]!.sql;
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain(CLAIMABLE_FAILED);
    expect(sql).toMatch(/status = 'processing' AND claimed_at < NOW\(\) - INTERVAL '10 minutes'/);
  });
});

describe("V8 schema: the legacy path takes only rows the main service stored itself", () => {
  beforeEach(() => {
    schema = "v8";
  });

  it("the claim is limited to ingested_by = current_user, so a V8-ingested pending row is never claimed by the legacy path", async () => {
    await processStoredWebhookEvent("7");
    expect(statements()[0]!.sql).toMatch(new RegExp(`WHERE id = \\$1 AND ${LEGACY}\\b`));
  });

  it("the retry selection is limited the same way, so a V8-ingested failed row is never selected (and never claimed)", async () => {
    await retryStoredWebhookEvents();
    expect(statements()[0]!.sql).toMatch(new RegExp(`WHERE ${LEGACY} AND \\(`));
  });

  it("legacy rows (stored by the main service: ingested_by = this role) stay selectable with the unchanged status rules (F3 drain)", async () => {
    await retryStoredWebhookEvents();
    const sql = statements()[0]!.sql;
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain(CLAIMABLE_FAILED);
    expect(sql).toMatch(/OR \(status = 'processing' AND claimed_at < NOW\(\) - INTERVAL '10 minutes'/);
  });

  it("the replay (all: true) takes the same partition: it ignores attempts and grace, never provenance", async () => {
    await retryStoredWebhookEvents({ all: true });
    const select = statements()[0]!;
    expect(select.params[0]).toBe(true);
    expect(select.sql).toMatch(new RegExp(`WHERE ${LEGACY} AND \\(`));
  });

  it("the partition is the exact complement of the V8 consumer's (one owner per row)", async () => {
    const { consumeIngestedEvent } = await import("../../src/services/v8Consumer.service.js");
    await consumeIngestedEvent("7");
    const v8 = statements().find((c) => /SET status = 'processing'/.test(c.sql) && /ingested_by <> current_user/.test(c.sql));
    expect(v8).toBeDefined();
    expect(await legacyPartitionSql()).toBe(LEGACY);
  });
});

describe("a probe that cannot be answered never means permission", () => {
  it.each<[string, typeof schema]>([
    ["the probe query fails", "probe-fails"],
    ["the probe returns no row", "malformed"],
    ["the inbox table is not found", "no-table"],
  ])("%s: the claim throws and no claim statement is issued", async (_label, mode) => {
    schema = mode;
    await expect(processStoredWebhookEvent("7")).rejects.toThrow();
    expect(statements()).toEqual([]);
  });

  it.each<[string, typeof schema]>([
    ["the probe query fails", "probe-fails"],
    ["the probe returns no row", "malformed"],
    ["the inbox table is not found", "no-table"],
  ])("%s: the retry and the replay select nothing and process nothing", async (_label, mode) => {
    schema = mode;
    await expect(retryStoredWebhookEvents()).rejects.toThrow();
    await expect(retryStoredWebhookEvents({ all: true })).rejects.toThrow();
    expect(statements()).toEqual([]);
  });

  it("a failed probe is not remembered: the next call asks again", async () => {
    schema = "probe-fails";
    await expect(inboxProvenance()).rejects.toThrow();
    schema = "v8";
    expect(await inboxProvenance()).toBe("v8");
  });
});

describe("what is remembered", () => {
  it("v8 is remembered for the life of the process: one probe", async () => {
    schema = "v8";
    let t = 0;
    await inboxProvenance(() => t);
    t += 10 * PRE_022_TTL_MS;
    await inboxProvenance(() => t);
    expect(calls.filter(isProbe)).toHaveLength(1);
  });

  it("pre-022 is trusted only briefly: a migration applied while the service runs is noticed after the TTL", async () => {
    let t = 0;
    schema = "pre-022";
    expect(await inboxProvenance(() => t)).toBe("pre-022");
    schema = "v8";
    t += PRE_022_TTL_MS - 1;
    expect(await inboxProvenance(() => t)).toBe("pre-022"); // still inside the window (documented residual window)
    t += 2;
    expect(await inboxProvenance(() => t)).toBe("v8");
  });
});
