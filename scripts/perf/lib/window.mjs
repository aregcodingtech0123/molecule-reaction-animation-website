/** Summaries of the per-second process samples (preload PERF_PROC_LOG) inside a time window. */
import fs from "node:fs";

export function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const mib = (v) => Number((v / 2 ** 20).toFixed(1));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** ELU (mean / max), event-loop lag p99 (max of seconds), RSS / heap (max), handles / sockets (max, last). */
export function processWindow(file, start, end) {
  const rows = readJsonl(file).filter((r) => r.t >= start && r.t <= end);
  if (!rows.length) return null;
  const elu = rows.map((r) => r.elu).sort((a, b) => a - b);
  return {
    samples: rows.length,
    eluMean: Number((elu.reduce((a, b) => a + b, 0) / elu.length).toFixed(2)),
    eluP90: pct(elu, 90),
    lagP99MaxMs: Number(Math.max(...rows.map((r) => r.lagP99)).toFixed(1)),
    rssMaxMiB: mib(Math.max(...rows.map((r) => r.rss))),
    heapMaxMiB: mib(Math.max(...rows.map((r) => r.heapUsed))),
    handlesMax: Math.max(...rows.map((r) => r.handles ?? 0)),
    socketsMax: Math.max(...rows.map((r) => r.sockets ?? 0)),
    socketsLast: rows.at(-1).sockets ?? null,
  };
}
