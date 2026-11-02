/**
 * docs/seo/SEO_LAUNCH_CHECKLIST.md must stay consistent with docs/ops/LAUNCH_CHECKLIST.md and with the code it talks about:
 * every section it points at exists, every `npm run` script and environment variable it names exists, the sitemap sizes it states
 * are the real ones, its relative links resolve, and the flags it passes to `check:live-seo` are accepted. A page added without
 * updating the docs, or a renamed script, fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INDEXABLE_ROUTES } from "@/lib/seo/routes";
import { parseArgs } from "../../scripts/seo/verify-live.mjs";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const SEO = read("docs/seo/SEO_LAUNCH_CHECKLIST.md");
const LAUNCH = read("docs/ops/LAUNCH_CHECKLIST.md");
const DOCS: Record<string, string> = {
  LAUNCH_CHECKLIST: LAUNCH,
  SEO_FINDINGS: read("docs/seo/SEO_FINDINGS.md"),
  DATA_REVIEW: read("docs/seo/DATA_REVIEW.md"),
  PRODUCTION_RUNBOOK: read("docs/ops/PRODUCTION_RUNBOOK.md"),
  CWV_RESULTS: read("docs/seo/CWV_RESULTS.md"),
};

/** Section ids that exist in a document: "## A. …" -> A, "## 1. …" -> 1, "### 1.6 …" -> 1.6 */
function sections(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(/^#{2,4}\s+([A-Z]|\d+(?:\.\d+)?)[.\s]/gm)) ids.add(m[1]);
  return ids;
}
const LAUNCH_SECTIONS = sections(LAUNCH);
const OWN_SECTIONS = sections(SEO);

/** Which document does the § at `index` refer to? Looks back for a document name; otherwise it is the document itself. */
function target(text: string, index: number): string {
  const before = text.slice(Math.max(0, index - 45), index);
  const named = [...before.matchAll(/(LAUNCH_CHECKLIST|SEO_FINDINGS|DATA_REVIEW|PRODUCTION_RUNBOOK|CWV_RESULTS|runbook)/g)].pop();
  if (!named) return "SELF";
  return named[1] === "runbook" ? "PRODUCTION_RUNBOOK" : named[1];
}

describe("SEO_LAUNCH_CHECKLIST.md references", () => {
  const refs = [...SEO.matchAll(/§\s*([A-Z]|\d+(?:\.\d+)?)/g)].map((m) => ({ id: m[1], doc: target(SEO, m.index ?? 0), at: m.index ?? 0 }));

  it("has section references to check at all (the parser is not silently matching nothing)", () => {
    expect(refs.length).toBeGreaterThan(25);
    expect(new Set(refs.map((r) => r.doc))).toEqual(new Set(["SELF", "LAUNCH_CHECKLIST", "SEO_FINDINGS", "DATA_REVIEW"]));
  });

  it("every § that points at LAUNCH_CHECKLIST.md names a section that exists there", () => {
    const bad = refs.filter((r) => r.doc === "LAUNCH_CHECKLIST" && !LAUNCH_SECTIONS.has(r.id)).map((r) => `§${r.id}`);
    expect(bad).toEqual([]);
  });

  it("every § that points at another document names a section that exists there", () => {
    const bad = refs
      .filter((r) => !["SELF", "LAUNCH_CHECKLIST"].includes(r.doc))
      .filter((r) => !sections(DOCS[r.doc]).has(r.id))
      .map((r) => `${r.doc} §${r.id}`);
    expect(bad).toEqual([]);
  });

  it("an unnamed § is either one of this checklist's own integer sections, or - when dotted or lettered, which only LAUNCH_CHECKLIST.md has - a real LAUNCH_CHECKLIST section", () => {
    const unnamed = refs.filter((r) => r.doc === "SELF");
    const own = unnamed.filter((r) => /^\d+$/.test(r.id));
    const launch = unnamed.filter((r) => !/^\d+$/.test(r.id));
    expect(launch.length).toBeGreaterThan(5);
    expect(own.filter((r) => !OWN_SECTIONS.has(r.id)).map((r) => `§${r.id}`)).toEqual([]);
    expect(launch.filter((r) => !LAUNCH_SECTIONS.has(r.id)).map((r) => `§${r.id}`)).toEqual([]);
    expect([...OWN_SECTIONS].sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("the 'how it fits' table only cites LAUNCH_CHECKLIST sections that exist", () => {
    const table = SEO.slice(SEO.indexOf("| This file |"), SEO.indexOf("> **Convention.**"));
    const ids = [...table.matchAll(/§\s*([A-Z]|\d+(?:\.\d+)?)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(8);
    // the first column cites this file's own sections (§1 … §8), the second column LAUNCH_CHECKLIST's: check each row's second cell
    for (const row of table.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| This file") && !l.startsWith("| ---"))) {
      const second = row.split("|")[2] ?? "";
      for (const m of second.matchAll(/§\s*([A-Z]|\d+(?:\.\d+)?)/g)) expect(LAUNCH_SECTIONS.has(m[1]), `${row} -> §${m[1]}`).toBe(true);
    }
  });

  it("the two checklists link to each other, and every relative markdown link in this file resolves", () => {
    expect(LAUNCH).toContain("SEO_LAUNCH_CHECKLIST.md");
    expect(SEO).toContain("LAUNCH_CHECKLIST.md");
    const links = [...SEO.matchAll(/\]\((\.\.?\/[^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const rel of links) expect(fs.existsSync(path.resolve(root, "docs/seo", rel)), rel).toBe(true);
  });
});

describe("SEO_LAUNCH_CHECKLIST.md names real scripts, variables and numbers", () => {
  const scripts = new Set([
    ...Object.keys(JSON.parse(read("package.json")).scripts),
    ...Object.keys(JSON.parse(read("services/auth-billing-service/package.json")).scripts),
  ]);

  it("every `npm run <script>` exists in a package.json", () => {
    const used = [...SEO.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((m) => m[1]);
    expect(used).toEqual(expect.arrayContaining(["check:live-seo", "check:config", "check:launch-content", "test:seo"]));
    expect(used.filter((s) => !scripts.has(s))).toEqual([]);
  });

  it("every environment variable it names is defined in an .env.example or used by the code", () => {
    const sources = [
      read(".env.example"),
      read("services/auth-billing-service/.env.example"),
      ...["src", "scripts", "services/auth-billing-service/src"].flatMap((dir) => walk(path.join(root, dir))).map((f) => fs.readFileSync(f, "utf8")),
    ].join("\n");
    const vars = [...new Set([...SEO.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1]))];
    expect(vars).toEqual(expect.arrayContaining(["SITE_URL", "FRONTEND_URL", "VERCEL_ENV", "EMAIL_TOMBSTONE_GUARD"]));
    expect(vars.filter((v) => !sources.includes(v))).toEqual([]);
  });

  it("states the real sitemap sizes (20 with draft trust pages, 24 with the four trust pages) and LAUNCH_CHECKLIST agrees", () => {
    const urls = INDEXABLE_ROUTES.flatMap((r) => (r.dynamic ? r.dynamic.ids : [r.path]));
    const trust = ["/about", "/contact", "/privacy", "/terms"];
    const withoutTrust = urls.filter((u) => !trust.includes(u)).length; // the draft state: trust pages are noindex
    const withTrust = withoutTrust + trust.length;
    expect(SEO).toContain(`${withoutTrust} URLs`);
    expect(SEO).toContain(`**${withTrust}**`);
    expect(LAUNCH).toContain(`**${withoutTrust} URLs**`);
    expect(LAUNCH).toContain(`**${withTrust}** once`);
  });

  it("the placeholder count it quotes is the real one", () => {
    const owner = read("src/lib/legal/site-owner.ts");
    const fields = [...owner.matchAll(/^\s+(\w+): `\$\{PLACEHOLDER_PREFIX\}/gm)].length;
    expect(SEO).toContain(`**${fields} placeholders**`);
  });

  it("every check:live-seo command line it shows is accepted by the script's own argument parser", () => {
    const cmds = [...SEO.matchAll(/npm run check:live-seo -- ([^\n`]+)/g)].map((m) => m[1].replace(/#.*$/, "").trim());
    expect(cmds.length).toBeGreaterThanOrEqual(3);
    for (const cmd of cmds) {
      const argv = cmd.split(/\s+/).map((a) => a.replace(/<site>/g, "site.example").replace(/<other>/g, "www.site.example").replace(/<yes\|no>/g, "no"));
      const fixed = argv.map((a) => (a.startsWith("http") ? a : a.startsWith("site.example") || a.startsWith("www.") ? `https://${a}` : a));
      expect(() => parseArgs(fixed.map((a) => (a === "https://site.example" || a.startsWith("https://site.example") ? a : a)))).not.toThrow();
    }
  });

  it("has the section headings an owner expects and a Go / no-go", () => {
    for (const h of ["## 1. Gates", "## 2. Canonical host", "## 3. Verify the live origin", "## 4. Google Search Console", "## 5. Bing", "## 6. Link previews", "## 7. Field data", "## 8. Hiding the site", "## Go / no-go (SEO)"]) {
      expect(SEO, h).toContain(h);
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|mjs|js|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}
