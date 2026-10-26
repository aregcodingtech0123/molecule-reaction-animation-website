/**
 * Frontend runtime behaviour on the production stack (Part 2), guarded Chromium (lib/browser.mjs):
 *  1. 3D frame time on "/" and "/explore": idle (auto-rotate) and while orbiting (pointer drag), on
 *     desktop (real GPU), mobile profile (4× CPU, real GPU) and low-end (4× CPU + SwiftShader software GL);
 *  2. leak check: 20 client-side navigations "/" → "/periodic-table" → "/explore" (navbar links), heap after a
 *     forced GC every 5 cycles, WebGL contexts created vs released, canvases left in the DOM;
 *  3. reduced motion: WebGL draw calls per second idle on "/" with and without prefers-reduced-motion;
 *  4. React commits (DevTools-hook counter): idle 5 s on /periodic-table and /dashboard, per element click;
 *  5. balance requests per minute per signed-in tab: idle visible, idle hidden, and the post-checkout poll;
 *  6. AI Lab: one long answer with markdown + KaTeX (mock "math" answer): main-thread long tasks from send to
 *     rendered, and time until the answer is on screen;
 *  7. ledger table on /dashboard (100 rows on the first page): DOM nodes and long tasks during load;
 *  8. caching: response headers of a page, a /_next/static chunk, /hdri/*.hdr, /favicon.ico; TTFB of each
 *     measured route (20 sequential requests, signed out).
 * Numbers are medians of `--runs` repetitions where a repetition makes sense (1, 4, 7, 8).
 *   node scripts/perf/run.mjs runtime [--runs 5]
 * PERF_RT_STEPS=6,7,8 runs only those steps.
 */
import { acrossRuns, summarize } from "../lib/stats.mjs";
import { collectMetrics, launchGuardedBrowser, newProfiledPage } from "../lib/browser.mjs";

export const defaults = { seedArgs: "--users 20 --rows 120 --hot-rows 500", concurrency: [1] };
export const stack = { hopLog: false, procLog: false };

const COMMIT_HOOK = `(() => {
  const c = (window.__commits = { n: 0 });
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject(r) { this.renderers.set(1, r); return 1; },
    onCommitFiberRoot() { c.n++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
})();`;

const GL_COUNTERS = `(() => {
  const g = (window.__gl = { contexts: 0, lost: 0, draws: 0 });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !this.__counted) { this.__counted = true; g.contexts++; this.addEventListener('webglcontextlost', () => g.lost++); }
    return ctx;
  };
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!P) continue;
    for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const orig = P.prototype[fn]; if (!orig) continue;
      P.prototype[fn] = function () { g.draws++; return orig.apply(this, arguments); };
    }
  }
})();`;

/** V8 heap snapshot → per constructor/name: count and self size (bytes). */
function aggregate(snap) {
  const f = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const iType = f.indexOf("type");
  const iName = f.indexOf("name");
  const iSize = f.indexOf("self_size");
  const n = f.length;
  const out = new Map();
  for (let i = 0; i < snap.nodes.length; i += n) {
    const type = types[snap.nodes[i + iType]];
    if (type === "hidden" || type === "synthetic") continue;
    const raw = snap.strings[snap.nodes[i + iName]];
    const name = `${type}:${type === "string" || type === "concatenated string" ? "(string)" : raw.slice(0, 60)}`;
    const e = out.get(name) ?? { count: 0, size: 0 };
    e.count += 1;
    e.size += snap.nodes[i + iSize];
    out.set(name, e);
  }
  return out;
}

/**
 * Shortest retainer paths (BFS from the snapshot root over strong edges) to up to `limit` nodes matching
 * `match(type, name, selfSize)`. Each path lists `edge → type:name` from the root to the node.
 */
function retainerPaths(snap, match, limit) {
  const m = snap.snapshot.meta;
  const nf = m.node_fields.length;
  const ef = m.edge_fields.length;
  const nTypes = m.node_types[0];
  const eTypes = m.edge_types[0];
  const iType = m.node_fields.indexOf("type");
  const iName = m.node_fields.indexOf("name");
  const iSize = m.node_fields.indexOf("self_size");
  const iEdges = m.node_fields.indexOf("edge_count");
  const iEType = m.edge_fields.indexOf("type");
  const iEName = m.edge_fields.indexOf("name_or_index");
  const iETo = m.edge_fields.indexOf("to_node");
  const nodeCount = snap.nodes.length / nf;
  const firstEdge = new Uint32Array(nodeCount + 1);
  for (let n = 0; n < nodeCount; n++) firstEdge[n + 1] = firstEdge[n] + snap.nodes[n * nf + iEdges] * ef;
  const parent = new Int32Array(nodeCount).fill(-1);
  const parentEdge = new Int32Array(nodeCount).fill(-1);
  const seen = new Uint8Array(nodeCount);
  const queue = new Uint32Array(nodeCount);
  let head = 0;
  let tail = 0;
  queue[tail++] = 0;
  seen[0] = 1;
  while (head < tail) {
    const n = queue[head++];
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += ef) {
      const et = eTypes[snap.edges[e + iEType]];
      if (et === "weak" || et === "shortcut") continue;
      // PERF_RT_STRONG_ONLY: skip WeakMap (ephemeron) edges to find the strong retainer of a key.
      if (process.env.PERF_RT_STRONG_ONLY && et === "internal" && String(snap.strings[snap.edges[e + iEName]]).includes("part of key")) continue;
      const to = snap.edges[e + iETo] / nf;
      if (seen[to]) continue;
      seen[to] = 1;
      parent[to] = n;
      parentEdge[to] = e;
      queue[tail++] = to;
    }
  }
  const label = (n) => `${nTypes[snap.nodes[n * nf + iType]]}:${String(snap.strings[snap.nodes[n * nf + iName]]).slice(0, 70)}`;
  const edgeLabel = (e) => {
    const et = eTypes[snap.edges[e + iEType]];
    const v = snap.edges[e + iEName];
    return et === "element" || et === "hidden" ? `[${v}]` : String(snap.strings[v]).slice(0, 40);
  };
  const out = [];
  for (let n = 0; n < nodeCount && out.length < limit; n++) {
    const type = nTypes[snap.nodes[n * nf + iType]];
    const name = snap.strings[snap.nodes[n * nf + iName]];
    const size = snap.nodes[n * nf + iSize];
    if (!match(type, name, size) || !seen[n]) continue;
    const path = [];
    for (let c = n; c > 0 && parent[c] >= 0; c = parent[c]) path.unshift(`${edgeLabel(parentEdge[c])} → ${label(c)}`);
    out.push({ size, path: path.slice(-28) });
  }
  return out;
}

const session = (ctx) => [{ name: "session_token", value: ctx.session(1), domain: "localhost", path: "/", httpOnly: true, sameSite: "Strict" }];

async function open(browser, ctx, profile, path, { signedIn = false, init = [] } = {}) {
  const { context, page, cdp } = await newProfiledPage(browser, profile, { cookies: signedIn ? session(ctx) : [] });
  for (const script of init) await page.addInitScript(script);
  await page.goto(`${ctx.webOrigin}${path}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  return { context, page, cdp };
}

/** rAF frame intervals for `ms`, optionally while dragging across the canvas. */
async function frameTimes(page, ms, drag) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__framesOn) requestAnimationFrame(tick); };
    window.__framesOn = true;
    requestAnimationFrame(tick);
  });
  if (drag) {
    const box = await page.locator("canvas").first().boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      const end = Date.now() + ms;
      let i = 0;
      while (Date.now() < end) {
        await page.mouse.move(cx + Math.sin(i / 10) * box.width * 0.3, cy + Math.cos(i / 13) * box.height * 0.2, { steps: 2 });
        i++;
      }
      await page.mouse.up();
    }
  } else {
    await page.waitForTimeout(ms);
  }
  const frames = await page.evaluate(() => { window.__framesOn = false; return window.__frames.slice(1); });
  const s = summarize(frames);
  return { ...s, fps: frames.length ? Number((1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)).toFixed(1)) : 0, over33: frames.filter((f) => f > 33.4).length, frames: frames.length };
}

export async function run(ctx) {
  const results = {};
  const steps = process.env.PERF_RT_STEPS?.split(",").map(Number);
  const step = (n) => !steps || steps.includes(n);
  const gpu = await launchGuardedBrowser({ gpu: true });
  const soft = await launchGuardedBrowser({ gpu: false });
  try {
    // 1. 3D frame time.
    results.frameTime = {};
    if (step(1)) for (const [label, browser, profile] of [["desktop GPU", gpu, "desktop"], ["mobile 4× CPU GPU", gpu, "mobile"], ["low-end 4× CPU software GL", soft, "mobile"]]) {
      for (const path of ["/", "/explore"]) {
        const runs = { idle: [], orbit: [] };
        for (let r = 0; r < ctx.opts.runs; r++) {
          const { context, page } = await open(browser, ctx, profile, path);
          await page.waitForTimeout(2000);
          runs.idle.push(await frameTimes(page, 4000, false));
          runs.orbit.push(await frameTimes(page, 4000, true));
          await context.close();
        }
        for (const mode of ["idle", "orbit"]) {
          const s = acrossRuns(runs[mode], ["p50", "p95", "p99", "fps", "over33"]);
          results.frameTime[`${path} ${label} ${mode}`] = s;
          console.log(`[runtime] frames ${path} ${label} ${mode}: p50 ${s.p50.median} ms  p95 ${s.p95.median}  p99 ${s.p99.median}  fps ${s.fps.median}  >33ms ${s.over33.median}/4s`);
        }
      }
    }

    // 2. Leak check across client-side navigations.
    if (step(2)) {
      const { context, page, cdp } = await open(gpu, ctx, "desktop", "/", { init: [GL_COUNTERS] });
      await cdp.send("HeapProfiler.enable");
      const sample = async (cycle) => {
        await cdp.send("HeapProfiler.collectGarbage");
        const { usedSize } = await cdp.send("Runtime.getHeapUsage");
        const gl = await page.evaluate(() => ({ ...window.__gl, canvases: document.querySelectorAll("canvas").length }));
        return { cycle, heapMiB: Number((usedSize / 2 ** 20).toFixed(1)), ...gl };
      };
      const samples = [await sample(0)];
      for (let cycle = 1; cycle <= 20; cycle++) {
        for (const href of ["/periodic-table", "/explore", "/"]) {
          await page.locator(`nav a[href="${href}"]:visible, a[href="${href}"]:visible`).first().click({ timeout: 15_000 });
          await page.waitForURL((u) => new URL(u).pathname === href, { timeout: 30_000 });
          await page.waitForTimeout(href === "/periodic-table" ? 300 : 1200);
        }
        if (cycle % 5 === 0) samples.push(await sample(cycle));
      }
      results.leak = samples;
      console.log(`[runtime] leak: ${samples.map((s) => `c${s.cycle} ${s.heapMiB} MiB gl ${s.contexts}/${s.lost} canvas ${s.canvases}`).join(" | ")}`);
      await context.close();
    }

    // 3. Reduced motion.
    results.reducedMotion = {};
    if (step(3)) for (const reduce of [false, true]) {
      const { context, page } = await open(gpu, ctx, "desktop", "/", { init: [GL_COUNTERS] });
      if (reduce) await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForTimeout(2000);
      const before = await page.evaluate(() => window.__gl.draws);
      await page.waitForTimeout(3000);
      const perSecond = ((await page.evaluate(() => window.__gl.draws)) - before) / 3;
      results.reducedMotion[reduce ? "reduce" : "no-preference"] = { drawsPerSecond: Math.round(perSecond) };
      await context.close();
    }
    console.log(`[runtime] draws/s idle on "/": ${JSON.stringify(results.reducedMotion)}`);

    // 4. React commits.
    results.commits = {};
    if (step(4)) for (const [path, signedIn] of [["/periodic-table", false], ["/dashboard", true]]) {
      const { context, page } = await open(gpu, ctx, "desktop", path, { signedIn, init: [COMMIT_HOOK] });
      await page.waitForTimeout(1500);
      const atRest = await page.evaluate(() => window.__commits.n);
      await page.waitForTimeout(5000);
      const idle = (await page.evaluate(() => window.__commits.n)) - atRest;
      const entry = { afterLoad: atRest, idle5s: idle };
      if (path === "/periodic-table") {
        const before = await page.evaluate(() => window.__commits.n);
        const cells = page.locator('[aria-label*="atomic number"]:visible');
        for (let i = 0; i < 5; i++) {
          await cells.nth(i * 7).click();
          await page.waitForTimeout(300);
        }
        entry.perElementClick = ((await page.evaluate(() => window.__commits.n)) - before) / 5;
      }
      results.commits[path] = entry;
      await context.close();
    }
    console.log(`[runtime] React commits: ${JSON.stringify(results.commits)}`);

    // 5. Balance polling per tab.
    results.polling = {};
    if (step(5)) for (const [label, setup, hidden, ms] of [
      ["idle, visible", null, false, 60_000],
      ["idle, hidden", null, true, 60_000],
      ["after checkout, visible", "watch", false, 40_000],
      ["after checkout, hidden", "watch", true, 40_000],
    ]) {
      const watch = setup === "watch" ? [`try { sessionStorage.setItem("moleculestudio.checkout-watch", JSON.stringify({ baseline: 999999999, startedAt: Date.now(), packageId: "starter" })); } catch {}`] : [];
      const hide = hidden
        ? [`Object.defineProperty(document, "visibilityState", { get: () => "hidden" }); Object.defineProperty(document, "hidden", { get: () => true });`]
        : [];
      const { context, page } = await newProfiledPage(gpu, "desktop", { cookies: session(ctx) });
      for (const s of [...watch, ...hide]) await page.addInitScript(s);
      let count = 0;
      page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/billing/balance") count++; });
      await page.goto(`${ctx.webOrigin}/dashboard`, { waitUntil: "load" });
      const afterLoad = count;
      await page.waitForTimeout(ms);
      results.polling[label] = { onLoad: afterLoad, duringWindow: count - afterLoad, windowSeconds: ms / 1000 };
      await context.close();
    }
    console.log(`[runtime] balance requests: ${JSON.stringify(results.polling)}`);

    // 6. AI Lab long answer (markdown + KaTeX).
    await ctx.configureMock({ latency: { kind: "fixed", ms: 0 }, answerKind: "math", answerChars: 6000 });
    if (step(6)) {
      const runs = [];
      for (let r = 0; r < ctx.opts.runs; r++) {
        const { context, page } = await open(gpu, ctx, "desktop", "/ai-lab", { signedIn: true });
        await page.waitForTimeout(1500);
        await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask" }); });
        const box = page.locator("textarea:visible").first();
        await box.fill(`Explain benzene aromaticity, run ${r}.`);
        const t0 = Date.now();
        await page.locator('button[aria-label="Send message"]:visible').first().click();
        // Waits for the answer text: rehype-sanitize strips KaTeX's class names (the accepted SEC-15 rendering loss).
        await page.getByText("Hückel", { exact: false }).first().waitFor({ timeout: 30_000 }).catch(async (err) => {
          await page.screenshot({ path: `${ctx.runDir}/ai-lab-failure.png`, fullPage: true });
          ctx.note(`AI Lab: no answer after 30 s; visible text: ${(await page.locator("main").innerText()).slice(-600)}`);
          throw err;
        });
        const visibleMs = Date.now() - t0;
        await page.waitForTimeout(1000);
        const lt = await page.evaluate(() => window.__lt);
        runs.push({ visibleMs, longTaskTotal: Math.round(lt.reduce((a, b) => a + b, 0)), longestTask: Math.round(Math.max(0, ...lt)), katexNodes: await page.locator("main math").count() });
        await context.close();
      }
      results.aiLongAnswer = { summary: acrossRuns(runs, ["visibleMs", "longTaskTotal", "longestTask"]), katexNodes: runs[0]?.katexNodes, runs };
      console.log(`[runtime] AI long answer: ${JSON.stringify(results.aiLongAnswer.summary)} MathML nodes ${runs[0]?.katexNodes}`);
    }
    await ctx.configureMock({ latency: { kind: "fixed", ms: 0 }, answerKind: "plain", answerChars: 600 });

    // 7. Ledger table.
    if (step(7)) {
      const runs = [];
      for (let r = 0; r < ctx.opts.runs; r++) {
        const { context, page } = await open(gpu, ctx, "mobile", "/dashboard", { signedIn: true });
        await page.waitForTimeout(2000);
        const m = await collectMetrics(page);
        const dom = await page.evaluate(() => ({ nodes: document.getElementsByTagName("*").length, rows: document.querySelectorAll("table tr, [role=row]").length }));
        runs.push({ domNodes: dom.nodes, rows: dom.rows, tbtProxy: m.tbtProxy, lcp: m.lcp });
        await context.close();
      }
      results.ledger = { summary: acrossRuns(runs, ["domNodes", "rows", "tbtProxy", "lcp"]), runs };
      console.log(`[runtime] dashboard (mobile): ${JSON.stringify(results.ledger.summary)}`);
    }

    // 8. Caching and TTFB.
    if (step(8)) {
      const page = await (await gpu.newContext()).newPage();
      await page.goto(`${ctx.webOrigin}/explore`, { waitUntil: "load" });
      const chunk = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes("/_next/static/")));
      const hdri = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes("/hdri/")));
      await page.context().close();
      const head = async (url) => {
        const res = await fetch(url);
        await res.arrayBuffer();
        return { status: res.status, "cache-control": res.headers.get("cache-control"), "content-encoding": res.headers.get("content-encoding"), "content-security-policy": res.headers.get("content-security-policy") ? "present" : null };
      };
      results.cache = {
        page: await head(`${ctx.webOrigin}/explore`),
        nextStatic: chunk ? { url: new URL(chunk).pathname, ...(await head(chunk)) } : null,
        hdri: hdri ? { url: new URL(hdri).pathname, ...(await head(hdri)) } : null,
        favicon: await head(`${ctx.webOrigin}/favicon.ico`),
      };
      results.ttfb = {};
      for (const path of ["/", "/explore", "/periodic-table", "/login"]) {
        const t = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now();
          const res = await fetch(`${ctx.webOrigin}${path}`);
          const reader = res.body.getReader();
          await reader.read();
          t.push(performance.now() - start);
          await reader.cancel();
        }
        results.ttfb[path] = summarize(t.slice(2));
      }
      console.log(`[runtime] cache: ${JSON.stringify(results.cache)}`);
      console.log(`[runtime] TTFB (first byte of body): ${Object.entries(results.ttfb).map(([p, s]) => `${p} p50 ${s.p50} p95 ${s.p95}`).join(" | ")}`);
    }

    // 9. What the navigation cycles retain: heap snapshots after GC at cycle 5 and 15, grown constructors.
    if (step(9)) {
      const { context, page, cdp } = await open(gpu, ctx, "desktop", "/", { init: [GL_COUNTERS] });
      const cycle = async () => {
        for (const href of ["/periodic-table", "/explore", "/"]) {
          await page.locator(`nav a[href="${href}"]:visible, a[href="${href}"]:visible`).first().click({ timeout: 15_000 });
          await page.waitForURL((u) => new URL(u).pathname === href, { timeout: 30_000 });
          await page.waitForTimeout(href === "/periodic-table" ? 300 : 1200);
        }
      };
      const snapshot = async () => {
        const chunks = [];
        const onChunk = (e) => chunks.push(e.chunk);
        cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
        await cdp.send("HeapProfiler.collectGarbage");
        await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
        cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
        return aggregate(JSON.parse(chunks.join("")));
      };
      await cdp.send("HeapProfiler.enable");
      for (let i = 0; i < 5; i++) await cycle();
      const a = await snapshot();
      for (let i = 0; i < 10; i++) await cycle();
      const b = await snapshot();
      const grown = [...b.entries()]
        .map(([name, v]) => ({ name, count: v.count - (a.get(name)?.count ?? 0), kib: Number(((v.size - (a.get(name)?.size ?? 0)) / 1024).toFixed(1)) }))
        .filter((x) => x.count > 0)
        .sort((x, y) => y.kib - x.kib)
        .slice(0, 25);
      results.leakDiff = { cycles: "5 → 15", grown };
      console.log(`[runtime] retained growth over 10 cycles: ${grown.slice(0, 12).map((g) => `${g.name} +${g.count} (${g.kib} KiB)`).join(" | ")}`);
      await context.close();
    }

    // 10. Which page pair retains memory: growth per cycle after GC (ArrayBuffer backing store, JS heap, DOM).
    if (step(10)) {
      results.leakPairs = {};
      const pairs = process.env.PERF_RT_PAIR ? [process.env.PERF_RT_PAIR.split(",")] : [["/periodic-table", "/pricing"], ["/periodic-table", "/explore"], ["/periodic-table", "/"]];
      for (const pair of pairs) {
        const { context, page, cdp } = await open(gpu, ctx, "desktop", pair[0]);
        await cdp.send("HeapProfiler.enable");
        const measure = async () => {
          await cdp.send("HeapProfiler.collectGarbage");
          await page.waitForTimeout(300);
          await cdp.send("HeapProfiler.collectGarbage");
          const heap = await cdp.send("Runtime.getHeapUsage");
          const dom = await cdp.send("Memory.getDOMCounters");
          return { heapMiB: heap.usedSize / 2 ** 20, backingMiB: (heap.backingStorageSize ?? 0) / 2 ** 20, nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
        };
        const go = async (href) => {
          await page.locator(`a[href="${href}"]:visible`).first().click({ timeout: 15_000 });
          await page.waitForURL((u) => new URL(u).pathname === href, { timeout: 30_000 });
          await page.waitForTimeout(1200);
        };
        await go(pair[1]);
        await go(pair[0]);
        const start = await measure();
        const cycles = Number(process.env.PERF_RT_CYCLES || 6);
        for (let i = 0; i < cycles; i++) {
          await go(pair[1]);
          await go(pair[0]);
        }
        const end = await measure();
        const per = (k, d = 2) => Number(((end[k] - start[k]) / cycles).toFixed(d));
        results.leakPairs[pair.join(" ↔ ")] = { backingMiBPerCycle: per("backingMiB"), heapMiBPerCycle: per("heapMiB"), nodesPerCycle: per("nodes", 0), listenersPerCycle: per("listeners", 0), start, end };
        await context.close();
      }
      console.log(`[runtime] retained per cycle (pairs): ${JSON.stringify(Object.fromEntries(Object.entries(results.leakPairs).map(([k, v]) => [k, { backingMiB: v.backingMiBPerCycle, heapMiB: v.heapMiBPerCycle, nodes: v.nodesPerCycle, listeners: v.listenersPerCycle }])))}`);
    }


    // 11. Who keeps a retained environment-map buffer alive: shortest retainer path from the GC roots to the
    //     ≥ 4 MiB ArrayBuffer backing stores left after leaving "/" four times.
    if (step(11)) {
      const { context, page, cdp } = await open(gpu, ctx, "desktop", "/periodic-table");
      await cdp.send("HeapProfiler.enable");
      for (let i = 0; i < 4; i++) {
        for (const href of ["/", "/periodic-table"]) {
          await page.locator(`a[href="${href}"]:visible`).first().click({ timeout: 15_000 });
          await page.waitForURL((u) => new URL(u).pathname === href, { timeout: 30_000 });
          await page.waitForTimeout(1500);
        }
      }
      const chunks = [];
      const onChunk = (e) => chunks.push(e.chunk);
      cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
      const raw = chunks.join("");
      if (process.env.PERF_RT_SAVE_SNAPSHOT) (await import("node:fs")).writeFileSync(`${ctx.runDir}/leak.heapsnapshot`, raw);
      // PERF_RT_MATCH_NAME (e.g. HTMLCanvasElement) or PERF_RT_MIN_BYTES selects the retained objects to explain.
      const matchName = process.env.PERF_RT_MATCH_NAME;
      const minBytes = Number(process.env.PERF_RT_MIN_BYTES || 4 * 2 ** 20);
      const paths = retainerPaths(JSON.parse(raw), (type, name, size) => (matchName ? type === "native" && name === matchName : size >= minBytes), 4);
      results.leakRetainers = paths;
      for (const p of paths) console.log(`[runtime] retainer path (${p.size} B):\n  ${p.path.join("\n  ")}`);
      await context.close();
    }

    // 12. Locale content on demand (PERF-26) in the production build: a stored non-English locale switches the
    //     page after its content chunk arrives; English needs no extra request.
    if (step(12)) {
      results.locale = {};
      for (const stored of ["de", "en"]) {
        const { context, page } = await newProfiledPage(gpu, "desktop");
        await page.addInitScript((l) => window.localStorage.setItem("moleculestudio-locale", l), stored);
        const jsonChunks = [];
        page.on("response", (r) => { if (/\.js$/.test(new URL(r.url()).pathname)) jsonChunks.push(new URL(r.url()).pathname); });
        const t0 = Date.now();
        await page.goto(`${ctx.webOrigin}/explore`, { waitUntil: "load" });
        await page.waitForFunction((l) => document.documentElement.lang === l, stored, { timeout: 30_000 });
        const switchedMs = Date.now() - t0;
        const navText = await page.locator("nav").first().innerText();
        results.locale[stored] = { switchedMs, htmlLang: await page.evaluate(() => document.documentElement.lang), navSample: navText.slice(0, 80), jsRequests: jsonChunks.length };
        await context.close();
      }
      console.log(`[runtime] locale: ${JSON.stringify(results.locale)}`);
    }
  } finally {
    await gpu.close();
    await soft.close();
    ctx.record("runtime", results);
  }
}
