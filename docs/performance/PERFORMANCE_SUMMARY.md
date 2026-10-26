# Performance phase — summary

What the performance phase (Parts 0–3) measured, changed and deliberately left alone, where the system breaks,
what to expect in production, and what to watch after launch. Details, raw tables and method:
[`PERFORMANCE_FINDINGS.md`](PERFORMANCE_FINDINGS.md) and the harness guide [`README.md`](README.md).

**Every number here is local**: production builds (`next build` + `next start`, Express `dist`) on one desktop
(AMD Ryzen 7 5700X, Windows 10, Node 24.11.1, PostgreSQL 18.6 in the project's test container), mocked Gemini /
Lemon Squeezy / Resend, network guard on in every server, median of ≥ 5 runs with its spread unless stated. Cloud
CPUs are slower per core and every Vercel → Render → Neon hop adds a real round trip: re-validate on staging
(LAUNCH_CHECKLIST §4.7) before relying on any absolute figure.

## 1. Baseline vs after

| Area | Measure | Baseline | After | Change |
| --- | --- | --- | --- | --- |
| Chat API | overhead excluding the model, p95, 1 user (B1 < 50 ms) | 22.2 ms | **18.2 ms** | PERF-01 |
| Chat API | 50 concurrent turns: p99 / Next heap / event-loop lag | 655 ms (to 4 s) / 1 990–2 278 MiB / 571–649 ms | **209 ms / 302 MiB / 35 ms** | PERF-19 |
| Chat API | 10 concurrent turns at a 2.7 ms DB round trip: p95 / throughput | 89.1 ms / 126 per s | **75.0 ms / 146 per s** | PERF-01 |
| Database outage | reconnect probes / pool rebuilds over 5 outage events | 185 / 44 | **69 / 6** (same responses) | PERF-22 |
| Ledger history | p95 at 100 k and 1 M rows (B2 < 100 ms) | 13.8–17.4 ms | unchanged | — (R1 not needed) |
| Balance | p95 through the BFF, 10 concurrent (B3 < 30 ms) | 11.0 ms | unchanged | — |
| Mobile LCP (browser) | `/` · `/explore` · `/periodic-table` | 7 280 · 6 868 · 4 684 ms | **1 332 · 1 176 · 1 172 ms** | PERF-23 |
| Mobile LCP (browser) | `/dashboard` · `/ai-lab` | 5 232 · 6 640 ms | 3 252 · 5 868 ms | PERF-23; rest → SEO/CWV phase (R10) |
| Lighthouse mobile score | `/` · `/explore` · `/periodic-table` · `/dashboard` · `/ai-lab` | 50 · 57 · 76 · 75 · 58 | **66 · 77 · 91 · 83** · 58 | Part 2 |
| Initial JavaScript (compressed) | non-3D routes · 3D routes | 673–690 · 1 007–1 059 KiB | **344–362 · 775–827 KiB** (−49 % · −22 %) | PERF-24/25/26, R15 |
| 3D memory | per visit to `/` · JS heap after 20 visits | +8.02 MiB, 777 DOM nodes · 46.3 MiB rising | **0–0.2 MiB, 0 nodes · 19.4 MiB flat** | PERF-27 |
| Reduced motion | canvas pixels changing per frame with `prefers-reduced-motion` | 13 % | **0.04–0.09 %** | R14 |
| CLS | every route | 0–0.01 | 0–0.01 | — |
| Load (new in Part 3) | clean up to / breaks at, mixed traffic: BFF · Express alone | — | **300 / ≈ 400 req/s · 600 / ≈ 700 req/s** | § 3 |
| Soak (new in Part 3) | 15 min at 200 req/s: drift, memory, connections, charges | — | **flat; 18 599 turns all charged; reconcile exit 0** | § 3 |

Budgets approved in Part 0: B1 ✔ · B2 ✔ · B3 ✔ · B4 (login event-loop lag) not measurable on Windows — re-measure
on Linux CI or staging · B5 (mobile LCP < 2.5 s) ✔ on `/`, `/explore`, `/periodic-table`, ✘ on `/dashboard`,
`/ai-lab` (R10) · B6 documented, enforced in CI (`npm run perf:bundle-budget`) · B7 (event-loop lag p99 < 50 ms)
✔ up to 50 concurrent chat turns and through the soak · **B8 (overload error shape: clean 429 / 503) ✔ except
database-pool exhaustion, which answers 500 (PERF-29, R18).**

## 2. What changed

| ID | Change | Commit |
| --- | --- | --- |
| PERF-19 | Cancellable deadlines for the Gemini and billing calls (an uncancellable timer kept every turn alive for 30 s) | `22c2564` |
| PERF-01 | One fewer Express round trip per chat turn (redundant `GET /auth/me` removed; auth guarantees unchanged, with tests) | `5bb6581` |
| PERF-22 | Single-flight database reconnect probe (no herd of pool rebuilds during an outage) | `c683eb4` |
| PERF-23 | Above-the-fold entrances in CSS: the LCP text paints before JavaScript | `2d953f4`, `3a1cb37` |
| PERF-27 | Each 3D canvas releases its renderer on unmount (memory leak across navigations) | `4565148` |
| PERF-24 | Chat markdown renderer loaded on demand | `6ea332a` |
| PERF-25 | No three.js in the provider that wraps every page | `d53b0db` |
| PERF-26 | Locale content on demand (English built in) | `bf3a487` |
| R14 | 3D scenes stop their ambient motion under `prefers-reduced-motion` | `8e3a68c` |
| R15 | KaTeX pipeline removed; maths shown as monospace source (its output never survived the sanitiser) | `fb28335` |
| Harness | Production-mode harness, mock Gemini, DB proxy, network-guard enforcement, browser and bundle measurement, open-loop mixed load, soak and failure injection; bundle budget in CI | `98ea9b2` … `228932c`, `e83eda4` (PERF-28), `0dab98c` |

Fixed in the harness itself (no product change): PERF-21 (the first chat turn "hang" was the harness's Gemini
forward; production unaffected) and PERF-28 (the soak's Express heap growth was the test network guard's call log).

## 3. Breaking points (Part 3)

Mixed traffic per 100 arrivals: 35 anonymous pages, 25 balance, 10 history, 10 chat turns, 8 logins, 6 checkouts,
6 signed webhooks — heavier on logins and chat than real traffic. Fixed arrival rate (open loop).

| | Through the BFF (browser → Next → Express) | Express alone (the BFF's calls) |
| --- | --- | --- |
| Clean up to (5 / 5 runs) | 300 req/s (worst non-chat p95: median 88 ms, at most 194 ms) | 600 req/s (reads, checkout, webhooks p95 ≤ 10 ms; chat reserve + capture ≤ 28 ms; login ≤ 0.35 s) |
| Saturates / breaks at | 350 (event loop 96–100 % busy, p95 ≈ 0.2 s) / ≈ 400 req/s (3 of 5 runs: > 1 % errors or p95 1–7 s) | — / ≈ 700 req/s (3 of 3 runs: login p95 4.4 s) |
| First bottleneck | **Next's CPU** (≈ 2.8 ms per request); Express ≤ 24 % busy, DB idle | **bcrypt** on libuv's 4 threads (56 logins/s queue under mixed load); event loop 55 % busy, DB idle |
| Error behaviour | connection refusals at Next only — no 5xx, no crash, no hang | no errors at all; logins queue without bound (R17) |
| Recovery | clean in the first 30 s at the last good rate | clean in the first 30 s |

**Soak** (15 min at 200 req/s through the BFF, 180 000 requests): no latency drift; Next and Express memory, open
handles, sockets and DB connections flat; 18 599 chat turns all captured; 0 reservations held or past expiry;
0 `CAPTURE_FAILED`; `db:reconcile` **exit 0**.

**Failure injection** (100 req/s): Gemini 5xx → 502 at once, Gemini hang → 504 at 30.0 s, billing unreachable →
503 at once, each failed turn released; DB +20 ms per direction → slower, no errors; DB +100 ms per direction (pool
exhausted) → **500** on reads and logins (R18), 503 on chat. No hangs, no crashes, recovery in the first window.
Charges afterwards: every reservation settled, none past its TTL; 3 042 answered turns = 3 020 charged + **22
uncharged** (capture failed after its ≈ 4 s retries during the outages — logged and reported by `db:reconcile` as
`hold_expired_unsettled`, which is why it **exits 2**); 2 520 acknowledged webhooks = 2 419 credited + **101 to
resend** from Lemon (acknowledged before a database write that then failed — R19). Nothing charged or credited
twice; every cached balance equals its ledger sum.

## 4. Capacity guidance (local estimates — re-validate on staging)

* **Next on Vercel.** One instance handled ≈ 300 mixed req/s locally (≈ 2.8 ms CPU per request). Vercel adds
  instances with load, so Next is not the site's limit; Express behind it is. Configure Upstash, or the per-user
  chat limit applies per instance (LAUNCH_CHECKLIST §A).
* **Express on Render: exactly one instance** (in-memory rate limiters and the expired-hold sweeper are
  per-process). Locally it took ≈ 600 req/s of the BFF's calls; logins are the first limit (≈ 50/s under mixed
  load, 74–78/s alone, on 4 threads at 53 ms per bcrypt hash). On a 1-vCPU instance hashing and the event loop
  share one core: one local core hashes ≈ 19 logins/s, a cloud vCPU fewer — **plan for ≈ 10 logins/s** and measure
  on staging. Leave `UV_THREADPOOL_SIZE` alone unless the instance has more than 4 cores (R6). RSS was 115–160 MiB
  at 200 req/s, so a 512 MiB instance fits.
* **Chat turns** are bounded by the business cap long before the system: `AI_DAILY_TURNS_GLOBAL` = 3 000 per
  day, about 0.03 per second on average. Each turn costs 21 sequential DB round trips. At a 2.7 ms round trip,
  Part 1 measured ≈ 250 reservations and captures per second.
* **Database.** The pool has 20 connections per Express. A 200 ms round trip saturates it within seconds, so the
  real Render → Neon round trip (LAUNCH_CHECKLIST §4.7) decides headroom more than CPU does.

## 5. What was deliberately not changed

| # | Recommendation | Why not now |
| --- | --- | --- |
| R1 | Composite ledger index `(user_id, created_at DESC, id DESC)` | Saves ≈ 0.7 ms end to end at 10× data; not worth a migration before launch (owner) |
| R2 | Counter instead of the global 24 h `count(*)` | Only matters if `AI_DAILY_TURNS_GLOBAL` is raised far above 3 000 |
| R3 | Reconcile | Nothing needed: a daily job, 246 ms at 3 M rows |
| R4 | `lock_timeout` in the reservation transaction | Optional; the BFF's 10 turns/min per user already prevents one user from holding the pool |
| R6 · R8 | `UV_THREADPOOL_SIZE` · latency baseline on real hosts | Moved to LAUNCH_CHECKLIST §1.4 · §4.7 (deployment steps, not code) |
| R7 | Neon connect timeout / scale-to-zero | Configuration choice; keep 2 s unless staging shows slow resumes |
| R9 | Merge some of the chat turn's 21 DB round trips | Money path; worth ≈ 19–46 ms per turn at a 2.7 ms RTT — revisit with staging RTTs (owner: recommendation only) |
| R10–R12 | LCP on `/dashboard` and `/ai-lab`, fonts, environment-map caching | Moved to the SEO / Core Web Vitals phase (§ 8) |
| R13 | Reduced 3D mode for low-end devices | Recorded only (owner); 8.5–9 fps with software GL |
| R16 | Report the three.js / R3F / postprocessing leak upstream | Outward action for the owner; draft text in the findings |
| R17 | Shed logins (503 + `Retry-After`) instead of queueing them | Auth flow: owner decision |
| R18 | Pool exhaustion → 503 `DATABASE_UNAVAILABLE` instead of 500 | **Small and ready on approval**; touches the error contract of money routes, so not applied inside a measurement part |
| R19 | Durable webhook inbox, or acknowledge after the credit is written | Money flow and provider contract: owner decision. Until then, page on the log line (§ 7) |
| R20 | Longer capture retries or a capture outbox | Billing semantics: owner decision. Today uncharged turns are bounded and reported |

## 6. Residual risks

1. **Real network round trips are unmeasured.** Each chat turn makes 2 Vercel → Render calls and 21 Render → Neon
   round trips. Local tests show the DB round trip, not CPU, sets capacity for money paths, and that a slow
   database exhausts the pool within seconds (R8, R9, R18).
2. **Webhooks acknowledged before the credit is written.** A database incident loses fulfilments until someone
   resends them from Lemon (101 of 180 during a 30 s spike). Detection is a log line (R19, § 7).
3. **Uncharged AI turns** when billing or the database is out for longer than the BFF's ≈ 4 s capture retries.
   Bounded, logged (`CAPTURE_FAILED`) and reported by `db:reconcile` (R20).
4. **One Express instance**: no redundancy, limiter state resets on every deploy, and logins queue without bound
   under a burst (R17). Plan for ≈ 10 logins/s on a 1-vCPU instance.
5. **Pool exhaustion answers 500**, which looks like a bug rather than "temporarily unavailable" (R18).
6. **Windows-only measurements.** The event-loop lag floor is ~25 ms here (B4 unmeasured), and overload shows as
   refused connections. Linux may queue instead. Re-check both on staging.
7. **Front end:** mobile LCP is 3.3 s on `/dashboard` and 5.9 s on `/ai-lab` (R10). Devices without a GPU render
   the 3D scenes at 8–17 fps (R13).
8. **The load mix is synthetic**: heavier on logins and chat than real traffic, with no real CDN, TLS or
   provider latency.

## 7. Post-launch monitoring (in priority order)

LAUNCH_CHECKLIST §5 has the exact log strings and SQL. In order of urgency:

1. **Page immediately:** `[Webhook] FAILED background credit allocation` (a paid order was not credited; resend
   it from Lemon), Express `/health` 503 or down, and `FATAL:` at start.
2. **Daily, as a job:** `npm run db:reconcile` exit code, plus its `hold_expired_unsettled` and `capture_failed`
   counts (uncharged turns) and `refunded_order_credited` (§5.1).
3. **Alert on rate:** `[billing] CAPTURE_FAILED` / `RELEASE_FAILED` (Next), `[credits] CAPTURE_FAILED` (Express);
   Express 5xx rate, especially `timeout exceeded when trying to connect` (pool exhaustion, PERF-29) and 503
   `DATABASE_UNAVAILABLE`.
4. **Capacity:** login latency p95 and BFF 504s on `/api/auth/*` (R17); Neon connection count and query
   round-trip time; Express event-loop utilisation and RSS; `AI_CAPACITY_REACHED` and the 24 h turn count against
   `AI_DAILY_TURNS_GLOBAL` (alert at 80 %).
5. **Quality:** Gemini 502 / 504 rates and model latency; field Core Web Vitals (LCP, INP, CLS) per route once a
   real-user source is enabled.

## 8. SEO / Core Web Vitals phase — carried over

| # | Item | Evidence |
| --- | --- | --- |
| R10 | Server-render the signed-in page header (`/dashboard`) and the AI Lab greeting (`/ai-lab`), or make the greeting static markup: their LCP element appears only after client-side auth or chat state | Mobile LCP 3.3 s / 5.9 s (budget 2.5 s) |
| R11 | Fonts: preload only the display weight used above the fold, or `font-display: optional` for it (visual trade-off) | Lighthouse's simulated LCP 3.3–3.6 s on the public routes waits on the font request at 150 ms RTT; the browser paints in 1.2–1.3 s |
| R12 | Environment maps: long `Cache-Control` on `/hdri/*` with versioned names, and load them after first paint on mobile | `max-age=0, must-revalidate`; 1.5 MB per 3D route competes with JavaScript on slow links |

## 9. Verification (PostgreSQL 18)

Run after the last code change of the phase (`0dab98c`), against the project's `postgres:18-alpine` test container
(PostgreSQL 18.6):

| Check | Result |
| --- | --- |
| Service `vitest` with coverage | 37 files, **657 passed**; **91.48 %** lines, **80.14 %** branches (floors 91.31 / 79.72) |
| Root `vitest` with coverage | 34 files, **556 passed**; BFF set (TEST_PLAN §3: `src/lib/gateway`, `src/app/api/**`, `server-billing.ts`) **94.83 %** lines, 275 / 290 (floor 94.33 %; 95.25 % with `src/proxy.ts`) |
| `npm run typecheck:tests` · service `npm run typecheck` | 0 errors · 0 errors |
| `next build` | OK |
| `npm run perf:bundle-budget` | OK (every route under its ceiling) |
| E2E `next dev`, run 1 · run 2 | **49 passed, 1 skipped** · **49 passed, 1 skipped** (the skipped test needs the production build, by design) |
| E2E `E2E_NEXT_MODE=production` | **50 / 50 passed** |
| ESLint (whole repo) | 26 errors, 21 warnings — identical to `main` (the documented React Compiler backlog); none in a file this phase added or changed |

No test was deleted, skipped or weakened in the phase; changes to existing tests are recorded in
`docs/testing/TEST_CHANGES.md` (TC-49 only). Network guard on in every harness and test run; only the project's
test container was used.
