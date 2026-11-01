/**
 * Lighthouse 13 cross-check of the Playwright Web Vitals runs (owner-approved, Part 2): same routes, mobile
 * (Lighthouse default: simulated slow 4G + 4× CPU) and desktop preset, signed out and in (cookie header),
 * `--runs` runs each; median and spread of the performance score and LCP / CLS / TBT / FCP / SI, plus total byte
 * weight and Lighthouse's unused-JavaScript estimate. Chrome is Playwright's Chromium with the DNS guard
 * (lib/browser.mjs), so the audited page cannot reach anything but localhost.
 *   node scripts/perf/run.mjs lighthouse [--runs 5]
 */
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { BROWSER_GUARD_ARGS } from "../lib/browser.mjs";
import { acrossRuns } from "../lib/stats.mjs";

export const defaults = { seedArgs: "--users 20 --rows 120 --hot-rows 500", concurrency: [1] };
export const stack = { hopLog: false, procLog: false };

const ROUTES = [
  { path: "/", auth: ["out", "in"] },
  { path: "/explore", auth: ["out", "in"] },
  { path: "/periodic-table", auth: ["out", "in"] },
  { path: "/ai-lab", auth: ["in"] },
  { path: "/dashboard", auth: ["in"] },
];
const KEYS = ["score", "lcp", "cls", "tbt", "fcp", "si", "bytesKiB", "unusedJsKiB"];

export async function run(ctx) {
  const only = process.env.PERF_WV_ROUTES?.split(",");
  const profiles = process.env.PERF_WV_PROFILES?.split(",") ?? ["mobile", "desktop"];
  const chrome = await chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-first-run", ...BROWSER_GUARD_ARGS],
  });
  const out = {};
  try {
    for (const route of ROUTES.filter((r) => !only || only.includes(r.path))) {
      for (const profile of profiles) {
        for (const auth of route.auth) {
          const key = `${route.path} ${profile} ${auth === "in" ? "signed-in" : "signed-out"}`;
          const flags = {
            port: chrome.port,
            output: "json",
            logLevel: "error",
            onlyCategories: ["performance"],
            ...(auth === "in" ? { extraHeaders: { Cookie: `session_token=${ctx.session(1)}` } } : {}),
          };
          const once = async () => {
            const { lhr } = await lighthouse(`${ctx.webOrigin}${route.path}`, flags, profile === "desktop" ? desktopConfig : undefined);
            const a = lhr.audits;
            return {
              score: Math.round((lhr.categories.performance.score ?? 0) * 100),
              lcp: a["largest-contentful-paint"].numericValue,
              cls: Number(a["cumulative-layout-shift"].numericValue.toFixed(4)),
              tbt: a["total-blocking-time"].numericValue,
              fcp: a["first-contentful-paint"].numericValue,
              si: a["speed-index"].numericValue,
              bytesKiB: Number((a["total-byte-weight"].numericValue / 1024).toFixed(1)),
              unusedJsKiB: Number(((a["unused-javascript"]?.details?.overallSavingsBytes ?? 0) / 1024).toFixed(1)),
              // which element Lighthouse picked as LCP (R10 diagnosis): the first item of the element audit
              lcpElement: JSON.stringify(a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? a["largest-contentful-paint-element"]?.details?.items?.[0] ?? null)?.slice(0, 240),
              lcpAuditKeys: Object.keys(a).filter((k) => /lcp|largest/.test(k)),
              finalUrl: lhr.finalDisplayedUrl,
              runWarnings: lhr.runWarnings,
            };
          };
          await once(); // warm-up, discarded
          const runs = [];
          for (let r = 0; r < ctx.opts.runs; r++) runs.push(await once());
          out[key] = { summary: acrossRuns(runs, KEYS), runs };
          const s = out[key].summary;
          const f = (k, d = 0) => `${s[k].median.toFixed(d)} [${s[k].min.toFixed(d)}–${s[k].max.toFixed(d)}]`;
          console.log(`[lighthouse] ${key.padEnd(36)} score ${f("score")}  LCP ${f("lcp")}  CLS ${f("cls", 3)}  TBT ${f("tbt")}  FCP ${f("fcp")}  bytes ${f("bytesKiB")} KiB  unused JS ${f("unusedJsKiB")} KiB`);
        }
      }
    }
  } finally {
    await chrome.kill();
    ctx.record("lighthouse", out);
  }
}
