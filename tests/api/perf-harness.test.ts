/**
 * The performance harness (scripts/perf, docs/performance/README.md) is a measuring instrument: its
 * statistics, randomness, argument parsing and mock Gemini must be right before any number it
 * produces is trusted. Pure parts and the in-process mock only — no stack is started here.
 */
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GEMINI_HOST, geminiRedirect } from "../../scripts/perf/lib/gemini-redirect.mjs";
import { GUARD_MARKER, assertNetworkGuard, assertServerGuarded } from "../../scripts/perf/lib/guard.mjs";
import { acrossRuns, percentile, summarize } from "../../scripts/perf/lib/stats.mjs";
import { latencySampler, seededRandom } from "../../scripts/perf/lib/random.mjs";
import { clientIp, rotatingUser } from "../../scripts/perf/lib/requests.mjs";
import { createMockGemini } from "../../scripts/perf/mock-gemini.mjs";
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
});
