/**
 * Guarded Chromium for frontend measurements (Part 2). Same rule as the servers: nothing leaves the machine.
 * `--host-resolver-rules` makes every host except localhost / 127.0.0.1 fail DNS inside the browser — this also
 * covers browsers Lighthouse launches itself, where Playwright's request routing does not reach.
 *
 * Profiles mirror Lighthouse 13's defaults: "mobile" = Moto G Power-like viewport (412×823 @1.75), 4× CPU
 * slowdown, 150 ms RTT, 1.6 Mbps down / 750 kbps up; "desktop" = 1350×940, no CPU slowdown, 40 ms RTT, 10 Mbps.
 * Throttling is applied through CDP (devtools-style), not simulated.
 */
import { chromium } from "@playwright/test";

export const BROWSER_GUARD_ARGS = ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"];
/** Real GPU through ANGLE/D3D11 in headless mode (default headless uses SwiftShader, a CPU rasteriser). */
export const GPU_ARGS = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"];

export const PROFILES = {
  mobile: {
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36",
    cpu: 4,
    network: { latency: 150, downloadThroughput: (1638.4 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  },
  desktop: {
    viewport: { width: 1350, height: 940 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    cpu: 1,
    network: { latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8 },
  },
};

export async function launchGuardedBrowser({ gpu = true } = {}) {
  return chromium.launch({ args: [...BROWSER_GUARD_ARGS, ...(gpu ? GPU_ARGS : [])] });
}

/** A fresh context (cold cache) with the profile's device, plus CDP throttling on its first page. */
export async function newProfiledPage(browser, profileName, { cookies = [] } = {}) {
  const p = PROFILES[profileName];
  const context = await browser.newContext({
    viewport: p.viewport,
    deviceScaleFactor: p.deviceScaleFactor,
    isMobile: p.isMobile,
    hasTouch: p.hasTouch,
    ...(p.userAgent ? { userAgent: p.userAgent } : {}),
  });
  if (cookies.length) await context.addCookies(cookies);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, ...p.network });
  if (p.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  await page.addInitScript(METRICS_INIT);
  return { context, page, cdp };
}

/**
 * In-page collection, installed before any page script: LCP (last candidate), CLS (largest session window,
 * excluding shifts after input), Event Timing (max duration per interaction = INP proxy), long tasks, the first
 * WebGL draw call (LCP ignores <canvas>, so 3D routes get a "first 3D frame" time), and every layout shift
 * source for attribution (e.g. the theme flash).
 */
const METRICS_INIT = `(() => {
  const m = (window.__perf = { lcp: null, lcpEl: null, cls: 0, shifts: [], interactions: {}, longTasks: [], firstGlDraw: null });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { m.lcp = e.startTime; m.lcpEl = (e.element && (e.element.tagName + (e.element.id ? '#' + e.element.id : '') + (e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.split(' ').slice(0, 3).join('.') : ''))) || e.url || null; } }).observe({ type: 'largest-contentful-paint', buffered: true });
    let win = 0, winStart = 0, last = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue;
      if (e.startTime - last > 1000 || e.startTime - winStart > 5000) { win = 0; winStart = e.startTime; }
      win += e.value; last = e.startTime; m.cls = Math.max(m.cls, win);
      m.shifts.push({ t: Math.round(e.startTime), v: Number(e.value.toFixed(4)), src: (e.sources || []).map((s) => s.node ? (s.node.tagName || s.node.nodeName) + (s.node.className && typeof s.node.className === 'string' ? '.' + s.node.className.split(' ').slice(0, 4).join('.') : '') : '?').slice(0, 3) }); } }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!e.interactionId) continue; m.interactions[e.interactionId] = Math.max(m.interactions[e.interactionId] || 0, e.duration); } }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) m.longTasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true });
  } catch (err) { m.error = String(err); }
  const wrap = (proto) => { if (!proto) return; for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) { const orig = proto[fn]; if (!orig) continue; proto[fn] = function () { if (m.firstGlDraw === null) m.firstGlDraw = performance.now(); return orig.apply(this, arguments); }; } };
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype); wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
})();`;

/** Collects the page's metrics plus navigation and resource timing (bytes by type, same-origin transfer sizes). */
export async function collectMetrics(page) {
  return page.evaluate(() => {
    const m = window.__perf;
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const bytes = {};
    for (const r of performance.getEntriesByType("resource")) {
      const type = /\.js(\?|$)/.test(r.name) ? "js" : /\.css(\?|$)/.test(r.name) ? "css" : /\.(woff2?|ttf)(\?|$)/.test(r.name) ? "font" : /\.(hdr|png|jpe?g|webp|avif|svg|gif)(\?|$)/.test(r.name) ? "image/env" : r.initiatorType === "fetch" ? "fetch" : "other";
      bytes[type] = (bytes[type] || 0) + (r.transferSize || 0);
    }
    bytes.document = nav ? nav.transferSize : 0;
    const inter = Object.values(m.interactions);
    return {
      ttfb: nav ? nav.responseStart : null,
      fcp: fcp ? fcp.startTime : null,
      lcp: m.lcp,
      lcpEl: m.lcpEl,
      cls: Number(m.cls.toFixed(4)),
      shifts: m.shifts,
      inpProxy: inter.length ? Math.max(...inter) : null,
      interactions: inter.length,
      longTaskTotal: m.longTasks.reduce((a, t) => a + t.d, 0),
      longTasksOver50: m.longTasks.filter((t) => t.d > 50).length,
      tbtProxy: m.longTasks.reduce((a, t) => a + Math.max(0, t.d - 50), 0),
      firstGlDraw: m.firstGlDraw,
      loadEvent: nav ? nav.loadEventEnd : null,
      bytes,
      error: m.error,
    };
  });
}
