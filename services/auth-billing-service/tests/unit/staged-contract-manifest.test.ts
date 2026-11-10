/**
 * The staged Phase 2C V7 database-contract corpus (database/staged/phase-2c-v7/), as text. Every file is read, hashed and
 * compared, never applied: this test contacts no database, reads nothing outside the repository, and does not depend on
 * the plans folder or the archived harness.
 *
 * It is driven by MANIFEST.json, so it asserts only the files the manifest lists and is valid at any point in the corpus's
 * history. Rules that only make sense once the corpus is complete are in the last block. The checks are pure functions
 * (manifestProblems, directoryProblems, completenessProblems) so that each rule is also shown to reject bad input.
 *
 * The comment stripper it uses (tests/support/sql-comment-stripper.ts) is a narrow tool for this fixed corpus. It is not
 * a general-purpose PostgreSQL SQL parser.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_MIGRATIONS_DIR, listMigrations } from "../../scripts/lib/migrator.mjs";
import {
  normaliseLineEndings,
  normalisedSha256,
  sha256Hex,
  stripSqlComments,
  strippedSha256,
  UnsupportedSqlError,
} from "../support/sql-comment-stripper";

const STAGED_DIR = fileURLToPath(new URL("../../../../database/staged/phase-2c-v7/", import.meta.url));
const INIT_DIR = path.resolve(String(DEFAULT_MIGRATIONS_DIR));

const KINDS = ["migration", "role-creation", "role-grants", "role-transition", "verification"] as const;
const STEPS = ["S2", "S3", "S4", "S6", "S7", "S10", "verify"] as const;
type Kind = (typeof KINDS)[number];
type Step = (typeof STEPS)[number];

const SHA = /^[0-9a-f]{64}$/;
const SQL_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/;
const POINT_OF_NO_RETURN_FILE = "S10-R-app-role-transition.sql";
const NON_SQL_FILES = ["MANIFEST.json", "README.md"];

const TOP_KEYS = ["schemaVersion", "corpus", "status", "normalisation", "evidenceWording", "deploymentDocument", "entries"];
const NORMALISATION_KEYS = ["lineEndings", "stripper"];
const DOCUMENT_KEYS = ["file", "sha256"];
const ENTRY_KEYS = ["file", "kind", "step", "originalSource", "originalSha256", "sha256", "strippedSha256", "pointOfNoReturn"];

/** The agreed classification: what a staged file's name says about its kind and its deployment step. */
const CLASSIFICATION: Array<{ pattern: RegExp; kind: Kind; step: Step }> = [
  { pattern: /^021_v4_[A-Za-z0-9_]+\.sql$/, kind: "migration", step: "S2" },
  { pattern: /^022_v4_[A-Za-z0-9_]+\.sql$/, kind: "migration", step: "S4" },
  { pattern: /^S3-[A-Za-z0-9-]+\.sql$/, kind: "role-creation", step: "S3" },
  { pattern: /^S6-[A-Za-z0-9-]+\.sql$/, kind: "role-grants", step: "S6" },
  { pattern: /^S7-[A-Za-z0-9-]+\.sql$/, kind: "role-grants", step: "S7" },
  { pattern: /^S10-R-[A-Za-z0-9-]+\.sql$/, kind: "role-transition", step: "S10" },
  { pattern: /^verify-[A-Za-z0-9-]+\.sql$/, kind: "verification", step: "verify" },
];
const classify = (file: string): { kind: Kind; step: Step } | null => {
  const hit = CLASSIFICATION.find((c) => c.pattern.test(file));
  return hit ? { kind: hit.kind, step: hit.step } : null;
};

/** The source hashes recorded when V7 was verified. Pinned so the manifest cannot drift from them without a failure. */
const ORIGINAL_SHA256: Record<string, string> = {
  "021_v4_delivery_guard_and_reconciliation.sql": "3f1d0879230172f3548e19dc599de9d755497738bb99b2efc94cd32cfa297167",
  "022_v4_ledger_and_settlement_security.sql": "6c185a3608226814c6e20ca5315a5acd0764f7fad822025f7b6c5450be92558c",
  "S3-ack-role-creation.sql": "faba1da5b8ab72e94cb893e703650452e871c71de4fa7c586a649aba29f56d04",
  "S3-webhook-role-creation.sql": "96a8c14ce0b07b63e9b930d350f865b419f20af9dde35c720d5aaec8ba4ac66c",
  "S6-webhook-role-privileges.sql": "3918aa236a844fb4b4c04fd8b19241160fbbec45637b8c45d248cca50b0add85",
  "S6-ack-role-deployment.sql": "72607d8b207744f59400267d8eb36d110c53de8ca8b816c0f3bc7bc1388f4747",
  "S7-R0-app-role-additive-grants.sql": "b3dc400e6e29d0a5322d8a71b4c247058a5e52fae797ea2d4cdecb58e7e67204",
  "S10-R-app-role-transition.sql": "23c26808253da60b7fee50bdb1c21916b5da88d87087877b26a2fadb97a70dd2",
  "verify-roles-and-final.sql": "a88de6de1299c86a45242a9dc0d5a2fba76179cda9e19588b8cd88f488d37b7a",
};
const FILES_BY_STEP: Record<Step, string[]> = {
  S2: ["021_v4_delivery_guard_and_reconciliation.sql"],
  S4: ["022_v4_ledger_and_settlement_security.sql"],
  S3: ["S3-ack-role-creation.sql", "S3-webhook-role-creation.sql"],
  S6: ["S6-ack-role-deployment.sql", "S6-webhook-role-privileges.sql"],
  S7: ["S7-R0-app-role-additive-grants.sql"],
  S10: [POINT_OF_NO_RETURN_FILE],
  verify: ["verify-roles-and-final.sql"],
};

interface ManifestEntry {
  file: string;
  kind: Kind;
  step: Step;
  originalSource: string;
  originalSha256: string;
  sha256: string;
  strippedSha256: string;
  pointOfNoReturn?: true;
}
interface Manifest {
  schemaVersion: 1;
  corpus: "phase-2c-v7";
  entries: ManifestEntry[];
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const unknownKeys = (value: Record<string, unknown>, allowed: string[], where: string): string[] =>
  Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${where} has an unknown key: ${key}`);

/** Every reason the manifest is not well formed (empty when it is). Needs no file system. */
function manifestProblems(value: unknown): string[] {
  if (!isRecord(value)) return ["the manifest is not an object"];
  const problems: string[] = [...unknownKeys(value, TOP_KEYS, "the manifest")];
  if (value.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (value.corpus !== "phase-2c-v7") problems.push("corpus must be phase-2c-v7");
  if (!isText(value.status)) problems.push("status must be a non-empty string");
  if (!isText(value.evidenceWording)) problems.push("evidenceWording must be a non-empty string");

  const norm = value.normalisation;
  if (!isRecord(norm) || !isText(norm.lineEndings) || !isText(norm.stripper)) problems.push("normalisation must describe lineEndings and stripper");
  else problems.push(...unknownKeys(norm, NORMALISATION_KEYS, "normalisation"));

  const doc = value.deploymentDocument;
  if (!isRecord(doc) || !isText(doc.file) || typeof doc.sha256 !== "string" || !SHA.test(doc.sha256)) {
    problems.push("deploymentDocument needs a file and a SHA-256");
  } else {
    problems.push(...unknownKeys(doc, DOCUMENT_KEYS, "deploymentDocument"));
  }

  if (!Array.isArray(value.entries)) return [...problems, "entries must be an array"];

  const seen = new Set<string>();
  value.entries.forEach((raw: unknown, i: number) => {
    const where = `entries[${i}]`;
    if (!isRecord(raw)) {
      problems.push(`${where} is not an object`);
      return;
    }
    const e = raw;
    problems.push(...unknownKeys(e, ENTRY_KEYS, where));

    const file = typeof e.file === "string" ? e.file : "";
    if (!SQL_FILE.test(file)) problems.push(`${where}.file must be a plain .sql file name`);
    else if (seen.has(file)) problems.push(`${where}.file is listed twice: ${file}`);
    else seen.add(file);

    if (!KINDS.includes(e.kind as Kind)) problems.push(`${where}.kind is not one of ${KINDS.join(", ")}`);
    if (!STEPS.includes(e.step as Step)) problems.push(`${where}.step is not one of ${STEPS.join(", ")}`);
    if (SQL_FILE.test(file)) {
      const expected = classify(file);
      if (!expected) problems.push(`${where}.file does not follow the staged naming scheme: ${file}`);
      else {
        if (e.kind !== expected.kind) problems.push(`${where}.kind must be ${expected.kind} for ${file}`);
        if (e.step !== expected.step) problems.push(`${where}.step must be ${expected.step} for ${file}`);
      }
    }

    if (!isText(e.originalSource)) problems.push(`${where}.originalSource must be a non-empty string`);
    for (const key of ["originalSha256", "sha256", "strippedSha256"]) {
      const v = e[key];
      if (typeof v !== "string" || !SHA.test(v)) problems.push(`${where}.${key} must be 64 lowercase hex characters`);
    }

    const isR = file === POINT_OF_NO_RETURN_FILE;
    if ("pointOfNoReturn" in e && e.pointOfNoReturn !== true) problems.push(`${where}.pointOfNoReturn may only be true, or absent`);
    if (isR && e.pointOfNoReturn !== true) problems.push(`${where} is the R transition and must carry pointOfNoReturn: true`);
    if (!isR && "pointOfNoReturn" in e) problems.push(`${where}: only ${POINT_OF_NO_RETURN_FILE} may carry pointOfNoReturn`);
  });
  return problems;
}

/** What is wrong between the manifest and the folder's file list: a missing file, an unlisted .sql file, anything else. */
function directoryProblems(listed: Array<{ file: string }>, filesOnDisk: string[]): string[] {
  const problems: string[] = [];
  const names = new Set(listed.map((e) => e.file));
  for (const name of names) if (!filesOnDisk.includes(name)) problems.push(`${name} is listed in the manifest but does not exist`);
  for (const file of filesOnDisk) {
    if (names.has(file) || NON_SQL_FILES.includes(file)) continue;
    problems.push(file.endsWith(".sql") ? `${file} is a .sql file that the manifest does not list` : `${file} is not part of the corpus`);
  }
  return problems;
}

/** What is wrong with a corpus that is meant to be complete. Independent of the order of the entries. */
function completenessProblems(entries: ManifestEntry[]): string[] {
  const problems: string[] = [];
  const expectedFiles = Object.keys(ORIGINAL_SHA256).sort();
  const files = entries.map((e) => e.file).sort();
  if (entries.length !== expectedFiles.length) problems.push(`expected ${expectedFiles.length} entries, found ${entries.length}`);
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) problems.push("the entries are not exactly the nine expected files");
  for (const entry of entries) {
    if (ORIGINAL_SHA256[entry.file] !== entry.originalSha256) problems.push(`${entry.file}: originalSha256 is not the recorded V7 source hash`);
  }
  for (const step of STEPS) {
    const here = entries.filter((e) => e.step === step).map((e) => e.file).sort();
    if (here.length === 0) problems.push(`step ${step} is not represented`);
    else if (JSON.stringify(here) !== JSON.stringify([...FILES_BY_STEP[step]].sort())) problems.push(`step ${step} holds the wrong files: ${here.join(", ")}`);
  }
  const flagged = entries.filter((e) => e.pointOfNoReturn === true).map((e) => e.file);
  if (flagged.length !== 1 || flagged[0] !== POINT_OF_NO_RETURN_FILE) problems.push(`exactly ${POINT_OF_NO_RETURN_FILE} must carry pointOfNoReturn (found: ${flagged.join(", ") || "none"})`);
  return problems;
}

function loadManifest(): { manifest: Manifest | null; raw: unknown } {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(STAGED_DIR, "MANIFEST.json"), "utf8"));
    return { manifest: manifestProblems(raw).length === 0 ? (raw as Manifest) : null, raw };
  } catch {
    return { manifest: null, raw: null };
  }
}
const { manifest, raw: rawManifest } = loadManifest();
const entries: ManifestEntry[] = manifest?.entries ?? [];

/** Every file under the staged folder, as forward-slash paths relative to it. */
const stagedFiles = (): string[] =>
  (fs.readdirSync(STAGED_DIR, { recursive: true }) as string[])
    .map((f) => String(f).split(path.sep).join("/"))
    .filter((f) => fs.statSync(path.join(STAGED_DIR, f)).isFile())
    .sort();

// ---------------------------------------------------------------------------------------------------------------------
describe("the comment stripper, on synthetic SQL only", () => {
  const strip = stripSqlComments;

  it("removes -- comments outside strings and keeps what comes before them", () => {
    expect(strip("SELECT 1; -- gone\nSELECT 2;")).toBe("SELECT 1;\nSELECT 2;");
    expect(strip("-- only a comment\n")).toBe("");
  });

  it("removes nested block comments outside protected regions", () => {
    expect(strip("SELECT /* a /* b */ c */ 1;")).toBe("SELECT  1;");
    expect(strip("/* header\n   over lines */\nSELECT 1;")).toBe("SELECT 1;");
    expect(strip("SELECT 1; /* one\n /* two\n */ three\n */\nSELECT 2;")).toBe("SELECT 1;\nSELECT 2;");
    expect(strip("SELECT '/* kept */' /* gone */;")).toBe("SELECT '/* kept */' ;");
  });

  it("keeps single-quoted strings exactly, including comment markers and doubled quotes", () => {
    expect(strip("SELECT 'a -- b';")).toBe("SELECT 'a -- b';");
    expect(strip("SELECT '/* x */', '--';")).toBe("SELECT '/* x */', '--';");
    expect(strip("SELECT 'it''s -- fine'; -- gone")).toBe("SELECT 'it''s -- fine';");
  });

  it("keeps double-quoted identifiers exactly", () => {
    expect(strip('SELECT "a--b" FROM "t""x"; -- gone')).toBe('SELECT "a--b" FROM "t""x";');
  });

  it("keeps dollar-quoted bodies exactly, comments inside them included (they are frozen with the body)", () => {
    const body = "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$\nBEGIN\n  -- keep\n  RETURN 1; /* keep */\nEND\n$$;";
    expect(strip(`-- header\n${body}\n-- trailer`)).toBe(body);
    expect(strip("SELECT $a$ x -- y $$ z $a$; -- gone")).toBe("SELECT $a$ x -- y $$ z $a$;");
  });

  it("does not mistake a positional parameter or an identifier containing $ for a dollar quote", () => {
    expect(strip("SELECT $1 -- c\n")).toBe("SELECT $1");
    expect(strip("SELECT a$b -- c\n")).toBe("SELECT a$b");
    expect(strip("SELECT ident$$ -- c\n")).toBe("SELECT ident$$");
  });

  it("normalises CRLF to LF, and whitespace between statements", () => {
    expect(strip("a  \r\n\r\nb\r\n")).toBe("a\nb");
    expect(strip("a  \n\n\n b\t\n")).toBe("a\n b");
    expect(strip("SELECT 1;\n\n\nSELECT 2;   \n")).toBe("SELECT 1;\nSELECT 2;");
    expect(normaliseLineEndings("x\r\ny\r\n")).toBe("x\ny\n");
    expect(normalisedSha256("x\r\ny\r\n")).toBe(normalisedSha256("x\ny\n"));
    expect(strippedSha256("SELECT 1; -- c\r\n")).toBe(strippedSha256("SELECT 1; -- c\n"));
    expect(normalisedSha256("x\n")).toBe(sha256Hex("x\n"));
  });

  it("is idempotent", () => {
    const text = "-- h\nSELECT 'a -- b'; /* c */\nSELECT $$ -- x\n\n $$;  \n";
    expect(strip(strip(text))).toBe(strip(text));
  });

  describe("protected regions are kept byte for byte (after CRLF to LF)", () => {
    const body = "$$\n  a  \n\n\n\tb\t\n$$";

    it("a dollar-quoted body keeps its blank lines, trailing spaces and tabs", () => {
      expect(strip(`SELECT 1; ${body};`)).toBe(`SELECT 1; ${body};`);
    });

    it("a multi-line string literal and a quoted identifier keep theirs", () => {
      const text = "SELECT 'x  \n\n  y', \"Q  \n z\";";
      expect(strip(text)).toBe(text);
    });

    it("CRLF inside a protected region is normalised to LF, and nothing else about it changes", () => {
      const lf = `SELECT 1; ${body}; SELECT 'p  \n q';`;
      expect(strip(lf.replace(/\n/g, "\r\n"))).toBe(strip(lf));
      expect(strip(lf.replace(/\n/g, "\r\n"))).toContain("$$\n  a  \n\n\n\tb\t\n$$");
    });

    it("whitespace right after a protected region, and blank lines after it, are still normalised", () => {
      expect(strip("SELECT $$ x $$;   \n\n\nSELECT 2;")).toBe("SELECT $$ x $$;\nSELECT 2;");
      expect(strip("SELECT 'a'   \n\n  SELECT 'b'")).toBe("SELECT 'a'\n  SELECT 'b'");
    });
  });

  describe("what changes the hash", () => {
    const base = [
      "-- header: provenance v1",
      "CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$",
      "BEGIN",
      "  -- body comment",
      "  RETURN 1;",
      "END",
      "$$;",
      "SELECT 'a -- b' AS s; -- trailing",
      "",
    ].join("\n");
    const hash = strippedSha256(base);

    it("a header or trailing comment change, an added comment and CRLF do not", () => {
      expect(strippedSha256(base.replace("provenance v1", "provenance v2, reviewed"))).toBe(hash);
      expect(strippedSha256(`-- one more line\n/* and a block */\n${base}`)).toBe(hash);
      expect(strippedSha256(base.replace("-- trailing", "-- other words"))).toBe(hash);
      expect(strippedSha256(base.replace(/\n/g, "\r\n"))).toBe(hash);
    });

    it("blank lines and trailing spaces between statements do not", () => {
      // A replacer function: in a replacement string, "$$" would mean a single "$".
      expect(strippedSha256(base.replace("$$;\n", () => "$$;   \n\n\n"))).toBe(hash);
    });

    it("an executable change does", () => {
      expect(strippedSha256(base.replace("RETURN 1;", "RETURN 2;"))).not.toBe(hash);
      expect(strippedSha256(base.replace("SELECT 'a", "SELECT  'a"))).not.toBe(hash);
    });

    it("a string-literal change does", () => {
      expect(strippedSha256(base.replace("'a -- b'", "'a -- c'"))).not.toBe(hash);
    });

    it("a change to a comment inside a dollar-quoted body does", () => {
      expect(strippedSha256(base.replace("-- body comment", "-- edited body comment"))).not.toBe(hash);
    });

    it("adding or removing a blank line inside a dollar-quoted body does", () => {
      expect(strippedSha256(base.replace("BEGIN\n", "BEGIN\n\n"))).not.toBe(hash);
      expect(strippedSha256(base.replace("  RETURN 1;\n", "  RETURN 1;\n\n\n"))).not.toBe(hash);
      const withBlank = base.replace("BEGIN\n", "BEGIN\n\n");
      expect(strippedSha256(withBlank.replace("BEGIN\n\n", "BEGIN\n"))).toBe(hash);
    });

    it("trailing spaces inside a dollar-quoted body do", () => {
      expect(strippedSha256(base.replace("RETURN 1;", "RETURN 1;   "))).not.toBe(hash);
    });

    it("changing spaces inside a multi-line string literal does", () => {
      const text = "SELECT 'line one\n  line two' AS s;\n";
      const h = strippedSha256(text);
      expect(strippedSha256(text.replace("  line two", "   line two"))).not.toBe(h);
      expect(strippedSha256(text.replace("line one\n", "line one  \n"))).not.toBe(h);
      expect(strippedSha256(text.replace("line one\n", "line one\n\n"))).not.toBe(h);
    });
  });

  describe("where a dollar quote opens is decided from the source", () => {
    it("a comment between an identifier and the opener would glue them together, so it is refused", () => {
      expect(() => stripSqlComments("SELECT ident/*comment*/$$ -- keep\n$$;")).toThrow(UnsupportedSqlError);
      expect(() => stripSqlComments("SELECT 1/*c*/$$ x $$;")).toThrow(UnsupportedSqlError);
      expect(() => stripSqlComments("SELECT ident-- c\n$$ x $$;")).not.toThrow();
    });

    it("a comment with a gap on either side leaves the quote recognised and its body untouched", () => {
      expect(stripSqlComments("SELECT x /*comment*/ $$ -- keep\n$$;")).toBe("SELECT x  $$ -- keep\n$$;");
      expect(stripSqlComments("SELECT x\n/*comment*/$$ -- keep\n$$;")).toBe("SELECT x\n$$ -- keep\n$$;");
      expect(stripSqlComments("SELECT 'a'/*c*/$$ -- keep\n$$;")).toBe("SELECT 'a'$$ -- keep\n$$;");
    });

    it("an identifier directly followed by $$ is an identifier, not an opener", () => {
      expect(stripSqlComments("SELECT ident$$ -- gone\n")).toBe("SELECT ident$$");
    });
  });

  describe("what it refuses instead of guessing", () => {
    it.each([
      ["an escape string", "SELECT E'a\\nb';"],
      ["a lower-case escape string", "SELECT e'a';"],
      ["a Unicode-escape string", "SELECT U&'a';"],
      ["an unterminated string", "SELECT 'abc"],
      ["an unterminated identifier", 'SELECT "abc'],
      ["an unterminated block comment", "SELECT /* x"],
      ["an unterminated dollar quote", "SELECT $$ x"],
      ["a comment between an identifier and a dollar-quote opener", "SELECT ident/*c*/$$ x $$;"],
    ])("%s", (_name, sql) => {
      expect(() => stripSqlComments(sql)).toThrow(UnsupportedSqlError);
    });

    it("but not an identifier or type name that merely ends in the letter e", () => {
      expect(stripSqlComments("SELECT DATE'2020-01-01'; -- c")).toBe("SELECT DATE'2020-01-01';");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the manifest schema validator", () => {
  const good = {
    schemaVersion: 1,
    corpus: "phase-2c-v7",
    status: "staged",
    evidenceWording: "words",
    normalisation: { lineEndings: "x", stripper: "y" },
    deploymentDocument: { file: "d.md", sha256: "a".repeat(64) },
    entries: [
      {
        file: "021_v4_x.sql",
        kind: "migration",
        step: "S2",
        originalSource: "src.sql",
        originalSha256: "b".repeat(64),
        sha256: "b".repeat(64),
        strippedSha256: "c".repeat(64),
      },
    ],
  };
  const entry = (patch: Record<string, unknown>) => ({ ...good.entries[0], ...patch });
  const withEntry = (patch: Record<string, unknown>) => ({ ...good, entries: [entry(patch)] });
  const rEntry = (patch: Record<string, unknown> = {}) =>
    entry({ file: POINT_OF_NO_RETURN_FILE, kind: "role-transition", step: "S10", pointOfNoReturn: true, ...patch });

  it("accepts a well-formed manifest, with and without entries, and with the R transition flagged", () => {
    expect(manifestProblems(good)).toEqual([]);
    expect(manifestProblems({ ...good, entries: [] })).toEqual([]);
    expect(manifestProblems({ ...good, entries: [good.entries[0], rEntry()] })).toEqual([]);
  });

  it.each([
    ["not an object", [] as unknown],
    ["a wrong schema version", { ...good, schemaVersion: 2 }],
    ["a wrong corpus", { ...good, corpus: "other" }],
    ["a missing status", { ...good, status: "" }],
    ["no entries array", { ...good, entries: {} }],
    ["an unknown top-level property", { ...good, extra: 1 }],
    ["an unknown property in normalisation", { ...good, normalisation: { ...good.normalisation, extra: 1 } }],
    ["an unknown property in deploymentDocument", { ...good, deploymentDocument: { ...good.deploymentDocument, extra: 1 } }],
    ["an unknown entry property", withEntry({ extra: 1 })],
    ["a path in a file name", withEntry({ file: "sub/021_v4_x.sql" })],
    ["a non-SQL file name", withEntry({ file: "021_v4_x.txt" })],
    ["a file name outside the naming scheme", withEntry({ file: "other.sql" })],
    ["an unknown kind", withEntry({ kind: "other" })],
    ["a kind that does not fit the file name", withEntry({ kind: "role-grants" })],
    ["an unknown step", withEntry({ step: "S99" })],
    ["a step that does not fit the file name", withEntry({ step: "S4" })],
    ["a short hash", withEntry({ sha256: "abc" })],
    ["an upper-case hash", withEntry({ strippedSha256: "A".repeat(64) })],
    ["a missing source name", withEntry({ originalSource: "" })],
    ["a false point-of-no-return flag", rEntry({ pointOfNoReturn: false })],
    ["a point-of-no-return flag on a file that is not S10", withEntry({ pointOfNoReturn: true })],
    ["the R transition without the point-of-no-return flag", entry({ file: POINT_OF_NO_RETURN_FILE, kind: "role-transition", step: "S10" })],
    ["a duplicate file", { ...good, entries: [good.entries[0], good.entries[0]] }],
  ])("rejects %s", (_name, value) => {
    expect(manifestProblems(value).length).toBeGreaterThan(0);
  });

  it("every file name in the corpus follows the naming scheme, with the kind and step it implies", () => {
    for (const file of Object.keys(ORIGINAL_SHA256)) expect(classify(file), file).not.toBeNull();
    expect(classify("S3-ack-role-creation.sql")).toEqual({ kind: "role-creation", step: "S3" });
    expect(classify(POINT_OF_NO_RETURN_FILE)).toEqual({ kind: "role-transition", step: "S10" });
    expect(classify("S10-x.sql")).toBeNull();
  });
});

describe("the folder-against-manifest check", () => {
  const listed = [{ file: "021_v4_x.sql" }, { file: "S3-a.sql" }];
  const onDisk = ["021_v4_x.sql", "MANIFEST.json", "README.md", "S3-a.sql"];

  it("accepts a folder that holds exactly the README, the manifest and the listed files", () => {
    expect(directoryProblems(listed, onDisk)).toEqual([]);
    expect(directoryProblems([], ["MANIFEST.json", "README.md"])).toEqual([]);
  });

  it("rejects a listed file that is missing", () => {
    expect(directoryProblems(listed, ["021_v4_x.sql", "MANIFEST.json", "README.md"])).toEqual(["S3-a.sql is listed in the manifest but does not exist"]);
  });

  it("rejects an extra .sql file", () => {
    expect(directoryProblems(listed, [...onDisk, "extra.sql"])).toEqual(["extra.sql is a .sql file that the manifest does not list"]);
    expect(directoryProblems(listed, [...onDisk, "sub/extra.sql"])).toHaveLength(1);
  });

  it("rejects any other stray file", () => {
    expect(directoryProblems(listed, [...onDisk, "notes.txt"])).toEqual(["notes.txt is not part of the corpus"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the staged folder", () => {
  it("has a well-formed manifest", () => {
    expect(manifestProblems(rawManifest)).toEqual([]);
    expect(manifest).not.toBeNull();
  });

  it("holds exactly the README, the manifest and the files the manifest lists: every .sql file is represented, none is missing", () => {
    expect(directoryProblems(entries, stagedFiles())).toEqual([]);
  });

  it("places no staged file in database/init, and the runner cannot see any", () => {
    const initFiles = fs.readdirSync(INIT_DIR);
    for (const entry of entries) {
      expect(initFiles, `${entry.file} must not be in database/init`).not.toContain(entry.file);
      expect(fs.existsSync(path.join(INIT_DIR, entry.file))).toBe(false);
    }
    expect(initFiles).not.toContain("staged");
    expect(path.relative(INIT_DIR, STAGED_DIR).startsWith("..")).toBe(true);
    const seenByRunner = (listMigrations() as Array<{ filename: string }>).map((m) => m.filename);
    for (const entry of entries) expect(seenByRunner).not.toContain(entry.file);
  });

  describe("the README", () => {
    const readme = fs.readFileSync(path.join(STAGED_DIR, "README.md"), "utf8");

    it("states its policy", () => {
      expect(readme).toMatch(/not applied by the migration runner/i);
      expect(readme).toMatch(/not production-approved/i);
      expect(readme).toMatch(/point-of-no-return/i);
      expect(readme).toContain("S10");
      expect(readme).toMatch(/not a general-purpose PostgreSQL SQL parser/i);
      expect(readme).toMatch(/separate, separately authorised phase/i);
      expect(readme).toMatch(/independent PostgreSQL reviewer/i);
    });

    it("explains the V7 role-name substitution and that the real role names are not yet verified", () => {
      expect(readme).toContain("moleculestudio_");
      expect(readme).toContain("v7v_20261109_");
      expect(readme).toMatch(/real role names/i);
      expect(readme).toMatch(/have \*\*not\*\* themselves been run/i);
    });

    it("describes the runner accurately: a default, not an exclusive rule", () => {
      expect(readme).not.toMatch(/runner reads only/i);
      expect(readme).toMatch(/defaults to `database\/init`/i);
      expect(readme).toMatch(/explicit\s+directory/i);
      expect(readme).toMatch(/not applied merely because they exist/i);
    });

    it("warns about the historical headers and gives the deployment order", () => {
      expect(readme).toMatch(/historical headers/i);
      expect(readme).toMatch(/Do not repeat those statements/i);
      expect(readme).toMatch(/S2[\s\S]*S3[\s\S]*S4[\s\S]*S6[\s\S]*S7[\s\S]*S10/);
      expect(readme).toMatch(/does not\s+replace that document/i);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("each staged file", () => {
  it(`is one of the ${entries.length} the manifest lists`, () => {
    expect(entries.map((e) => e.file)).toEqual([...new Set(entries.map((e) => e.file))]);
  });

  for (const entry of entries) {
    describe(entry.file, () => {
      const file = path.join(STAGED_DIR, entry.file);

      it("exists and is a regular file", () => {
        expect(fs.statSync(file).isFile()).toBe(true);
      });

      it("is UTF-8 without a byte-order mark, and is not empty", () => {
        const bytes = fs.readFileSync(file);
        expect(bytes.length).toBeGreaterThan(0);
        expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
        expect(Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)).toBe(true);
      });

      it("has the full-content hash the manifest records (CRLF normalised to LF)", () => {
        expect(normalisedSha256(fs.readFileSync(file))).toBe(entry.sha256);
      });

      it("has the comment-stripped hash the manifest records", () => {
        expect(strippedSha256(fs.readFileSync(file))).toBe(entry.strippedSha256);
      });

      it("carries the point-of-no-return flag if and only if it is the R transition", () => {
        const isR = entry.file === POINT_OF_NO_RETURN_FILE;
        expect(entry.pointOfNoReturn === true).toBe(isR);
        expect("pointOfNoReturn" in entry).toBe(isR);
        expect(entry.kind === "role-transition").toBe(isR);
        expect(entry.step === "S10").toBe(isR);
      });
    });
  }
});

describe("the point-of-no-return flag", () => {
  it("is on at most one entry, and that entry is the R transition", () => {
    const flagged = entries.filter((e) => e.pointOfNoReturn === true).map((e) => e.file);
    expect(flagged.length).toBeLessThanOrEqual(1);
    for (const file of flagged) expect(file).toBe(POINT_OF_NO_RETURN_FILE);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Only meaningful once the whole V7 corpus is staged (Step 7.2, group G2). The source hashes are those recorded when V7 was
// verified; they are pinned above so the manifest cannot drift from them without this test saying so.
describe("the complete V7 corpus", () => {
  it("has exactly nine entries and nine .sql files, the pinned source hashes, every step, and one flag, on S10", () => {
    expect(completenessProblems(entries)).toEqual([]);
    expect(stagedFiles().filter((f) => f.endsWith(".sql"))).toHaveLength(9);
    expect(entries.filter((e) => e.pointOfNoReturn === true).map((e) => e.file)).toEqual([POINT_OF_NO_RETURN_FILE]);
    expect(entries.filter((e) => "pointOfNoReturn" in e)).toHaveLength(1);
  });

  it("does not depend on the order of the manifest entries", () => {
    expect(completenessProblems([...entries].reverse())).toEqual([]);
    expect(completenessProblems([...entries].sort((a, b) => b.step.localeCompare(a.step)))).toEqual([]);
  });

  describe("and refuses an incomplete or altered one", () => {
    const without = (file: string) => entries.filter((e) => e.file !== file);

    it("a missing entry, whichever it is", () => {
      for (const file of Object.keys(ORIGINAL_SHA256)) expect(completenessProblems(without(file)).length, file).toBeGreaterThan(0);
    });

    it("an extra entry", () => {
      const extra: ManifestEntry = { ...entries[0]!, file: "S7-extra.sql", kind: "role-grants", step: "S7" };
      expect(completenessProblems([...entries, extra]).length).toBeGreaterThan(0);
    });

    it("a changed source hash", () => {
      const changed = entries.map((e) => (e.file === "S7-R0-app-role-additive-grants.sql" ? { ...e, originalSha256: "0".repeat(64) } : e));
      expect(completenessProblems(changed).length).toBeGreaterThan(0);
    });

    it("a file moved to another step", () => {
      const moved = entries.map((e) => (e.file === "S6-ack-role-deployment.sql" ? { ...e, step: "S7" as Step } : e));
      expect(completenessProblems(moved).length).toBeGreaterThan(0);
    });

    it("the point-of-no-return flag missing from S10, or on another file", () => {
      const unflagged = entries.map((e) => (e.file === POINT_OF_NO_RETURN_FILE ? { file: e.file, kind: e.kind, step: e.step, originalSource: e.originalSource, originalSha256: e.originalSha256, sha256: e.sha256, strippedSha256: e.strippedSha256 } : e));
      expect(completenessProblems(unflagged).length).toBeGreaterThan(0);
      const extraFlag = entries.map((e) => (e.file === "S7-R0-app-role-additive-grants.sql" ? { ...e, pointOfNoReturn: true as const } : e));
      expect(completenessProblems(extraFlag).length).toBeGreaterThan(0);
    });
  });
});
