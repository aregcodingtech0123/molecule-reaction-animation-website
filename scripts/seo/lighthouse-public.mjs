/**
 * Core Web Vitals for the PUBLIC routes without the database or Express (SEO-18, R10-R12): `next start` on the
 * `.next-perf` production build, Lighthouse 13 on Playwright's Chromium, medians over `--runs` runs.
 *
 *   node scripts/perf/isolate.mjs scripts/seo/lighthouse-public.mjs --label before --runs 5
 *   (options) --routes /,/explore,/periodic-table  --profiles mobile,desktop  --out perf-results/seo-before.json
 *
 * Same rules as the perf harness: this process and the server both run with the network guard (the server's log
 * must show the marker), Chromium resolves nothing but localhost, and nothing is sent anywhere. Build first:
 *   node scripts/perf/run.mjs <any scenario> --build   (or `next build` with scripts/perf/config.mjs `webEnv`)
 * Signed-in routes (/ai-lab, /dashboard) need the full stack: use `node scripts/perf/run.mjs lighthouse`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { BROWSER_GUARD_ARGS } from "../perf/lib/browser.mjs";
import { acrossRuns } from "../perf/lib/stats.mjs";
import { assertNetworkGuard, assertServerGuarded } from "../perf/lib/guard.mjs";
import { WEB_ORIGIN, WEB_PORT, makeSecrets, repoRoot, webEnv } from "../perf/config.mjs";

assertNetworkGuard("the public-route Lighthouse run");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const runs = Number(arg("runs", 5));
const routes = arg("routes", "/,/explore,/periodic-table,/pricing,/atom-models").split(",");
const profiles = arg("profiles", "mobile,desktop").split(",");
const label = arg("label", "run");
const out = arg("out", "");
const siteUrl = arg("site-url", "");

const KEYS = ["score", "lcp", "lcpObserved", "cls", "tbt", "fcp", "bytesKiB"];
const nextBin = path.join(repoRoot, "node_modules/next/dist/bin/next");
const log = path.join(process.env.TEMP ?? ".", `seo-lh-${process.pid}.log`);

const logFd = fs.openSync(log, "a");
const server = spawn(process.execPath, [nextBin, "start", "--port", String(WEB_PORT)], {
  cwd: repoRoot,
  env: { ...webEnv(makeSecrets()), ...(siteUrl ? { SITE_URL: siteUrl } : {}), NODE_ENV: "production" },
  stdio: ["ignore", logFd, logFd],
});

async function waitReady() {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`${WEB_ORIGIN}/`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("next start did not become ready");
}

const results = {};
let chrome;
try {
  await waitReady();
  assertServerGuarded(fs.readFileSync(log, "utf8"), "web");
  chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ["--headless=new", "--no-first-run", ...BROWSER_GUARD_ARGS] });
  for (const route of routes) {
    for (const profile of profiles) {
      const flags = { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance"] };
      const once = async () => {
        const { lhr } = await lighthouse(`${WEB_ORIGIN}${route}`, flags, profile === "desktop" ? desktopConfig : undefined);
        const a = lhr.audits;
        const metrics = a.metrics?.details?.items?.[0] ?? {};
        return {
          score: Math.round((lhr.categories.performance.score ?? 0) * 100),
          lcp: a["largest-contentful-paint"].numericValue,
          lcpObserved: metrics.observedLargestContentfulPaint ?? null,
          cls: Number(a["cumulative-layout-shift"].numericValue.toFixed(4)),
          tbt: a["total-blocking-time"].numericValue,
          fcp: a["first-contentful-paint"].numericValue,
          bytesKiB: Number((a["total-byte-weight"].numericValue / 1024).toFixed(1)),
        };
      };
      await once(); // warm-up, discarded
      const samples = [];
      for (let r = 0; r < runs; r++) samples.push(await once());
      const summary = acrossRuns(samples, KEYS);
      results[`${route} ${profile}`] = { summary, runs: samples };
      const f = (k, d = 0) => (summary[k] ? `${summary[k].median.toFixed(d)} [${summary[k].min.toFixed(d)}-${summary[k].max.toFixed(d)}]` : "-");
      console.log(
        `[${label}] ${`${route} ${profile}`.padEnd(26)} score ${f("score")}  LCP(sim) ${f("lcp")}  LCP(obs) ${f("lcpObserved")}  CLS ${f("cls", 3)}  TBT ${f("tbt")}  FCP ${f("fcp")}  ${f("bytesKiB")} KiB`,
      );
    }
  }
} finally {
  await chrome?.kill();
  server.kill();
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify({ label, runs, at: new Date().toISOString(), results }, null, 2)}\n`);
  }
}
