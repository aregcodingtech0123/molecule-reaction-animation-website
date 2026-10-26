/**
 * Core Web Vitals lab measurement (Part 2) with Playwright on the production stack: for each route, profile
 * (mobile = 4× CPU + slow-4G-like network, desktop) and auth state, one discarded warm-up load, then `--runs`
 * cold loads (fresh context each). Per load: TTFB, FCP, LCP (+ element), CLS (+ shift sources), INP proxy
 * (scripted, non-navigating interactions → Event Timing), long tasks (TBT proxy), first WebGL draw, bytes
 * transferred by type. The browser cannot reach anything but localhost (lib/browser.mjs).
 *   node scripts/perf/run.mjs webvitals [--runs 5]
 * PERF_WV_ROUTES=/,/explore … limits the routes; PERF_WV_PROFILES=mobile limits the profiles.
 */
import { acrossRuns } from "../lib/stats.mjs";
import { collectMetrics, launchGuardedBrowser, newProfiledPage } from "../lib/browser.mjs";

export const defaults = { seedArgs: "--users 20 --rows 120 --hot-rows 500", concurrency: [1] };
export const stack = { hopLog: false, procLog: false };

const ROUTES = [
  { path: "/", auth: ["out", "in"] },
  { path: "/explore", auth: ["out", "in"] },
  { path: "/periodic-table", auth: ["out", "in"], extra: "element" },
  { path: "/ai-lab", auth: ["in"] },
  { path: "/dashboard", auth: ["in"] },
];

const KEYS = ["ttfb", "fcp", "lcp", "cls", "inpProxy", "tbtProxy", "firstGlDraw", "jsKiB", "totalKiB"];

async function interact(page, extra) {
  // A menu in the navbar (desktop) or the mobile menu button: open, then close — no navigation.
  const menu = page.locator('button[aria-label="Open menu"]:visible, button[aria-haspopup="menu"]:visible').first();
  if (await menu.count()) {
    await menu.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const close = page.locator('button[aria-label="Close menu"]:visible').first();
    if (await close.count()) await close.click({ timeout: 2000 }).catch(() => {});
  }
  if (extra === "element") {
    const cell = page.locator('[aria-label*="atomic number"]:visible').first();
    if (await cell.count()) await cell.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function loadOnce(browser, ctx, route, profile, auth) {
  const cookies = auth === "in" ? [{ name: "session_token", value: ctx.session(1), domain: "localhost", path: "/", httpOnly: true, sameSite: "Strict" }] : [];
  const { context, page } = await newProfiledPage(browser, profile, { cookies });
  try {
    const res = await page.goto(`${ctx.webOrigin}${route.path}`, { waitUntil: "load", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3000); // let LCP settle and late shifts (hydration, theme) happen
    await interact(page, route.extra);
    await page.waitForTimeout(1000);
    const m = await collectMetrics(page);
    const kib = (v) => Number(((v ?? 0) / 1024).toFixed(1));
    return { ...m, status: res?.status(), finalPath: new URL(page.url()).pathname, jsKiB: kib(m.bytes.js), totalKiB: kib(Object.values(m.bytes).reduce((a, b) => a + b, 0)) };
  } finally {
    await context.close();
  }
}

export async function run(ctx) {
  const only = process.env.PERF_WV_ROUTES?.split(",");
  const profiles = process.env.PERF_WV_PROFILES?.split(",") ?? ["mobile", "desktop"];
  const browser = await launchGuardedBrowser({ gpu: true });
  const out = {};
  try {
    for (const route of ROUTES.filter((r) => !only || only.includes(r.path))) {
      for (const profile of profiles) {
        for (const auth of route.auth) {
          const key = `${route.path} ${profile} ${auth === "in" ? "signed-in" : "signed-out"}`;
          await loadOnce(browser, ctx, route, profile, auth); // warm-up (server caches, JIT), discarded
          const runs = [];
          for (let r = 0; r < ctx.opts.runs; r++) runs.push(await loadOnce(browser, ctx, route, profile, auth));
          out[key] = { summary: acrossRuns(runs, KEYS), lcpElements: [...new Set(runs.map((r) => r.lcpEl))], runs };
          const s = out[key].summary;
          const f = (k, d = 0) => (s[k] ? `${s[k].median.toFixed(d)} [${s[k].min.toFixed(d)}–${s[k].max.toFixed(d)}]` : "—");
          console.log(
            `[webvitals] ${key.padEnd(36)} LCP ${f("lcp")} ms  CLS ${f("cls", 3)}  INP~ ${f("inpProxy")} ms  TBT~ ${f("tbtProxy")} ms  FCP ${f("fcp")}  TTFB ${f("ttfb")}  3D ${f("firstGlDraw")}  JS ${f("jsKiB")} KiB  (${runs[0].finalPath})`,
          );
        }
      }
    }
  } finally {
    await browser.close();
    ctx.record("webvitals", out);
  }
}
