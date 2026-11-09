/**
 * README.md must stay consistent with the repository it describes: every `npm run` script, environment variable, file path,
 * link (and heading anchor), route, port and migration it names exists; the credit packs, language count, atom-model count,
 * element count, Node range and framework versions it states are the real ones; and every document under docs/ is indexed.
 * A renamed script, a moved file or a new document that the README does not know about fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { LEGAL_REVIEWED_ENV, OWNER_FIELDS, REQUIRED_FIELDS } from "@/lib/legal/site-owner";
import { CREDIT_PACKAGES } from "../../services/auth-billing-service/src/config/packages";
import { DEFAULT_GEMINI_MODEL } from "@/lib/ai/lab-assistant-prompt";
import { ATOM_MODEL_META } from "@/lib/atom-models/data";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/languages";
import { ELEMENTS } from "@/lib/periodic-table/elements";
import { checkLaunchContent } from "../../scripts/check-launch-content.mjs";
import { parseArgs } from "../../scripts/seo/verify-live.mjs";
import { FULL_OWNER_ENV } from "../support/site-owner-env";

const root = path.resolve(__dirname, "../..");
/** Line endings are normalised: a Windows checkout with core.autocrlf turns the repository's LF into CRLF, which must not matter. */
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const README = read("README.md");
const rootPkg = JSON.parse(read("package.json"));
const servicePkg = JSON.parse(read("services/auth-billing-service/package.json"));
const scripts = new Set([...Object.keys(rootPkg.scripts), ...Object.keys(servicePkg.scripts)]);

/** The lines of a "## <heading>" section, without the heading. */
function section(heading: string): string {
  const start = README.indexOf(`\n## ${heading}\n`);
  expect(start, `README has no "## ${heading}" section`).toBeGreaterThan(-1);
  const rest = README.slice(start + 1);
  const next = rest.indexOf("\n## ", 4);
  return next === -1 ? rest : rest.slice(0, next);
}

/** GitHub's heading anchor: lower case, punctuation removed, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}
const anchorsOf = (text: string) => new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));

function walk(dir: string, accept: RegExp): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, accept));
    else if (accept.test(entry.name)) out.push(full);
  }
  return out;
}

afterEach(() => vi.unstubAllEnvs());

describe("README.md names real scripts and variables", () => {
  it("every `npm run <script>` exists in the root or the service package.json", () => {
    const used = [...README.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(30);
    expect(used.filter((s) => !scripts.has(s))).toEqual([]);
  });

  it("documents every test, check, database and job script", () => {
    const mustMention = [
      "dev:all", "dev:all:nodocker", "dev:web", "dev:api", "docker:up", "docker:down", "docker:reset",
      "db:setup", "db:migrate", "db:migrate:status", "db:migrate:baseline", "db:reset",
      "db:reconcile", "db:purge-signup-ips", "db:process-deletions", "webhooks:replay",
      "test:unit", "test:api", "test:db", "test:e2e", "test:seo", "test:coverage", "test:db:up", "test:db:down",
      "typecheck:tests", "perf:bundle-budget", "check:config", "check:live-seo", "check:launch-content", "lint",
    ];
    const missing = mustMention.filter((s) => !new RegExp(`npm run ${s}(?![\\w:-])`).test(README));
    expect(missing).toEqual([]);
    expect(README).toMatch(/`npm test`/);
  });

  it("every environment variable it names is defined in an .env.example or used by the code", () => {
    const sources = [
      read(".env.example"),
      read(".env.test.example"),
      read("services/auth-billing-service/.env.example"),
      ...["src", "scripts", "services/auth-billing-service/src", "services/auth-billing-service/scripts"]
        .flatMap((dir) => walk(path.join(root, dir), /\.(ts|tsx|mts|mjs|js|json)$/))
        .map((f) => fs.readFileSync(f, "utf8")),
    ].join("\n");
    const vars = [...new Set([...README.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1]))];
    // ledger transaction types are data, not environment variables
    const data = new Set(["SIGNUP_BONUS", "CREDIT_PURCHASE", "CSRF_REJECTED"]);
    expect(vars).toEqual(expect.arrayContaining(["SITE_URL", "INTERNAL_SERVICE_SECRET", "EMAIL_TOMBSTONE_SECRET", "FRONTEND_URL", "JWT_SECRET"]));
    expect(vars.filter((v) => !data.has(v) && !sources.includes(v))).toEqual([]);
  });

  it("the env-variable tables name the variables the two templates mark as required", () => {
    const vars = section("Environment variables");
    for (const name of ["JWT_SECRET", "INTERNAL_SERVICE_SECRET", "EMAIL_TOMBSTONE_SECRET", "DATABASE_URL", "LEMONSQUEEZY_WEBHOOK_SECRET", "GEMINI_API_KEY", "SITE_URL"]) {
      expect(vars, name).toContain(`\`${name}\``);
    }
  });

  it("the SITE_OWNER_* variables it names are exactly the 14 required + 6 optional ones of OWNER_FIELDS, each in .env.example, and no other", () => {
    const required = REQUIRED_FIELDS.map((f) => f.env);
    const optional = [...OWNER_FIELDS.filter((f) => !f.required).map((f) => f.env), LEGAL_REVIEWED_ENV];
    expect(required).toHaveLength(14);
    expect(optional).toHaveLength(6);
    const owner = section("Environment variables").split("### Owner details for the trust pages")[1];
    expect(owner, "README lost its owner-details subsection").toBeTruthy();
    const named = (text: string) => new Set([...text.matchAll(/`(SITE_OWNER_[A-Z0-9_]+)`/g)].map((m) => m[1]));
    const table = owner.split("* **Gate.**")[0];
    const [requiredRows, optionalRow] = [table.split("| **Optional")[0], table.split("| **Optional")[1] ?? ""];
    expect([...named(requiredRows)].sort()).toEqual([...required].sort());
    expect([...named(optionalRow)].sort()).toEqual([...optional].sort());
    // nothing outside the subsection invents a variable either
    expect([...named(README)].filter((v) => !required.includes(v) && !optional.includes(v))).toEqual([]);
    expect(owner).toContain("**Required (14)**");
    expect(owner).toContain("**Optional (6)**");
    const template = read(".env.example");
    for (const v of [...required, ...optional]) expect(template, v).toMatch(new RegExp(`^# ${v}=`, "m"));
  });

  it("the owner-details subsection states the gate as the code behaves: check:launch-content exit codes, 20 vs 24 sitemap URLs, the guard pairing", () => {
    const owner = section("Environment variables").split("### Owner details for the trust pages")[1];
    // check:launch-content: 1 with every required variable open, 0 once all are set (and optional ones never matter)
    expect(checkLaunchContent({}).problems).toHaveLength(14);
    expect(checkLaunchContent(FULL_OWNER_ENV).problems).toEqual([]);
    expect(read("scripts/check-launch-content.mts")).toMatch(/process\.exit\(64\)/);
    expect(owner).toMatch(/exits `1`; `0` means all 14 are set and valid, `64` is a usage error/);
    // sitemap: 20 URLs while the gate is closed, 24 once it is open
    try {
      vi.stubEnv("SITE_URL", "https://studio.example");
      vi.stubEnv("VERCEL_ENV", "");
      expect(sitemap()).toHaveLength(20);
      for (const [name, value] of Object.entries(FULL_OWNER_ENV)) vi.stubEnv(name, value);
      expect(sitemap()).toHaveLength(24);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(owner).toContain("20 sitemap URLs instead of 24");
    // the README says the details live on the Next.js host and that the guard must match Express
    expect(owner).toContain("must agree with `EMAIL_TOMBSTONE_GUARD` on Express");
    expect(read("scripts/check-config.mts")).toContain("SITE_OWNER_EMAIL_TOMBSTONE_GUARD");
    expect(owner).toContain("docs/seo/LEGAL_REVIEW_QUESTIONS.md");
  });

  it("every check:live-seo command line it shows is accepted by the script's own argument parser", () => {
    const cmds = [...README.matchAll(/npm run check:live-seo -- ([^\n`#]+)/g)].map((m) => m[1].trim());
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    for (const cmd of cmds) {
      const argv = cmd.split(/\s+/).map((a) => a.replace(/<site>/g, "site.example").replace(/<url>/g, "https://www.site.example/"));
      const fixed = argv.map((a) => (a.startsWith("http") || a.startsWith("--") || a === "no" || a === "yes" || a === "either" ? a : `https://${a}`));
      expect(() => parseArgs(fixed), cmd).not.toThrow();
    }
  });
});

describe("README.md paths, links and routes resolve", () => {
  it("every path under a top-level repository directory exists", () => {
    const paths = new Set(
      [...README.matchAll(/(?<![\w./-])((?:scripts|src|services|database|docs|tests|\.github)\/[\w./[\]@-]*)/g)].map((m) => m[1].replace(/[.,;:]+$/, "")),
    );
    expect(paths.size).toBeGreaterThan(30);
    // the gitignored env file the quick start tells the reader to create
    const createdByReader = new Set(["services/auth-billing-service/.env"]);
    expect([...paths].filter((p) => !createdByReader.has(p) && !exists(p))).toEqual([]);
  });

  it("every file named in backticks exists (repo-relative, or as the basename of a document under docs/)", () => {
    const docNames = new Set(walk(path.join(root, "docs"), /\.md$/).map((f) => path.basename(f)));
    // named on purpose as files the repository does NOT have ("no Dockerfile, render.yaml or vercel.json")
    const absent = ["Dockerfile", "render.yaml", "vercel.json"];
    for (const f of absent) expect(exists(f), `${f} exists now: update the Deployment section`).toBe(false);
    const generated = new Set(absent);
    const tokens = [...new Set([...README.matchAll(/`([^`\s]+\.(?:md|ya?ml|json|mjs|mts|tsx?|sql|example))`/g)].map((m) => m[1]))];
    expect(tokens.length).toBeGreaterThan(20);
    const missing = tokens.filter((t) => !generated.has(t) && !exists(t) && !docNames.has(t));
    expect(missing).toEqual([]);
  });

  it("every relative markdown link resolves, and every #anchor names a heading of its target", () => {
    const links = [...README.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l));
    expect(links.length).toBeGreaterThan(40);
    const bad: string[] = [];
    for (const link of links) {
      const [file, anchor] = link.split("#");
      const target = file === "" ? "README.md" : file;
      if (!exists(target)) {
        bad.push(link);
        continue;
      }
      if (anchor && !anchorsOf(read(target)).has(anchor)) bad.push(link);
    }
    expect(bad).toEqual([]);
  });

  it("the project-structure tree lists only entries that exist", () => {
    const block = section("Project structure").split("```")[1];
    const stack: string[] = [];
    const missing: string[] = [];
    for (const line of block.split("\n")) {
      const m = /^((?:\|   | {4})*)(?:\|--|`--) (.*)$/.exec(line);
      if (!m) continue;
      const depth = m[1].length / 4;
      stack.length = depth;
      const names = m[2].split("#")[0].trim().split(/\s{2,}/).filter(Boolean);
      for (const name of names) if (!exists(path.join(...stack, name))) missing.push(path.join(...stack, name));
      // a directory entry becomes the parent of the deeper lines that follow
      stack[depth] = names[0].replace(/\/$/, "");
    }
    expect(missing).toEqual([]);
    expect(block).toContain("migrations 001-020");
  });

  it("every page route in the Features table has a page, and every /api route a handler", () => {
    const table = section("Features");
    const routes = [...new Set([...table.split("Credit packs")[0].matchAll(/`(\/[a-z\-[\]/]*)`/g)].map((m) => m[1]))];
    expect(routes).toEqual(expect.arrayContaining(["/explore", "/molecules/[id]", "/ai-lab", "/atom-models", "/periodic-table", "/dashboard", "/profile", "/login"]));
    expect(routes.filter((r) => !exists(`src/app${r}/page.tsx`))).toEqual([]);
    for (const dir of ["auth", "billing", "users", "chat"]) expect(exists(`src/app/api/${dir}`), dir).toBe(true);
    for (const r of ["/api/auth/*", "/api/billing/*", "/api/users/*", "/api/chat"]) expect(README).toContain(r);
  });

  it("every document under docs/ is linked from the README", () => {
    const docs = walk(path.join(root, "docs"), /\.md$/).map((f) => path.relative(root, f).split(path.sep).join("/"));
    expect(docs.length).toBeGreaterThan(20);
    expect(docs.filter((d) => !README.includes(`](${d}`))).toEqual([]);
  });
});

describe("README.md states the real numbers", () => {
  it("the credit packs and the signup bonus are the configured ones", () => {
    for (const p of Object.values(CREDIT_PACKAGES)) {
      expect(README, p.id).toContain(`| \`${p.id}\``);
      expect(README, p.id).toMatch(new RegExp(`\\| \`${p.id}\`[^|]*\\| ${p.priceUsdCents / 100} \\| ${p.credits} \\|`));
    }
    expect(Object.keys(CREDIT_PACKAGES)).toHaveLength(3);
    const bonus = /const SIGNUP_CREDITS = (\d+)/.exec(read("services/auth-billing-service/src/services/auth.service.ts"))?.[1];
    expect(README).toContain(`receives ${bonus} credits once`);
  });

  it("languages, atom models, elements and the default model", () => {
    expect(LANGUAGE_OPTIONS).toHaveLength(12);
    expect(README).toContain("12 languages");
    expect(Object.keys(ATOM_MODEL_META)).toHaveLength(5);
    expect(README).toContain("five historical atomic models");
    expect(ELEMENTS).toHaveLength(118);
    expect(README).toContain("118 elements");
    expect(README).toContain(`\`${DEFAULT_GEMINI_MODEL}\``);
  });

  it("the Node range and the framework versions match package.json", () => {
    expect(rootPkg.engines.node).toBe(">=24 <25");
    expect(servicePkg.engines.node).toBe(rootPkg.engines.node);
    expect(README).toContain(`"node": "${rootPkg.engines.node}"`);
    expect(README).toContain(`Next.js ${rootPkg.dependencies.next}`);
    expect(README).toContain(`React ${rootPkg.dependencies.react}`);
    const bare = (v: string) => v.replace(/^[~^]/, "");
    /** "^12.41.0" -> "12", "^0.184.0" -> "0.184" (a 0.x version's minor is its major) */
    const major = (v: string) => bare(v).split(".").slice(0, bare(v).startsWith("0.") ? 2 : 1).join(".");
    const minor = (v: string) => bare(v).split(".").slice(0, 2).join(".");
    const dep = rootPkg.dependencies;
    const dev = rootPkg.devDependencies;
    const stated = [
      `three ${major(dep.three)}`,
      `framer-motion ${major(dep["framer-motion"])}`,
      `@react-three/fiber ${major(dep["@react-three/fiber"])}`,
      `@react-three/drei ${major(dep["@react-three/drei"])}`,
      `react-markdown ${major(dep["react-markdown"])}`,
      `@google/genai ${minor(dep["@google/genai"])}`,
      `Express ${minor(servicePkg.dependencies.express)}`,
      `Playwright ${minor(dev["@playwright/test"])}`,
      `Vitest ~${minor(dev.vitest)}`,
      `Lighthouse ${dev.lighthouse}`,
      `autocannon ${dev.autocannon}`,
    ];
    for (const text of stated) expect(README, text).toContain(text);
  });

  it("PostgreSQL 18 everywhere the README says so", () => {
    for (const f of ["docker-compose.yml", "docker-compose.test.yml", ".github/workflows/test.yml"]) expect(read(f), f).toContain("postgres:18-alpine");
    expect(README).toContain("PostgreSQL 18");
    expect(README).not.toMatch(/PostgreSQL 1[0-7]\b/);
  });

  it("the ports it names are the configured ones", () => {
    const e2e = read("scripts/test/e2e-env.mjs");
    expect(e2e).toMatch(/E2E_WEB_PORT \|\| 3100/);
    expect(e2e).toMatch(/E2E_API_PORT \|\| 4100/);
    const perf = read("scripts/perf/config.mjs");
    for (const port of ["3200", "4200", "4290"]) expect(perf, port).toContain(port);
    expect(read("docker-compose.test.yml")).toContain("127.0.0.1:55432:5432");
    expect(read("services/auth-billing-service/.env.example")).toContain("PORT=4000");
    for (const text of ["port 3000", "port 4000", "http://localhost:3000", "http://localhost:4000", "3100", "4100", "3200", "4200", "4290", "55432"]) {
      expect(README, text).toContain(text);
    }
  });

  it("lists every migration in database/init, and no other", () => {
    const files = fs.readdirSync(path.join(root, "database/init")).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
    const nums = files.map((f) => f.slice(0, 3));
    expect(nums[0]).toBe("001");
    expect(nums.at(-1)).toBe("020");
    expect(nums).toEqual(nums.map((_, i) => String(i + 1).padStart(3, "0")));
    const table = README.slice(README.indexOf("| # | Adds |"));
    const listed = [...table.matchAll(/^\| (\d[\d, ]*) \|/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
    expect(listed).toEqual(nums);
  });

  it("the coverage floors it quotes are the latest recorded figures", () => {
    const findings = read("docs/seo/SEO_FINDINGS.md");
    const latest = findings.slice(findings.lastIndexOf("\n## Part 3"));
    for (const figure of ["92.10 %", "81.81 %", "94.83 %"]) {
      expect(README, figure).toContain(`**${figure}**`);
      expect(latest, figure).toContain(`**${figure}**`);
    }
    const vitestRoot = read("vitest.config.mts") + read("services/auth-billing-service/vitest.config.ts");
    expect(vitestRoot).not.toContain("thresholds");
  });

  it("the migration-runner table, workflow jobs and performance scenarios it names exist", () => {
    for (const job of ["service:", "web:", "lint:", "e2e:", "e2e-production:"]) expect(read(".github/workflows/test.yml"), job).toContain(`\n  ${job}`);
    const scenarios = new Set(walk(path.join(root, "scripts/perf/scenarios"), /\.mjs$/).map((f) => path.basename(f, ".mjs")));
    const listed = (README.match(/Scenarios include ([^.]+)\./)?.[1] ?? "").match(/`([a-z]+)`/g)?.map((s) => s.replace(/`/g, "")) ?? [];
    expect(listed.length).toBeGreaterThan(8);
    expect(listed.filter((s) => !scenarios.has(s))).toEqual([]);
  });
});
