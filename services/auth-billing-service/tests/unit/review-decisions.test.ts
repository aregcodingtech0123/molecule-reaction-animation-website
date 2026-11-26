/**
 * Owner review decisions (contract 17.6, 17.7, Q-D1) over a scripted client, and SG-3 (the reopen statement's exact shape). The
 * guard trigger that refuses other roles needs PostgreSQL (TR-3, TR-17, QD1-T4: not run).
 */
import { describe, expect, it, vi } from "vitest";
import {
  CLOSE_REVIEW_SQL,
  REOPEN_REVIEW_SQL,
  REVIEW_COLUMNS_PRESENT_SQL,
  ReviewDecisionError,
  closeReview,
  reopenReview,
} from "../../scripts/lib/review-decisions.mjs";

function client(present: boolean, matched: boolean) {
  return { query: vi.fn(async (sql: string) => ({ rows: sql === REVIEW_COLUMNS_PRESENT_SQL ? [{ present }] : matched ? [{ id: "7" }] : [] })) };
}
const setClause = (sql: string) => sql.split(/\bWHERE\b/)[0]!.replace(/^[\s\S]*?\bSET\b/, "");
const assigned = (sql: string) => [...setClause(sql).matchAll(/\b(\w+)\s*=/g)].map((m) => m[1]).sort();

describe("SG-3: the statements are the contract's", () => {
  it("reopen assigns exactly reviewed_at, review_disposition and last_error (all NULL), never status, and keeps its guards", () => {
    expect(assigned(REOPEN_REVIEW_SQL)).toEqual(["last_error", "review_disposition", "reviewed_at"]);
    expect(setClause(REOPEN_REVIEW_SQL)).toMatch(/reviewed_at = NULL, review_disposition = NULL, last_error = NULL/);
    expect(REOPEN_REVIEW_SQL).toMatch(/WHERE id = \$1 AND reviewed_at IS NOT NULL AND status = 'failed'/);
    expect(setClause(REOPEN_REVIEW_SQL)).not.toMatch(/review_note|status/);
  });

  it("close assigns reviewed_at, the disposition and the note, only on an open review stop", () => {
    expect(assigned(CLOSE_REVIEW_SQL)).toEqual(["review_disposition", "review_note", "reviewed_at"]);
    expect(CLOSE_REVIEW_SQL).toMatch(/WHERE id = \$1 AND status = 'failed' AND reviewed_at IS NULL AND last_error LIKE 'review:%'/);
  });
});

describe("closeReview / reopenReview", () => {
  it("close runs the statement with id, disposition and trimmed note", async () => {
    const c = client(true, true);
    expect(await closeReview(c, "7", "do_not_credit", "  refunded in dashboard, AB  ")).toBe(true);
    expect(c.query).toHaveBeenLastCalledWith(CLOSE_REVIEW_SQL, ["7", "do_not_credit", "refunded in dashboard, AB"]);
  });

  it("no matching row → false (not closable / not reopenable), nothing else", async () => {
    expect(await closeReview(client(true, false), "7", "resolved", "x")).toBe(false);
    expect(await reopenReview(client(true, false), "7")).toBe(false);
  });

  it.each<[string, () => Promise<unknown>]>([
    ["an unknown disposition", () => closeReview(client(true, true), "7", "approve", "x")],
    ["an empty note", () => closeReview(client(true, true), "7", "resolved", "   ")],
    ["a non-numeric id", () => closeReview(client(true, true), "7; DROP", "resolved", "x")],
    ["a zero id", () => reopenReview(client(true, true), "0")],
  ])("%s is refused before any statement", async (_l, call) => {
    await expect(call()).rejects.toBeInstanceOf(ReviewDecisionError);
  });

  it("before the V8 migration nothing runs", async () => {
    const c = client(false, true);
    await expect(reopenReview(c, "7")).rejects.toThrow(/V8 migration 022/);
    expect(c.query).toHaveBeenCalledTimes(1);
  });
});
