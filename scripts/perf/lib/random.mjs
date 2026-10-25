/** Deterministic randomness for the perf harness (same seed → same sequence on every machine). */

/** mulberry32: small, fast, good enough for latency sampling. Returns floats in [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
function normal(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Latency model → sampler (ms).
 *   { kind: "fixed", ms }
 *   { kind: "uniform", min, max }
 *   { kind: "lognormal", median, p95 }   (right-skewed, like real model latency)
 */
export function latencySampler(model, rand) {
  switch (model?.kind ?? "fixed") {
    case "fixed":
      return () => Math.max(0, Number(model?.ms ?? 0));
    case "uniform": {
      const { min, max } = model;
      return () => min + (max - min) * rand();
    }
    case "lognormal": {
      const { median, p95 } = model;
      if (!(median > 0 && p95 > median)) throw new Error("lognormal needs 0 < median < p95");
      const mu = Math.log(median);
      const sigma = (Math.log(p95) - mu) / 1.6448536269514722;
      return () => Math.exp(mu + sigma * normal(rand));
    }
    default:
      throw new Error(`Unknown latency kind ${JSON.stringify(model.kind)}`);
  }
}
