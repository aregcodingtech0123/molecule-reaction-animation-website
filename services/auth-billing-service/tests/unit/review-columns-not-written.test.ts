/**
 * I-1 contract rule (V8 contract section 11; Part P2, 17.5): closing and reopening a review is owner-only, so no statement in the
 * service or its scripts may write `reviewed_at`, `review_disposition` or `review_note` on the inbox. Until S10-R the application role
 * still holds table-level UPDATE on lemon_webhook_events; this test keeps the code from using it. Static; no database.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|mjs|js)$/.test(entry.name) ? [full] : [];
  });
}

/** Every string literal (template, single or double quoted) that writes the inbox. */
function inboxWrites(text: string): string[] {
  const literals = text.match(/`[^`]*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) ?? [];
  return literals.filter((s) => /\b(UPDATE|INSERT\s+INTO)\s+lemon_webhook_events\b/i.test(s));
}

describe("the review columns are never written by application code (I-1)", () => {
  // The owner-only review tool (scripts/lib/review-decisions.mjs) is the one place allowed to write these columns: it runs on the
  // owner connection, and the V8 guard trigger refuses every other role. It is checked by tests/unit/review-decisions.test.ts.
  const files = [...sources(path.join(root, "src")), ...sources(path.join(root, "scripts"))].filter((f) => !f.endsWith("review-decisions.mjs"));
  const writes = files.flatMap((file) => inboxWrites(fs.readFileSync(file, "utf8")).map((sql) => ({ file: path.relative(root, file), sql })));

  it("finds the inbox writes it checks (the scan is not vacuous)", () => {
    expect(writes.length).toBeGreaterThanOrEqual(4);
  });

  it("no inbox write names reviewed_at, review_disposition or review_note", () => {
    const offending = writes.filter(({ sql }) => /\b(reviewed_at|review_disposition|review_note)\b/i.test(sql));
    expect(offending).toEqual([]);
  });
});

/**
 * SG-4 (V8 contract 15.6, Q-D1, Q-D5): the review-stop marker is changed only by the inbox's own claim, success and failure
 * statements. Those reach a row only after a claim, and the claim skips review stops (Q-T3); the database guard refuses any
 * other non-owner change of a stop's status or last_error. Static over the application's SQL text; the guard itself needs PostgreSQL.
 */
describe("SG-4: only the claim, success and failure statements write status or last_error of the inbox", () => {
  const files = [...sources(path.join(root, "src")), ...sources(path.join(root, "scripts"))].filter((f) => !f.endsWith("review-decisions.mjs"));
  const updates = files.flatMap((file) =>
    inboxWrites(fs.readFileSync(file, "utf8"))
      .map((sql) => sql.slice(1, -1).replace(/\s+/g, " ").trim())
      .filter((sql) => /^UPDATE lemon_webhook_events\b/i.test(sql))
      .map((sql) => ({ file: path.relative(root, file).split(path.sep).join("/"), sql })),
  );
  const setClause = (sql: string) => sql.split(/\bWHERE\b/i)[0]!.replace(/^.*?\bSET\b/i, "");
  const writesMarker = (sql: string) => /\b(status|last_error)\s*=/i.test(setClause(sql));

  it("the statements that write status or last_error are exactly the claim, the success and the failure update of each consumer", () => {
    const writers = updates.filter((u) => writesMarker(u.sql));
    const byFile = (file: string) => writers.filter((u) => u.file === file).map((u) => u.sql.match(/SET status = '(\w+)'/)?.[1]);
    expect(writers).toHaveLength(6);
    expect(byFile("src/services/webhookInbox.service.ts")).toEqual(["processing", "processed", "failed"]);
    expect(byFile("src/services/v8Consumer.service.ts")).toEqual(["processing", "processed", "failed"]);
  });

  it("both claims carry the Q-T3 guard; last_error = NULL appears only in the success updates", () => {
    const claims = updates.filter((u) => /SET status = 'processing'/.test(u.sql));
    expect(claims).toHaveLength(2);
    for (const claim of claims) expect(claim.sql).toContain("${CLAIMABLE_FAILED}");
    const claim = claims[0]!;
    const inbox = fs.readFileSync(path.join(root, "src/services/webhookInbox.service.ts"), "utf8");
    expect(inbox).toContain("const CLAIMABLE_FAILED = `(status = 'failed' AND reviewed_at IS NULL AND COALESCE(last_error, '') NOT LIKE 'review:%')`;");
    expect(claim.sql).not.toMatch(/status IN \('pending', 'failed'\)/);
    const clearing = updates.filter((u) => /last_error = NULL/i.test(setClause(u.sql)));
    expect(clearing).toHaveLength(2);
    for (const c of clearing) expect(c.sql).toMatch(/SET status = 'processed'/);
  });

  it("no application SQL writes a review: literal; descriptions come only from the pinned list", () => {
    expect(updates.filter((u) => /'review:/.test(setClause(u.sql)))).toEqual([]);
  });
});
