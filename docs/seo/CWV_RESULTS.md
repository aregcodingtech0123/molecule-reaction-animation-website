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

Measured 2026-11-01 with the perf harness (`node scripts/perf/run.mjs lighthouse` / `webvitals`; production build, seeded
PostgreSQL 18.6 test container, Express + Next, network guard on, signed in with a minted session cookie), Node 24.22.
Lighthouse 13.5, mobile = simulated slow 4G + 4× CPU, one discarded warm-up then **5 runs**, median [min–max]. Both pages
are gated (never in search); they matter for origin-level CrUX data only.

Two changes, each tried and measured; both kept because both show a real gain, CLS stays 0 and nothing security-relevant moved:

1. **`/dashboard`: the header is rendered in the server HTML and in the loading state.** Before, the page returned only a
   spinner until the client had hydrated *and* the auth round-trip (`/balance` + `/profile`) had finished, so the `<h1>`
   (the LCP element) appeared after ~3 s on a throttled phone. The header (badge, title, subtitle, quick links, feature
   cards) is static, non-personal copy; it now renders immediately, and the balance, ledger and checkout still wait for the
   confirmed session.
2. **`/ai-lab`: the built-in welcome message is plain text, not swapped for the markdown renderer.** The LCP element is that
   chat paragraph. It was first painted as plain text (Suspense fallback) and then *replaced* by a new element when the lazily
   loaded markdown chunk arrived, so Lighthouse's simulated LCP waited for that chunk. The welcome message is a constant of
   this app (never model output), so it is now rendered as escaped plain text with no swap; every other assistant message
   still goes through the same sanitising renderer.

| Mobile, signed in | Metric | Before | After |
| --- | --- | --- | --- |
| `/dashboard` | Lighthouse score | 84 [82–85] | **92** [86–92] |
| | LCP (simulated) | 4 112 ms [3 983–4 136] | **3 164 ms** [3 162–3 317] |
| | LCP (observed in the browser, Playwright) | 3 252 ms [3 220–3 280] | **1 168 ms** [1 148–1 180] (= FCP) |
| | FCP / TBT / CLS | 1 065 ms / 171 ms / 0 | 1 061 ms / 139 ms / 0 |
| `/ai-lab` | Lighthouse score | 59 [58–72] | **71** [70–75] (10 further runs: 72 [61–74]) |
| | LCP (simulated) | 7 222 ms [3 762–7 226] | **3 631 ms** [3 310–3 768] (10 further runs: 3 462 [3 458–3 766]) |
| | LCP (observed) | 1 156 ms | 1 164 ms (it was already first paint) |
| | FCP / TBT / CLS | 1 080 ms / 666 ms / 0 | 1 079 ms / 771 ms [680–792] / 0 |

| Desktop, signed in | Before | After |
| --- | --- | --- |
| `/dashboard` score / LCP / CLS | 99 / 848 ms / 0.010 | **100** / **698 ms** / 0.010 |
| `/ai-lab` score / LCP / TBT | 99 / 736 ms / 80 ms | 99 / 695 ms / 90 ms (one outlier run: score 89, TBT 275) |

Reading the AI Lab numbers honestly: the baseline was **bimodal** (4 of 5 runs 7.0–7.2 s, one 3.8 s; a 2-run diagnostic on the
old build also gave 3.76 s). After the change all 15 samples are 3.3–3.8 s and none is 7 s, which removes the slow mode; the
fast mode itself is unchanged. TBT on `/ai-lab` (666 → 771 ms) is the 3D scene, which this change does not touch, and is within
the run-to-run spread. **The 2.5 s target is still not met in Lighthouse's simulated mobile figure** on either page (3.2 s and
3.6 s): the remaining time is the same CSS/script graph the public pages have (see R11). In the browser the LCP is now the first
paint (1.2 s) on both. `/ai-lab` observed LCP never was the problem.

**Tried and dropped:** none this round. (Server-rendering the entire signed-in page was not attempted: it would need the
session on the server, which the gating tests deliberately forbid — "protected pages are client components".)

**Security check (no regression):** `proxy.ts` still redirects every request without a valid session cookie; the API answers
401 without a session (gating E2E, unchanged); the dashboard's header holds only labels and links; the balance, ledger,
pricing cards and e-mail are not rendered or fetched until the session is confirmed (unit tests render the page on the server
with `renderToString` and assert that none of that is in the HTML); a guest is still redirected to `/login`; the markdown
renderer's sanitising is untouched and still applies to every non-welcome assistant message (test, including a
`javascript:` link).
