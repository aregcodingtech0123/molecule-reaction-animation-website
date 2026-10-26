/**
 * Per-route client bundle composition from Next's own analyzer (Next 16.4: `next analyze --output` +
 * `next analyze export`, JSON Lines; `next build` no longer prints sizes).
 *
 *   node scripts/perf/bundle-report.mjs --snapshot <name> [--build]   (--build runs the analyzer first)
 *
 * For every page route: the client JS/CSS files the route loads up front (its bootstrap and render-dependent
 * chunk groups; async groups from dynamic imports are reported separately as asyncJsCompressedKiB),
 * their raw and compressed size (sum of the analyzer's per-module parts), and the share of named packages
 * and source groups (three / @react-three, markdown + KaTeX, framer-motion, locale JSON, app code, …).
 * Writes perf-results/bundle-<snapshot>.json. The analyzer runs on `.next-analyze` (gitignored) behind the
 * same network guard as every perf build (font hosts only).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RESULTS_DIR, makeSecrets, repoRoot, webEnv } from "./config.mjs";

const nextBin = path.join(repoRoot, "node_modules/next/dist/bin/next");
const DIST = ".next-analyze";

/** Which bucket a module path belongs to. Order matters (first match wins). */
const GROUPS = [
  ["three / @react-three / postprocessing", /node_modules\/(three|@react-three|three-stdlib|postprocessing|maath|camera-controls|troika-|meshline|@monogrid|stats-gl|detect-gpu|hls\.js|suspend-react|its-fine|zustand)/],
  ["markdown + KaTeX", /node_modules\/(react-markdown|remark-|rehype-|micromark|mdast-|hast-|unified|katex|unist-|vfile|property-information|space-separated|comma-separated|decode-named|character-|html-url|estree-|devlop|bail|trough|is-plain-obj|zwitch|longest-streak|ccount|markdown-table|trim-lines|web-namespaces|style-to|inline-style|parse-entities|stringify-entities|hastscript|html-void)/],
  ["framer-motion", /node_modules\/(framer-motion|motion-dom|motion-utils)/],
  ["locale content (12 locales)", /src\/lib\/i18n\/content\/[a-z]{2}\.json/],
  ["i18n (other)", /src\/lib\/i18n\//],
  ["molecule / element data", /src\/lib\/(molecules|periodic-table|reactions|atom-models)\//],
  ["react / react-dom / next", /node_modules\/(react|react-dom|scheduler|next|@next)\//],
  ["lucide-react", /node_modules\/lucide-react/],
  ["other node_modules", /node_modules\//],
  ["app code (src)", /src\//],
];

export function bucket(sourcePath) {
  for (const [name, re] of GROUPS) if (re.test(sourcePath)) return name;
  return "other";
}

export function summarize(lines) {
  const routes = lines.filter((l) => l.type === "route").map((l) => l.route).filter((r) => !r.startsWith("/api/") && !r.startsWith("/_"));
  const out = {};
  for (const route of routes) {
    // Initial load only: the bootstrap and render-dependent client groups. Async groups (dynamic imports) are
    // fetched later and reported separately; server outputs never reach the browser.
    const groups = lines.filter((l) => l.type === "group" && l.route === route);
    const client = (f) => f.startsWith("[client-fs]");
    const files = new Set(groups.filter((g) => g.kind !== "async").flatMap((g) => g.outputs).filter(client));
    const asyncFiles = new Set(groups.filter((g) => g.kind === "async").flatMap((g) => g.outputs).filter((f) => client(f) && !files.has(f)));
    const asyncKiB = lines
      .filter((l) => l.type === "part" && l.route === route && asyncFiles.has(l.filename) && l.filename.endsWith(".js"))
      .reduce((a, p) => a + p.compressed_size, 0);
    const parts = lines.filter((l) => l.type === "part" && l.route === route && files.has(l.filename));
    const byGroup = {};
    let raw = 0;
    let compressed = 0;
    let css = 0;
    for (const p of parts) {
      if (p.filename.endsWith(".css")) {
        css += p.compressed_size;
        continue;
      }
      if (!p.filename.endsWith(".js")) continue;
      raw += p.size;
      compressed += p.compressed_size;
      const b = bucket(p.source_path);
      byGroup[b] = (byGroup[b] ?? 0) + p.compressed_size;
    }
    out[route] = {
      jsFiles: [...files].filter((f) => f.endsWith(".js")).length,
      jsRawKiB: Number((raw / 1024).toFixed(1)),
      jsCompressedKiB: Number((compressed / 1024).toFixed(1)),
      cssCompressedKiB: Number((css / 1024).toFixed(1)),
      asyncJsCompressedKiB: Number((asyncKiB / 1024).toFixed(1)),
      byGroupKiB: Object.fromEntries(Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Number((v / 1024).toFixed(1))])),
    };
  }
  return out;
}

export function analyze(snapshot) {
  execFileSync(process.execPath, [nextBin, "analyze", "--output", "--snapshot", snapshot], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...webEnv(makeSecrets()), NEXT_DIST_DIR: DIST, PERF_ALLOW_FONT_HOSTS: "1", NODE_ENV: "production" },
  });
}

export function exportSnapshot(snapshot) {
  const text = execFileSync(process.execPath, [nextBin, "analyze", "export", "--dist-dir", DIST, "--snapshot", snapshot], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NEXT_TELEMETRY_DISABLED: "1" },
  });
  return text.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const snapshot = args.includes("--snapshot") ? args[args.indexOf("--snapshot") + 1] : "baseline";
  if (args.includes("--build")) analyze(snapshot);
  const report = summarize(exportSnapshot(snapshot));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `bundle-${snapshot}.json`), `${JSON.stringify(report, null, 2)}\n`);
  for (const [route, r] of Object.entries(report)) {
    const top = Object.entries(r.byGroupKiB).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`${route.padEnd(18)} JS ${String(r.jsCompressedKiB).padStart(7)} KiB compressed (${r.jsRawKiB} raw, ${r.jsFiles} files), CSS ${r.cssCompressedKiB} | ${top}`);
  }
}
