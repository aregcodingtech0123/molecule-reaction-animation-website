/**
 * The performance harness (scripts/perf, docs/performance/README.md) is a measuring instrument: its
 * statistics, randomness, argument parsing and mock Gemini must be right before any number it
 * produces is trusted. Pure parts and the in-process mock only — no stack is started here.
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GEMINI_HOST, geminiRedirect } from "../../scripts/perf/lib/gemini-redirect.mjs";
import { GUARD_MARKER, assertNetworkGuard, assertServerGuarded } from "../../scripts/perf/lib/guard.mjs";
import { checkBudget } from "../../scripts/perf/bundle-budget.mjs";
import { bucket } from "../../scripts/perf/bundle-report.mjs";
import { acrossRuns, percentile, summarize } from "../../scripts/perf/lib/stats.mjs";
import { latencySampler, seededRandom } from "../../scripts/perf/lib/random.mjs";
import { clientIp, rotatingUser } from "../../scripts/perf/lib/requests.mjs";
import { createMockGemini } from "../../scripts/perf/mock-gemini.mjs";
import { runOpenLoop } from "../../scripts/perf/lib/load.mjs";
import { MIX, mixedTraffic } from "../../scripts/perf/lib/mixed.mjs";
import { processWindow } from "../../scripts/perf/lib/window.mjs";
import { stepBroke } from "../../scripts/perf/scenarios/ramp.mjs";
import { parseFailure, parseLatency, parseRunArgs } from "../../scripts/perf/run.mjs";
import { SEED_DEFAULTS, parseSeedArgs } from "../../scripts/perf/seed.mjs";
import { perfDatabaseUrl } from "../../scripts/perf/config.mjs";

describe("stats", () => {
  it("nearest-rank percentiles", () => {
    const sorted = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([percentile(sorted, 50), percentile(sorted, 90), percentile(sorted, 95), percentile(sorted, 100)]).toEqual([5, 9, 10, 10]);
    expect(percentile(new Float64Array(), 50)).toBeNull();
  });

  it("summarize sorts numerically, not lexically", () => {
    expect(summarize([10, 9, 100, 2])).toMatchObject({ n: 4, min: 2, p50: 9, max: 100, mean: 30.25 });
  });

  it("across runs: median of each metric and its spread", () => {
    const runs = [{ p95: 10 }, { p95: 12 }, { p95: 11 }, { p95: 30 }, { p95: 9 }];
    expect(acrossRuns(runs, ["p95"]).p95).toEqual({ median: 11, min: 9, max: 30, spreadPct: 190.9 });
    expect(acrossRuns([{ p95: 4 }, { p95: 6 }], ["p95"]).p95.median).toBe(5);
  });
});

describe("seeded randomness", () => {
  it("same seed, same sequence; different seed, different sequence", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c)).not.toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("lognormal latency hits its median and p95 (within sampling error)", () => {
    const sample = latencySampler({ kind: "lognormal", median: 1500, p95: 4000 }, seededRandom(1));
    const sorted = Float64Array.from({ length: 20_000 }, sample).sort();
    expect(percentile(sorted, 50)).toBeGreaterThan(1500 * 0.95);
    expect(percentile(sorted, 50)).toBeLessThan(1500 * 1.05);
    expect(percentile(sorted, 95)).toBeGreaterThan(4000 * 0.93);
    expect(percentile(sorted, 95)).toBeLessThan(4000 * 1.07);
  });

  it("fixed and uniform models; invalid models are refused", () => {
    expect(latencySampler({ kind: "fixed", ms: 25 }, seededRandom(1))()).toBe(25);
    const u = latencySampler({ kind: "uniform", min: 100, max: 200 }, seededRandom(1));
    expect(Array.from({ length: 100 }, u).every((v) => v >= 100 && v < 200)).toBe(true);
    expect(() => latencySampler({ kind: "lognormal", median: 10, p95: 5 }, seededRandom(1))).toThrow(/median < p95/);
    expect(() => latencySampler({ kind: "nope" }, seededRandom(1))).toThrow(/Unknown latency kind/);
  });
});

describe("argument parsing", () => {
  it("run options and defaults", () => {
    expect(parseRunArgs(["chat"])).toMatchObject({ scenario: "chat", runs: 5, build: false, seed: true });
    expect(parseRunArgs(["balance", "--runs", "7", "--concurrency", "1,10,50", "--no-seed", "--build"])).toMatchObject({
      runs: 7,
      concurrency: [1, 10, 50],
      seed: false,
      build: true,
    });
    expect(() => parseRunArgs(["nope"])).toThrow(/Usage/);
    expect(() => parseRunArgs(["chat", "--runs", "0"])).toThrow(/--runs/);
    expect(() => parseRunArgs(["chat", "--concurrency", "1,x"])).toThrow(/--concurrency/);
    expect(() => parseRunArgs(["chat", "--bogus"])).toThrow(/Unknown option/);
    expect(() => parseRunArgs(["chat", "--runs"])).toThrow(/needs a value/);
  });

  it("latency and failure specs", () => {
    expect(parseLatency("fixed:0")).toEqual({ kind: "fixed", ms: 0 });
    expect(parseLatency("lognormal:1500:4000")).toEqual({ kind: "lognormal", median: 1500, p95: 4000 });
    expect(parseFailure("0.1:hang")).toEqual({ failureRate: 0.1, failureMode: "hang" });
    expect(() => parseFailure("2")).toThrow(/0..1/);
  });

  it("seed options", () => {
    expect(parseSeedArgs([])).toEqual(SEED_DEFAULTS);
    expect(parseSeedArgs(["--users", "5000", "--rows", "20"])).toMatchObject({ users: 5000, rows: 20 });
    expect(() => parseSeedArgs(["--rows", "0"])).toThrow(/≥ 1/);
    expect(() => parseSeedArgs(["--users", "-1"])).toThrow(/non-negative/);
  });
});

describe("safety and request shapes", () => {
  it("the perf database is the guarded local test database", () => {
    const url = new URL(perfDatabaseUrl());
    expect(url.pathname).toBe("/moleculestudio_perf_test");
    expect(["127.0.0.1", "localhost", "::1", "[::1]", "postgres"]).toContain(url.hostname);
  });

  it("each virtual user gets its own client IP; rotation never picks the hot user", () => {
    expect(new Set(Array.from({ length: 300 }, (_, vu) => clientIp(vu))).size).toBe(300);
    const pick = rotatingUser(11, 4);
    const picked = Array.from({ length: 40 }, (_, i) => pick({ vu: i % 4, iteration: Math.floor(i / 4) }));
    expect(Math.min(...picked)).toBe(1);
    expect(Math.max(...picked)).toBe(10);
  });
});

describe("mock Gemini", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  async function start(config: Record<string, unknown>) {
    const mock = createMockGemini();
    mock.configure(config);
    await new Promise<void>((r) => mock.server.listen(0, "127.0.0.1", () => r()));
    close = mock.close;
    const { port } = mock.server.address() as AddressInfo;
    return (signal?: AbortSignal) =>
      fetch(`http://127.0.0.1:${port}/v1beta/models/m:generateContent`, { method: "POST", body: "{}", signal });
  }

  it("answers in the Gemini REST shape after the configured latency", async () => {
    const call = await start({ latency: { kind: "fixed", ms: 120 }, answerChars: 50 });
    const t = performance.now();
    const res = await call();
    expect(performance.now() - t).toBeGreaterThanOrEqual(110);
    const body = await res.json();
    expect(body.candidates[0].content.parts[0].text.length).toBeLessThanOrEqual(50);
  });

  it("injects failures at the configured rate and mode", async () => {
    const call = await start({ failureRate: 1, failureMode: "503" });
    expect((await call()).status).toBe(503);
  });

  it("'empty' answers 200 without text; 'hang' never answers (the caller's timeout fires)", async () => {
    const empty = await start({ failureRate: 1, failureMode: "empty" });
    expect((await (await empty()).json()).candidates[0].content.parts[0].text).toBe("");
    await close?.();
    const hang = await start({ failureRate: 1, failureMode: "hang" });
    await expect(hang(AbortSignal.timeout(200))).rejects.toThrow(/abort|timeout/i);
  });
});

describe("Gemini redirect (PERF-21)", () => {
  it("rewrites only the URL: the caller's init object (and its abort signal) is passed on as is", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const inner = (async (input: unknown, init: unknown) => {
      calls.push([input, init]);
      return new Response("{}");
    }) as unknown as typeof fetch;
    const redirect = geminiRedirect(inner, "http://127.0.0.1:4290");
    const init = { method: "POST", body: "{}", signal: AbortSignal.timeout(1000) };
    await redirect(`https://${GEMINI_HOST}/v1beta/models/m:generateContent?alt=x`, init);
    expect(calls[0]![0]).toBe("http://127.0.0.1:4290/v1beta/models/m:generateContent?alt=x");
    expect(calls[0]![1]).toBe(init);
    await redirect("http://127.0.0.1:4200/health", undefined);
    expect(calls[1]![0]).toBe("http://127.0.0.1:4200/health");
    expect(() => geminiRedirect(inner, undefined)(`https://${GEMINI_HOST}/x`, {})).toThrow(/PERF_GEMINI_ORIGIN/);
  });

  it("a hanging model call still aborts at its timeout while full GCs run (child process, --expose-gc)", () => {
    const root = path.resolve(__dirname, "../..");
    const port = 43_000 + Math.floor(Math.random() * 1000);
    const res = spawnSync(
      process.execPath,
      ["--expose-gc", "--import", pathToFileURL(path.join(root, "scripts/perf/preload.mjs")).href, path.join(root, "tests/support/perf-gemini-abort.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PERF_GEMINI_ORIGIN: `http://127.0.0.1:${port}`, MOCK_PORT: String(port) } as unknown as NodeJS.ProcessEnv,
      },
    );
    const line = res.stdout.trim().split(/\r?\n/).at(-1) ?? "";
    expect(line, res.stderr).toMatch(/^\{/);
    const out = JSON.parse(line) as { name: string; ms: number };
    expect(out.name).toBe("AbortError");
    expect(out.ms).toBeGreaterThanOrEqual(1400);
    expect(out.ms).toBeLessThan(5000);
  });
});

describe("network guard enforcement (Part 1 incident: no harness run without the guard)", () => {
  const root = path.resolve(__dirname, "../..");
  const bareEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } as unknown as NodeJS.ProcessEnv;
  const node = (args: string[]) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 30_000, env: bareEnv });

  it("in this (guarded) test process the check passes", () => {
    expect(() => assertNetworkGuard("a test")).not.toThrow();
  });

  it("a bare `node experiment.mjs` using the in-process mock is refused before anything runs", () => {
    const res = node([path.join(root, "tests/support/perf-isolate-probe.mjs")]);
    const out = JSON.parse(res.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") as { mock?: string; external?: string };
    expect(out.mock).toMatch(/refusing to run createMockGemini\(\) in-process without the network guard/);
  });

  it("through scripts/perf/isolate.mjs the mock is allowed and the real Gemini host is still blocked", () => {
    const res = node([path.join(root, "scripts/perf/isolate.mjs"), "tests/support/perf-isolate-probe.mjs"]);
    expect(JSON.parse(res.stdout.trim().split(/\r?\n/).at(-1) ?? "{}"), res.stderr).toEqual({ mock: "ok", external: "BlockedNetworkError" });
  });

  it("the perf preload announces the guard; a server log without that line is refused", () => {
    const res = node(["--import", pathToFileURL(path.join(root, "scripts/perf/preload.mjs")).href, "-e", "0"]);
    expect(res.stderr).toContain(GUARD_MARKER);
    expect(res.stdout).not.toContain(GUARD_MARKER); // stdout stays clean for tools that parse it
    expect(() => assertServerGuarded(`boot\n${GUARD_MARKER}\nready`, "api")).not.toThrow();
    expect(() => assertServerGuarded("boot\nready", "web")).toThrow(/web server started without the network guard/);
  });

  it("perf servers keep no call log (it grew without bound in the Part 3 soak); stubs and blocking are unchanged", () => {
    const guard = pathToFileURL(path.join(root, "scripts/test/network-guard.mjs")).href;
    const probe = `
      const { externalCalls } = await import(${JSON.stringify(guard)});
      const lemon = await fetch("https://api.lemonsqueezy.com/v1/checkouts", { method: "POST", body: "{}" });
      const blocked = await fetch("https://example.com/").then(() => "reached", (e) => e.name);
      console.log(JSON.stringify({ lemon: lemon.status, blocked, recorded: externalCalls.length }));`;
    const res = node(["--import", pathToFileURL(path.join(root, "scripts/perf/preload.mjs")).href, "--input-type=module", "-e", probe]);
    expect(JSON.parse(res.stdout.trim().split(/\r?\n/).at(-1) ?? "{}"), res.stderr).toEqual({ lemon: 201, blocked: "BlockedNetworkError", recorded: 0 });
  });
});

describe("bundle budget (Part 2)", () => {
  const budget = { routes: { "/": 900, "/login": 380 }, routesWith3d: ["/"], englishLocaleMaxKiB: 12 };
  const route = (js: number, groups: Record<string, number> = {}) => ({ jsCompressedKiB: js, byGroupKiB: groups });

  it("passes the measured state", () => {
    const report = { "/": route(808, { "three / @react-three / postprocessing": 358, "locale content (12 locales)": 8.5 }), "/login": route(345, { "locale content (12 locales)": 8.5 }) };
    expect(checkBudget(report, budget)).toEqual([]);
  });

  it("catches each regression Part 2 removed", () => {
    const report = {
      "/": route(950, { "markdown + KaTeX": 128.7 }),
      "/login": route(374, { "three / @react-three / postprocessing": 96.5, "locale content (12 locales)": 109.6 }),
    };
    const problems = checkBudget(report, budget).join(" | ");
    expect(problems).toMatch(/\/: initial JS 950 KiB > ceiling 900 KiB/);
    expect(problems).toMatch(/\/: 128.7 KiB of the markdown \/ KaTeX renderer/);
    expect(problems).toMatch(/\/login: 96.5 KiB of three.js/);
    expect(problems).toMatch(/\/login: 109.6 KiB of locale content/);
    expect(checkBudget({ "/": route(800) }, budget)).toEqual(["/login: missing from the analysis"]);
  });

  it("buckets module paths as the budget rules expect", () => {
    expect(bucket("[project]/node_modules/three/build/three.core.js")).toBe("three / @react-three / postprocessing");
    expect(bucket("[project]/node_modules/react-markdown/lib/index.js")).toBe("markdown + KaTeX");
    expect(bucket("[project]/src/lib/i18n/content/de.json")).toBe("locale content (12 locales)");
    expect(bucket("[project]/src/app/page.tsx")).toBe("app code (src)");
  });
});

describe("load and soak harness (Part 3)", () => {
  const ctx = {
    users: Array.from({ length: 51 }, (_, i) => ({ id: `u${i}`, email: `u${i}@perf.example` })),
    session: (i: number) => `token-${i}`,
    webOrigin: "http://localhost:3200",
    apiOrigin: "http://127.0.0.1:4200",
    webhookSecret: "whsec-test",
    internalKey: "internal-test",
  };
  type Arrival = { kind: string; origin: string; spec: { method?: string; path: string; headers: Record<string, string>; body?: string; then?: () => Arrival["spec"] } };

  it("every 100 arrivals follow the mix weights, interleaved; webhooks are signed over the raw body with unique order ids", () => {
    const pick = mixedTraffic(ctx, { runTag: "t" }) as (i: number) => Arrival;
    const arrivals = Array.from({ length: 200 }, (_, i) => pick(i));
    const counts = arrivals.slice(0, 100).reduce<Record<string, number>>((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {});
    expect(counts).toEqual(Object.fromEntries(MIX));
    expect(arrivals.slice(0, 10).map((r) => r.kind)).not.toEqual(Array(10).fill("page")); // not in blocks
    const hooks = arrivals.filter((r) => r.kind === "webhook");
    for (const h of hooks) {
      expect(h.origin).toBe(ctx.apiOrigin);
      expect(h.spec.headers["x-signature"]).toBe(createHmac("sha256", ctx.webhookSecret).update(h.spec.body ?? "").digest("hex"));
    }
    expect(new Set(hooks.map((h) => JSON.parse(h.spec.body ?? "{}").data.id)).size).toBe(hooks.length);
    expect(new Set(arrivals.map((r) => r.spec.headers["x-forwarded-for"])).size).toBe(200); // a client per arrival
    expect(arrivals.some((r) => r.spec.headers.cookie === "session_token=token-0")).toBe(false); // never the hot user
  });

  it("target api: no pages, BFF headers on every Express call, chat = consume then capture of the same reservation", () => {
    const pick = mixedTraffic(ctx, { runTag: "t", target: "api" }) as (i: number) => Arrival;
    const arrivals = Array.from({ length: 65 }, (_, i) => pick(i));
    expect(arrivals.some((r) => r.kind === "page")).toBe(false);
    for (const r of arrivals) {
      expect(r.origin).toBe(ctx.apiOrigin);
      if (r.kind !== "webhook") expect(r.spec.headers).toMatchObject({ "x-internal-service-key": "internal-test", "x-client-ip": expect.stringMatching(/^10\./) });
    }
    const chat = arrivals.find((r) => r.kind === "chat")!;
    const next = chat.spec.then!();
    expect([chat.spec.path, next.path]).toEqual(["/api/billing/consume", "/api/billing/capture"]);
    expect(JSON.parse(next.body ?? "{}").referenceId).toBe(JSON.parse(chat.spec.body ?? "{}").referenceId);
    expect(arrivals.find((r) => r.kind === "login")!.spec.headers.authorization).toBeUndefined();
  });

  it("open loop: arrivals keep their schedule while the server is slow; follow-ups are chained; overflow is dropped, not queued", async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url ?? "");
      setTimeout(() => res.end("ok"), req.url === "/slow" ? 300 : 0);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // runOpenLoop is plain JS: its per-kind summaries are typed here.
    type Kinds = Record<string, { p50: number; dropped: number }>;
    try {
      const results: number[] = [];
      const run = await runOpenLoop({
        ratePerSec: 50,
        durationMs: 400,
        pick: (i: number) => ({ kind: i % 2 ? "slow" : "pair", origin, spec: i % 2 ? { path: "/slow" } : { path: "/a", then: () => ({ path: "/b" }) } }),
        onResult: (r: { status: number }) => results.push(r.status),
      });
      expect(run.total).toBe(20);
      expect(run.achievedPerSec).toBeGreaterThan(40); // not throttled by the 300 ms answers
      expect((run.kinds as Kinds).slow.p50).toBeGreaterThanOrEqual(290);
      expect(seen.filter((u) => u === "/a").length).toBe(seen.filter((u) => u === "/b").length);
      expect(results).toEqual(Array(20).fill(200));

      const capped = await runOpenLoop({ ratePerSec: 100, durationMs: 300, maxInFlight: 2, pick: () => ({ kind: "slow", origin, spec: { path: "/slow" } }) });
      expect((capped.kinds as Kinds).slow.dropped).toBeGreaterThan(0);
      expect(stepBroke(capped)).toMatch(/error rate/); // a dropped arrival counts as an error
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("a ramp step breaks on > 1 % errors, drops, or a non-chat p95 over 1 s (chat waits for the model)", () => {
    const kinds = (over: Record<string, unknown> = {}) => ({ page: { p95: 90, dropped: 0 }, chat: { p95: 9000, dropped: 0 }, ...over });
    expect(stepBroke({ errorRatePct: 0, kinds: kinds() })).toBeNull();
    expect(stepBroke({ errorRatePct: 1.59, kinds: kinds() })).toMatch(/error rate 1.59/);
    expect(stepBroke({ errorRatePct: 0, kinds: kinds({ balance: { p95: 3238, dropped: 0 } }) })).toMatch(/balance 3238 ms/);
  });

  it("process window: summarises only the samples inside the window", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-window-"));
    const file = path.join(dir, "proc.jsonl");
    const row = (t: number, elu: number, sockets: number) => JSON.stringify({ t, elu, lagP99: elu * 100, rss: 2 ** 20 * 100 * elu, heapUsed: 2 ** 20 * 10, handles: sockets + 5, sockets });
    try {
      fs.writeFileSync(file, [row(1, 0.9, 50), row(2, 0.2, 3), row(3, 0.4, 7), row(4, 1, 99)].join("\n"));
      expect(processWindow(file, 2, 3)).toEqual({ samples: 2, eluMean: 0.3, eluP90: 0.4, lagP99MaxMs: 40, rssMaxMiB: 40, heapMaxMiB: 10, handlesMax: 12, socketsMax: 7, socketsLast: 7 });
      expect(processWindow(file, 10, 20)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
