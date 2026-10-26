/**
 * Bundle budget check (Part 2) — deterministic, so it can run in CI:
 *
 *   npm run perf:bundle-budget            (runs `next analyze --output`, then checks; exit 1 on a breach)
 *   node scripts/perf/bundle-budget.mjs --no-analyze   (reuses the last analysis in .next-analyze)
 *
 * Per page route, on the compressed client JS loaded up front (bundle-report.mjs):
 *  - at most the ceiling in scripts/perf/bundle-budget.json (measured after Part 2 + 10 %);
 *  - no three.js / @react-three in the initial load of a route that has no 3D scene (PERF-25);
 *  - no markdown / KaTeX renderer in any initial load (PERF-24);
 *  - no locale content beyond the built-in English (PERF-26).
 * To raise a ceiling on purpose, edit the JSON in the same change and say why in its commit.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./config.mjs";
import { analyze, exportSnapshot, summarize } from "./bundle-report.mjs";

const BUDGET_FILE = path.join(repoRoot, "scripts/perf/bundle-budget.json");
const SNAPSHOT = "budget";

export function checkBudget(report, budget) {
  const problems = [];
  for (const [route, ceiling] of Object.entries(budget.routes)) {
    const r = report[route];
    if (!r) {
      problems.push(`${route}: missing from the analysis`);
      continue;
    }
    if (r.jsCompressedKiB > ceiling) problems.push(`${route}: initial JS ${r.jsCompressedKiB} KiB > ceiling ${ceiling} KiB`);
    const three = r.byGroupKiB["three / @react-three / postprocessing"] ?? 0;
    if (!budget.routesWith3d.includes(route) && three > 0) problems.push(`${route}: ${three} KiB of three.js / @react-three in the initial load of a route without 3D`);
    const markdown = r.byGroupKiB["markdown + KaTeX"] ?? 0;
    if (markdown > 0) problems.push(`${route}: ${markdown} KiB of the markdown / KaTeX renderer in the initial load (it loads on demand)`);
    const locales = r.byGroupKiB["locale content (12 locales)"] ?? 0;
    if (locales > budget.englishLocaleMaxKiB) problems.push(`${route}: ${locales} KiB of locale content (only English, ≤ ${budget.englishLocaleMaxKiB} KiB, is built in)`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.argv.includes("--no-analyze")) analyze(SNAPSHOT);
  const report = summarize(exportSnapshot(SNAPSHOT));
  const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
  const problems = checkBudget(report, budget);
  for (const [route, ceiling] of Object.entries(budget.routes)) {
    const r = report[route];
    if (r) console.log(`${route.padEnd(18)} ${String(r.jsCompressedKiB).padStart(7)} / ${ceiling} KiB`);
  }
  if (problems.length) {
    for (const p of problems) console.log(`BUDGET  ${p}`);
    process.exitCode = 1;
  } else {
    console.log("[bundle-budget] OK");
  }
}
