/**
 * One-command perf runner (docs/performance/README.md).
 *
 *   node scripts/perf/run.mjs <scenario> [--runs 5] [--build] [--allow-stale] [--no-seed]
 *        [--seed-args "--users 1000 --rows 200"] [--concurrency 1,10] [--duration 20] [--warmup 5]
 *        [--gemini fixed:0|uniform:MIN:MAX|lognormal:MEDIAN:P95] [--gemini-failure RATE:MODE]
 *
 * Seeds the guarded perf DB (unless --no-seed), starts the production stack on dedicated ports,
 * runs every measurement of the scenario `--runs` times after one discarded warm-up run, and writes
 * perf-results/<timestamp>-<scenario>/result.json (gitignored) next to the servers' logs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { API_ORIGIN, RESULTS_DIR, WEB_ORIGIN, makeSecrets, perfDatabaseUrl, serviceRoot } from "./config.mjs";
import { acrossRuns, summarize } from "./lib/stats.mjs";
import { runClosedLoop } from "./lib/load.mjs";
import { mintSession } from "./lib/tokens.mjs";
import { loadPerfUsers, parseSeedArgs, seedPerfDatabase } from "./seed.mjs";
import { assertFreshBuild, buildAll, configureMock, startStack } from "./stack.mjs";

export const SCENARIOS = ["smoke", "balance", "history", "chat", "gemini-timeout"];

export function parseRunArgs(argv) {
  const [scenario, ...rest] = argv;
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`Usage: node scripts/perf/run.mjs <${SCENARIOS.join("|")}> [options] (docs/performance/README.md)`);
  }
  const o = {
    scenario,
    runs: 5,
    build: false,
    allowStale: false,
    seed: true,
    seedArgs: null,
    concurrency: null,
    duration: null,
    warmup: null,
    gemini: null,
    geminiFailure: null,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const value = () => {
      const v = rest[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--runs") o.runs = Number(value());
    else if (a === "--build") o.build = true;
    else if (a === "--allow-stale") o.allowStale = true;
    else if (a === "--no-seed") o.seed = false;
    else if (a === "--seed-args") o.seedArgs = value();
    else if (a === "--concurrency") o.concurrency = value().split(",").map(Number);
    else if (a === "--duration") o.duration = Number(value());
    else if (a === "--warmup") o.warmup = Number(value());
    else if (a === "--gemini") o.gemini = value();
    else if (a === "--gemini-failure") o.geminiFailure = value();
    else throw new Error(`Unknown option ${a}`);
  }
  if (!(Number.isInteger(o.runs) && o.runs >= 1)) throw new Error("--runs must be an integer ≥ 1");
  if (o.concurrency && !o.concurrency.every((c) => Number.isInteger(c) && c >= 1)) throw new Error("--concurrency: integers ≥ 1");
  return o;
}

/** "fixed:0" | "uniform:200:800" | "lognormal:1500:4000" → mock latency model. */
export function parseLatency(spec) {
  const [kind, a, b] = spec.split(":");
  if (kind === "fixed") return { kind, ms: Number(a) };
  if (kind === "uniform") return { kind, min: Number(a), max: Number(b) };
  if (kind === "lognormal") return { kind, median: Number(a), p95: Number(b) };
  throw new Error(`Unknown --gemini ${spec}`);
}

/** "0.1:hang" → { failureRate: 0.1, failureMode: "hang" } */
export function parseFailure(spec) {
  const [rate, mode = "500"] = spec.split(":");
  const failureRate = Number(rate);
  if (!(failureRate >= 0 && failureRate <= 1)) throw new Error("--gemini-failure rate must be within 0..1");
  return { failureRate, failureMode: mode };
}

async function machine() {
  const pg = createRequire(path.join(serviceRoot, "package.json"))("pg");
  const client = new pg.Client({ connectionString: perfDatabaseUrl() });
  await client.connect();
  const { rows } = await client.query("SHOW server_version");
  await client.end();
  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model.trim(),
    logicalCores: cpus.length,
    ramGiB: Number((os.totalmem() / 2 ** 30).toFixed(1)),
    os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    node: process.version,
    postgres: rows[0].server_version,
    postgresHost: "project test container (Docker), loopback port",
  };
}

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function processSummary(rows) {
  if (!rows.length) return undefined;
  const mib = (v) => Number((v / 2 ** 20).toFixed(1));
  return {
    samples: rows.length,
    rssStartMiB: mib(rows[0].rss),
    rssMaxMiB: mib(Math.max(...rows.map((r) => r.rss))),
    heapUsedMaxMiB: mib(Math.max(...rows.map((r) => r.heapUsed))),
    eluMax: Math.max(...rows.map((r) => r.elu)),
    lagP99MaxMs: Number(Math.max(...rows.map((r) => r.lagP99)).toFixed(2)),
  };
}

async function main() {
  const args = parseRunArgs(process.argv.slice(2));
  const scenario = await import(`./scenarios/${args.scenario}.mjs`);
  const defaults = scenario.defaults ?? {};
  const opts = {
    concurrency: args.concurrency ?? defaults.concurrency ?? [1, 10],
    durationMs: (args.duration ?? defaults.duration ?? 20) * 1000,
    warmupMs: (args.warmup ?? defaults.warmup ?? 5) * 1000,
    runs: args.runs,
    gemini: parseLatency(args.gemini ?? defaults.gemini ?? "fixed:0"),
    geminiFailure: args.geminiFailure ? parseFailure(args.geminiFailure) : null,
  };

  const secrets = makeSecrets();
  if (args.build) buildAll(secrets);
  const build = assertFreshBuild({ allowStale: args.allowStale });

  const seedOptions = parseSeedArgs((args.seedArgs ?? defaults.seedArgs ?? "").split(/\s+/).filter(Boolean));
  const seed = args.seed
    ? await seedPerfDatabase(seedOptions)
    : JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, "seed-manifest.json"), "utf8"));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(RESULTS_DIR, `${stamp}-${args.scenario}`);
  const stackOptions = scenario.stack ?? {};
  const stack = await startStack({
    secrets,
    runDir,
    hopLog: stackOptions.hopLog ?? false,
    procLog: stackOptions.procLog ?? true,
    apiOverrides: stackOptions.apiOverrides,
    webOverrides: stackOptions.webOverrides,
  });

  const result = {
    scenario: args.scenario,
    startedAt: new Date().toISOString(),
    machine: await machine(),
    build,
    seed,
    options: opts,
    envOverrides: { api: stackOptions.apiOverrides ?? {}, web: stackOptions.webOverrides ?? {} },
    instrumentation: { hopLog: Boolean(stack.files.hopLog), procLog: Boolean(stack.files.apiProcLog) },
    measurements: {},
    notes: [],
  };

  let failed = null;
  try {
    const users = await loadPerfUsers();
    const session = (i) => {
      const user = users[i];
      user.token ??= mintSession(secrets.jwt, user);
      return user.token;
    };
    // The minted claims must be the service's: one authenticated call before measuring anything.
    const me = await fetch(`${API_ORIGIN}/api/auth/me`, { headers: { authorization: `Bearer ${session(1)}` } });
    if (me.status !== 200) throw new Error(`[perf] minted session refused by Express (HTTP ${me.status})`);

    await configureMock({ latency: opts.gemini, ...(opts.geminiFailure ?? {}) });

    const ctx = {
      opts,
      users,
      session,
      webOrigin: WEB_ORIGIN,
      apiOrigin: API_ORIGIN,
      configureMock,
      note: (text) => result.notes.push(text),
      /** Scenario-specific data that is not a closed-loop measurement. */
      record: (key, value) => {
        (result.records ??= {})[key] = value;
      },
      /** One discarded warm-up run (≤ 5 s), then `runs` measured runs, with the per-hop breakdown when on. */
      async measure(name, load) {
        console.log(`[perf] ${name}: warm-up + ${opts.runs} run(s)`);
        await runClosedLoop({ ...load, durationMs: Math.min(opts.durationMs, 5000), warmupMs: 0 });
        const runs = [];
        for (let r = 0; r < opts.runs; r++) {
          const run = await runClosedLoop({ durationMs: opts.durationMs, warmupMs: opts.warmupMs, ...load });
          if (stack.files.hopLog) {
            await sleep(1500); // the preload flushes once a second
            const hops = readJsonl(stack.files.hopLog).filter((h) => h.t >= run.windowStart && h.t <= run.windowEnd);
            const byHop = {};
            for (const h of hops) (byHop[h.hop] ??= []).push(h.ms);
            run.hops = Object.fromEntries(Object.entries(byHop).map(([k, v]) => [k, summarize(v)]));
          }
          runs.push(run);
          console.log(
            `        run ${r + 1}: p50 ${run.p50} ms  p95 ${run.p95} ms  p99 ${run.p99} ms  ${run.rps} req/s  n ${run.n}  failures ${run.failures}`,
          );
        }
        const hopNames = [...new Set(runs.flatMap((r) => Object.keys(r.hops ?? {})))];
        result.measurements[name] = {
          summary: acrossRuns(runs),
          hops: hopNames.length
            ? Object.fromEntries(hopNames.map((h) => [h, acrossRuns(runs.map((r) => r.hops?.[h]), ["p50", "p95", "p99", "mean"])]))
            : undefined,
          failures: runs.reduce((a, r) => a + r.failures, 0),
          statuses: runs.reduce((acc, r) => {
            for (const [k, v] of Object.entries(r.statuses)) acc[k] = (acc[k] ?? 0) + v;
            return acc;
          }, {}),
          runs,
        };
        return result.measurements[name];
      },
    };

    await scenario.run(ctx);
  } catch (err) {
    failed = err;
    result.error = String(err?.stack ?? err);
  } finally {
    await stack.stop();
    await sleep(500);
    // Only samples inside measured windows: startup and warm-up are not the system under load.
    const windows = Object.values(result.measurements).flatMap((m) => m.runs.map((r) => [r.windowStart - 1000, r.windowEnd + 1000]));
    const inWindow = (p) => windows.some(([a, b]) => p.t >= a && p.t <= b);
    const proc = [...readJsonl(stack.files.apiProcLog), ...readJsonl(stack.files.webProcLog)].filter(inWindow);
    if (proc.length) {
      result.process = {
        api: processSummary(proc.filter((p) => p.proc === "api")),
        web: processSummary(proc.filter((p) => p.proc === "web")),
      };
    }
    result.finishedAt = new Date().toISOString();
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`[perf] result: ${path.relative(process.cwd(), path.join(runDir, "result.json"))}`);
    for (const [name, m] of Object.entries(result.measurements)) {
      const s = m.summary;
      console.log(
        `  ${name}: p50 ${s.p50?.median} ms (spread ${s.p50?.spreadPct}%)  p95 ${s.p95?.median} ms (spread ${s.p95?.spreadPct}%)  ` +
          `${s.rps?.median} req/s  failures ${m.failures}`,
      );
    }
  }
  if (failed) throw failed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
