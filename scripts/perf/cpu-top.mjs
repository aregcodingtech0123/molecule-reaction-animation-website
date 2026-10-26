/**
 * Self time per function from a V8 .cpuprofile (written by the preload's PERF_CPU_PROF window).
 *   node scripts/perf/cpu-top.mjs <file.cpuprofile> [--top 25]
 * Prints the functions with the most self time and their share, plus totals per package
 * (node_modules/<pkg>, node:internal, app code), which is what tells where a saturated loop spends its time.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function selfTimes(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const counts = new Map();
  for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
  const total = profile.samples.length;
  const fn = new Map();
  const pkg = new Map();
  for (const [id, n] of counts) {
    const cf = byId.get(id).callFrame;
    const url = cf.url || "(native)";
    const key = `${cf.functionName || "(anonymous)"} ${url.split(/[\\/]/).slice(-2).join("/")}:${cf.lineNumber + 1}`;
    fn.set(key, (fn.get(key) ?? 0) + n);
    const m = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(url);
    const group = cf.functionName === "(garbage collector)" ? "(gc)" : cf.functionName === "(idle)" ? "(idle)" : m ? m[1].replace("\\", "/") : url.startsWith("node:") ? "node:internal" : url === "(native)" ? "(native)" : "app";
    pkg.set(group, (pkg.get(group) ?? 0) + n);
  }
  const rank = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: k, pct: Number(((n / total) * 100).toFixed(1)) }));
  return { total, functions: rank(fn), groups: rank(pkg) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  const top = Number(process.argv.includes("--top") ? process.argv[process.argv.indexOf("--top") + 1] : 25);
  const r = selfTimes(JSON.parse(fs.readFileSync(file, "utf8")));
  console.log(`samples: ${r.total}\n-- groups`);
  for (const g of r.groups.slice(0, 15)) console.log(`${String(g.pct).padStart(6)} %  ${g.name}`);
  console.log("-- functions (self)");
  for (const f of r.functions.slice(0, top)) console.log(`${String(f.pct).padStart(6)} %  ${f.name}`);
}
