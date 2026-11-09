/**
 * Migrations 019 and 020 as text (Phase 2C step 5.2.2, Part A): they are read here, never applied, and no database is
 * contacted. What they do on a real server belongs to tests/db. This pins what must stay true of their definitions:
 * additive, no index, no grant, no financial object touched.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MIGRATIONS_DIR, listMigrations } from "../../scripts/lib/migrator.mjs";

const FILE_019 = "019_ai_delivery_attempt_tracking.sql";
const FILE_020 = "020_ai_delivery_gap_review.sql";

const read = (name: string) => {
  const file = `${DEFAULT_MIGRATIONS_DIR}/${name}`;
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
};
/** The statements only: a comment may mention anything. */
const sqlOf = (name: string) =>
  read(name)
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
const sql019 = sqlOf(FILE_019);
const sql020 = sqlOf(FILE_020);
const both = `${sql019} ${sql020}`;

const CHECK_019 = "CHECK (answer_delivery_attempted_at IS NULL OR (status = 'captured' AND delivery_tracking_enabled))";

describe("the runner accepts them", () => {
  const migrations = listMigrations() as Array<{ filename: string; number: number; legacy: boolean; sql: string }>;

  it("they are the next two numbers, with no gap, after 018", () => {
    const names = migrations.map((m) => m.filename);
    expect(names.slice(-3)).toEqual(["018_webhook_missing_user_review.sql", FILE_019, FILE_020]);
    expect(migrations.map((m) => m.number)).toEqual(migrations.map((_, i) => i + 1));
  });

  it("they run inside the runner's transaction: not legacy, and no transaction control of their own", () => {
    for (const name of [FILE_019, FILE_020]) {
      const migration = migrations.find((m) => m.filename === name)!;
      expect(migration.legacy).toBe(false);
      // The runner's own rule (migrator.mjs, TX_CONTROL) refuses these lines.
      expect(migration.sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;\s*$/im);
    }
  });

  it("each bounds how long it waits for its locks, so it fails instead of queueing reservations behind it", () => {
    expect(sql019).toMatch(/^SET LOCAL lock_timeout = '3s';/);
    expect(sql020).toMatch(/^SET LOCAL lock_timeout = '3s';/);
  });
});

describe("019: tracking fields on ai_credit_holds", () => {
  it("the timestamp is nullable, with no default, so nothing is ever recorded by the migration", () => {
    expect(sql019).toContain("ADD COLUMN IF NOT EXISTS answer_delivery_attempted_at TIMESTAMPTZ;");
  });

  it("tracking is off unless a reservation turns it on, so historical rows can never become eligible", () => {
    expect(sql019).toContain("ADD COLUMN IF NOT EXISTS delivery_tracking_enabled BOOLEAN NOT NULL DEFAULT false");
    // A constant default is stored as metadata. A volatile one would rewrite the table.
    expect(sql019).not.toMatch(/DEFAULT\s+(true|now\(\)|clock_timestamp)/i);
    expect(sql019).not.toMatch(/\bUPDATE\s+ai_credit_holds\b/i);
  });

  it("the constraint requires the captured state, is skipped on existing rows at add time, and is guarded for a re-run", () => {
    expect(sql019).toContain(`ADD CONSTRAINT ai_credit_holds_delivery_attempt_consistent ${CHECK_019} NOT VALID;`);
    expect(sql019).toContain("conname = 'ai_credit_holds_delivery_attempt_consistent'");
    expect(sql019).toContain("conrelid = 'ai_credit_holds'::regclass");
  });

  it("the column's comment says what it does not prove", () => {
    expect(read(FILE_019)).toMatch(/COMMENT ON COLUMN ai_credit_holds\.answer_delivery_attempted_at IS\s+'[^']*does not prove[^']*'/i);
  });

  it("it adds nothing else to the hold, and no review field at all", () => {
    expect(sql019.match(/ADD COLUMN/g)).toHaveLength(2);
    expect(both).not.toMatch(/ai_credit_holds\s+ADD COLUMN[^;]*review/i);
  });
});

describe("020: the operational review table", () => {
  const table = /CREATE TABLE IF NOT EXISTS ai_delivery_gap_reviews \((.*?)\);/.exec(sql020)?.[1] ?? "";

  it("validates 019's constraint in its own transaction, before it takes any stronger lock", () => {
    const validate = sql020.indexOf("ALTER TABLE ai_credit_holds VALIDATE CONSTRAINT ai_credit_holds_delivery_attempt_consistent;");
    expect(validate).toBeGreaterThan(-1);
    expect(validate).toBeLessThan(sql020.indexOf("CREATE TABLE"));
  });

  it("one review per reservation, tied to that exact reservation", () => {
    expect(table).toContain("PRIMARY KEY (user_id, reference_id)");
    expect(table).toContain("FOREIGN KEY (user_id, reference_id) REFERENCES ai_credit_holds (user_id, reference_id) ON DELETE RESTRICT");
    expect(table).toContain("user_id UUID NOT NULL");
    expect(table).toContain("reference_id VARCHAR(255) NOT NULL");
  });

  it("the outcome is a closed list that includes inconclusive", () => {
    expect(table).toContain("CHECK (outcome IN ('acknowledgement_outage', 'confirmed_withheld', 'inconclusive', 'goodwill_credited'))");
    expect(table).toContain("outcome VARCHAR(32) NOT NULL");
  });

  it("there is no free text: no note column, no TEXT type, and a reviewer that cannot hold an e-mail address", () => {
    expect(table).not.toMatch(/\bnote\b/i);
    expect(table).not.toMatch(/\bTEXT\b/i);
    expect(table).toContain("CHECK (reviewer ~ '^[a-z0-9._-]{2,32}$')");
    expect("someone@example.test").not.toMatch(/^[a-z0-9._-]{2,32}$/);
    expect("a.b-c_1").toMatch(/^[a-z0-9._-]{2,32}$/);
  });
});

describe("what neither migration may do", () => {
  it("no index: the runner's transaction rules out CONCURRENTLY, and a plain build would block reservations", () => {
    expect(both).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(both).not.toMatch(/CONCURRENTLY/i);
  });

  it("no grant: the review table is owner-only, because a new table gets none by default", () => {
    expect(both).not.toMatch(/\bGRANT\b/i);
    expect(sql020).toContain("REVOKE ALL ON ai_delivery_gap_reviews FROM PUBLIC;");
    expect(both).not.toMatch(/moleculestudio_app/i);
  });

  it("the app role's script does not mention the review table and grants nothing by wildcard", () => {
    const appRole = fs.readFileSync(new URL("../../../../database/roles/app-role.sql", import.meta.url), "utf8");
    expect(appRole).not.toContain("ai_delivery_gap_reviews");
    expect(appRole).not.toMatch(/ALL\s+TABLES/i);
    expect(appRole).not.toMatch(/DEFAULT\s+PRIVILEGES/i);
  });

  it("no ledger, balance or settlement object is named", () => {
    expect(both).not.toMatch(/credit_ledger_transactions|user_balances|post_credit_transaction|release_expired_ai_holds|ledger_reconciliation/i);
  });

  it("no data is changed, and nothing is dropped", () => {
    expect(both).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN|CONSTRAINT|FUNCTION|TRIGGER))\b/i);
    expect(both).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
  });

  it("no function or trigger: the reconciliation query belongs to a later part", () => {
    expect(both).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER)/i);
  });

  it("the settlement status is not altered: only ai_credit_holds' two new columns and its one new constraint", () => {
    const alters = [...both.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]);
    expect(new Set(alters)).toEqual(new Set(["ai_credit_holds"]));
    expect(both).not.toMatch(/DROP CONSTRAINT|ai_credit_holds_status_valid|ai_credit_holds_settlement_consistent/);
  });
});
