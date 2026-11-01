# Core Web Vitals — R10, R11, R12 (SEO-18)

Measured 2026-11-01 with `scripts/seo/lighthouse-public.mjs`: production build (`next build` + `next start`, perf-harness
environment, network guard on, Chromium resolving only localhost), Lighthouse 13.5 (mobile = simulated slow 4G + 4× CPU,
desktop preset), one discarded warm-up + **5 runs** per cell, median [min–max]. Public routes only, no Express or
database. Reproduce:

```
node scripts/perf/run.mjs <scenario> --build        # or: next build with the perf webEnv (builds .next-perf)
MSYS_NO_PATHCONV=1 node scripts/perf/isolate.mjs scripts/seo/lighthouse-public.mjs --label x --runs 5 --routes /,/explore
```

"LCP (sim)" is Lighthouse's simulated figure (what the earlier performance phase reported: 3.3–3.6 s); "LCP (obs)" is
what the browser actually observed unthrottled. CLS was 0.000 in every run of every variant.

## R11 — fonts (decision D7: preload only the display font, compare with `display: optional`)

Variants: **A** current (Inter + Syne, both preloaded, `swap`) · **B** only Syne (display font) preloaded, Inter loaded on
demand, Next's size-adjusted fallback for both · **C** = B + `display: "optional"` on both.

| Route / profile | Variant | Score | LCP (sim) ms | LCP (obs) ms | FCP ms | TBT ms | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` mobile | A | 69 | 3 609 | 473 | **1 207** | 889 | 0 |
| | B | 71 | 3 462 | 461 | 1 509 | 801 | 0 |
| | C | 72 | 3 609 | 451 | 1 510 | 724 | 0 |
| `/explore` mobile | A | 74 | 3 612 | 452 | **1 207** | 578 | 0 |
| | B | 73 | 3 610 | 460 | 1 509 | 549 | 0 |
| | C | 75 | 3 609 | 433 | 1 509 | 534 | 0 |
| `/periodic-table` mobile | A / B / C | 88 / 88 / 88 | 3 760 / 3 761 / 3 760 | 285 / 306 / 279 | **1 208** / 1 511 / 1 510 | 116 / 120 / 104 | 0 |
| `/pricing` mobile | A / B / C | 88 / 88 / 88 | 3 797 / 3 794 / 3 798 | 362 / 353 / 364 | **1 055** / 1 357 / 1 358 | 116 / 82 / 88 | 0 |
| desktop (all four routes) | A / B / C | 92–100 | 730–826 / 730–795 / 730–805 | 297–558 / 321–440 / 285–450 | 292–333 (all) | – | 0 |

**Result: no variant improves LCP.** Simulated LCP is identical within noise (3.6 s / 3.8 s) and the browser-observed LCP
(0.3–0.5 s) does not move; B and C make mobile **FCP 300 ms worse** (1.21 → 1.51 s). Per the rule "keep the better LCP at
CLS 0", **the current configuration (A) stays; no font change was made.** The hypothesis in R11 (that the simulated LCP waits
on the font request) is **not supported**.

What the Lighthouse trace shows instead (`/pricing`, `/periodic-table`): the LCP element is a text paragraph; the observed
LCP breakdown is 17–30 ms TTFB + 380–650 ms "element render delay"; the audited render-blocking requests are the two CSS
files (30 KiB, "est. savings 700 ms" in Lighthouse's model). The 3.6 s simulated figure is Lantern's model of the whole
dependency graph at 150 ms RTT / 1.6 Mbps, not an observed paint. The browser-observed value is 0.3–0.5 s locally.

## R12 — environment maps

Done: `/hdri/*` is served `Cache-Control: public, max-age=31536000, immutable`; the two files now carry the first 8 hex
digits of their sha256 in the name (`potsdamer_platz_1k.7afe4c2f.hdr`, `studio_small_03_1k.29267a4a.hdr`), enforced by
`tests/unit/seo/hdri-assets.test.ts`. Before: `max-age=0, must-revalidate` (revalidated on every visit). Verified on the
production server: `Cache-Control: public, max-age=31536000, immutable`, `Content-Length: 1680234`; pages keep
`private, no-cache, no-store` (required by the nonce CSP).

| Cold load, 5 runs | Score | LCP (sim) | TBT | FCP | CLS |
| --- | --- | --- | --- | --- | --- |
| `/` mobile before → after | 69 → 69 | 3 609 → 3 609 | 889 → 878 | 1 207 → 1 206 | 0 → 0 |
| `/explore` mobile before → after | 74 → 73 | 3 612 → 3 927 [3 311–4 064] | 578 → 596 | 1 207 → 1 208 | 0 → 0 |

The cache header cannot show in a cold-load lab run: its benefit is repeat visits (a returning visitor no longer
re-requests 1.5–1.7 MB per 3D page). **Tried and dropped:** starting the map download after first paint on phone-sized
devices (`requestIdleCallback`). Cold-load numbers did not move (TBT 889 → 878 ms, score 69 → 69; Lighthouse waits for
network idle, so deferral cannot show) and it only delays environment lighting, so it was removed.

## R10 — LCP on `/dashboard` and `/ai-lab` (signed-in)

**Not done in this run.** Both pages are gated, so they never appear in search; they matter only for origin-level CrUX
data. Measuring them needs the signed-in stack (Express + PostgreSQL, i.e. Docker), which was not running. Left open;
the plan is unchanged (render the AI Lab greeting and the dashboard header as static markup) and will be measured with
`node scripts/perf/run.mjs lighthouse` once the test database is up.
