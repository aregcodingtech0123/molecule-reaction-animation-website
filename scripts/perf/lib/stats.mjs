/** Summary statistics for the perf harness. Percentiles use the nearest-rank method on sorted samples. */

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const round = (v, d = 2) => (v === null || v === undefined ? null : Number(v.toFixed(d)));

/** Latency samples (ms) → summary. */
export function summarize(samples) {
  const sorted = Float64Array.from(samples).sort();
  const n = sorted.length;
  const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : null;
  return {
    n,
    min: round(sorted[0] ?? null),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[n - 1] ?? null),
    mean: round(mean),
  };
}

/**
 * Per-run summaries → the reported figure: median of each metric across runs, and its spread
 * (min, max and (max - min) / median in %), so noise is visible next to every number.
 * @returns {Record<string, { median: number, min: number, max: number, spreadPct: number | null }>}
 */
export function acrossRuns(runSummaries, keys = ["p50", "p95", "p99", "mean", "rps"]) {
  /** @type {Record<string, { median: number, min: number, max: number, spreadPct: number | null }>} */
  const out = {};
  for (const key of keys) {
    const values = runSummaries.map((r) => r?.[key]).filter((v) => typeof v === "number").sort((a, b) => a - b);
    if (values.length === 0) continue;
    const mid = values.length / 2;
    const median = values.length % 2 ? values[Math.floor(mid)] : (values[mid - 1] + values[mid]) / 2;
    out[key] = {
      median: round(median),
      min: round(values[0]),
      max: round(values[values.length - 1]),
      spreadPct: median ? round(((values[values.length - 1] - values[0]) / median) * 100, 1) : null,
    };
  }
  return out;
}
