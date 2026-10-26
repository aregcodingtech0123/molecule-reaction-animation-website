# Performance findings

Method, harness and budgets: [`README.md`](README.md). Every finding moves through **lead → verified in code →
measured (baseline) → changed (after) or recommendation**. Numbers come only from the harness on the reference
machine (README §2), as the median of ≥ 5 runs with its spread; a difference within the spread is reported as noise.

Status values: `lead` (from the brief, not yet checked) · `verified-code` (the code does what the lead says; not yet
measured) · `refuted` (the code does not do it) · `measured` · `fixed` · `recommendation` (not applied, with reason) ·
`no-gain` (tried, within noise, reverted).

## Part 0 — leads checked against the code

| ID | Area | Lead | What the code shows | Status | Measured in |
| --- | --- | --- | --- | --- | --- |
| PERF-01 | `/api/chat` | Sequential round trips before answering | Confirmed and larger than the brief says. Order: local JWT verify → `GET /auth/me` → Upstash (if set) and in-memory limit → body read → `POST /consume` → Gemini → `POST /capture`. Each Express call re-runs `requireAuth` (2 queries: `jti`, `token_version`); `/consume` and `/capture` also `requireVerified` (1). DB round trips per successful turn: `/auth/me` 3 + `/consume` 10 (7 in its transaction) + `/capture` 11 (8) = **24**, all sequential. `/auth/me` serves only the verified-email gate, which `/consume` enforces again (403 `EMAIL_NOT_VERIFIED`, already mapped by the route) — candidate to drop one hop in Part 1, keeping the 403 behaviour and its tests. | **fixed** (§ Part 1 · PERF-01) | Part 1 ✔ |
| PERF-02 | `/api/chat` | Gemini latency / `GEMINI_TIMEOUT_MS` vs hold TTL | Default timeout 30 s, TTL 600 s; `check:config` already enforces TTL ≥ 2 × (timeout + retries + capture attempts × call timeout) = 148.5 s with defaults. No correctness gap. Capacity side: each in-flight turn holds a Next request (and its memory) for up to 30 s — part of Part 3 sizing. | measured — timeout honoured; the retention it caused is PERF-19 | Part 1 ✔ |
| PERF-03 | `/api/chat` | — (found in Part 0) | `fetchEmailVerificationStatus` (`GET /auth/me`) has **no timeout**, unlike the billing calls (`BILLING_CALL_TIMEOUT_MS`, SEC-17). A stalled Express holds the chat request until undici's default 300 s headers timeout. Robustness more than speed; would disappear with PERF-01's change. | **fixed** by PERF-01 (the call is gone) | Part 1 ✔ |
| PERF-04 | Ledger / holds | Advisory-lock contention for one hot user | `reserve`, `capture`, `release` each take `pg_advisory_xact_lock(hashtext(user_id))`; `post_credit_transaction` takes the same lock inside `capture` (re-entrant). One user's turns are fully serialised through those transactions; different users only share the pool. The global daily-cap count is deliberately not serialised (SEC-16). | measured — recommendation (§ Part 1) | Part 1 ✔ |
| PERF-05 | `/history` | Query plan and cursor pages at large row counts | Index `idx_credit_ledger_user_created (user_id, created_at DESC)`; the query orders by `created_at DESC, id DESC` with a row comparison `(created_at, id) < (…)`, so `id` is not in the index (ties need a sort). Harness check: flat ~4 ms from page 1 to page 1 000 at 100 k rows (1 run). EXPLAIN at 100 k and 1 M rows decides whether anything is needed. | measured — within budget at 1 M rows; recommendation (index) | Part 1 ✔ |
| PERF-06 | Dashboard | Balance polling frequency × users | **Refuted as stated.** There is no steady polling. `useBalanceAutoRefresh` refreshes once on window focus / visibility, and polls every 3 s for at most 30 s (≤ 10 requests) only after a return from checkout, stopping as soon as credits arrive. The poll does not pause while the tab is hidden (bounded at 30 s). Requests per tab per minute will be counted in Part 2. | measured — no steady polling; post-checkout poll bounded (§ Part 2) | Part 2 ✔ |
| PERF-07 | Bundle (3D) | 3D bundle size / first load on mobile | No `next/dynamic` or `React.lazy` anywhere in `src/`. `FocusProvider` — mounted in the root providers on **every** page — imports `three`; the landing page imports the 3D `Scene` directly. `three` is therefore very likely in every route's client JS. To confirm with `next analyze`. | **fixed** for non-3D routes (PERF-25); 3D routes need three | Part 2 ✔ |
| PERF-08 | Bundle (AI chat) | — (found in Part 0) | `LabAssistantChat` is mounted globally (root providers) and statically imports `AiChatPanel` → `ChatMessageContent` → `react-markdown`, `remark-math`, `rehype-katex`, `rehype-sanitize`. `katex.min.css` (and its fonts) is imported in `globals.css`. The markdown/KaTeX stack is likely on every page. | **fixed** (PERF-24) | Part 2 ✔ |
| PERF-09 | Bundle (i18n) | Do all 12 locales ship to every user? | `src/lib/i18n/content/index.ts` statically imports all 12 locale JSON files (the i18n folder is ~505 KB of source). Very likely all locales ship. | **fixed** (PERF-26) | Part 2 ✔ |
| PERF-10 | CLS | Theme flash on 48 components (FINDING-26 partial) | A pre-hydration script applies the stored theme before first paint (FINDING-26). `<body>` has `transition-colors duration-500`, so components whose classes change at hydration animate for 500 ms. Colour changes are not layout shift; whether any of them shift layout is a measurement question. | measured — CLS 0–0.01 everywhere; no shift from the theme | Part 2 ✔ |
| PERF-11 | Caching | Nonce CSP makes every route dynamic | Confirmed: the root layout reads `headers()` for the nonce; the build prerenders only `/_global-error` and `/favicon.ico`. Every HTML response is rendered per request. The proxy matcher excludes `api/`, `_next/static`, `_next/image`, `favicon.ico` and `hdri/`, so static assets keep their own caching. | measured — kept (nonce CSP); TTFB p50 5–10 ms locally | Part 2 ✔ |
| PERF-12 | Assets | Environment maps | `public/hdri`: two 1k `.hdr` maps, 3.1 MB together. Cache headers on `public/` (and on Vercel) to be checked. | measured — recommendation R12 | Part 2 ✔ |
| PERF-13 | DB connect | Neon cold start vs pool connect timeout | Pool `max` 20, `idleTimeoutMillis` 30 s, `connectionTimeoutMillis` 2 s. `requireDatabase` answers 503 `DATABASE_UNAVAILABLE` while the DB is not ready. Neon documents a wake-up of a few hundred ms (checklist), which is under 2 s; slower networks or retries are to be simulated. | measured — clean 503; recommendation (single-flight probe, timeout) | Part 1 ✔ |
| PERF-14 | Memory | In-memory limiters | Express: `express-rate-limit` memory stores on auth routes only (5 limiters). BFF chat: an in-memory `Map` per user that **never deletes expired buckets** — one entry per user ever seen until restart (small, but unbounded). Revoked-JTI cache: purged every 256 checks. Sizes to be measured over a soak. | measured — no growth in a 10-min soak | Part 1 ✔, Part 3 |
| PERF-15 | Express | Body parsing and compression | `express.json` 32 kB; webhook `express.raw` 256 kB (HMAC needs raw bytes). No compression on Express (small JSON, mostly BFF-to-service). `next start` compresses by default; Vercel compresses at its edge. Expect no action; response sizes will be recorded. | no action (responses ≤ a few kB; nothing to gain) | Part 1 ✔ |
| PERF-16 | Daily caps | Migration 014 queries | One query with three sub-selects per reservation, inside the user's lock: the user's 24 h count, the user's oldest turn, and the **global** 24 h count over `idx_ai_credit_holds_created`. The global count's cost grows with the 24 h volume (bounded by the cap, 3 000 by default). EXPLAIN at default and 10× volume. | measured — fine at the default cap; recommendation if raised | Part 1 ✔ |
| PERF-17 | Reconcile / refunds | Reconcile and refund queries | `ledger_reconciliation()` aggregates the whole ledger (daily job). `refunded_orders_to_review()` joins refunds to credits. Timed at 300 k and 3 M ledger rows. | measured — linear, fine as a daily job | Part 1 ✔ |
| PERF-18 | Express | — (found in Part 0) | Every capture logs with `console.log`. Depending on the stream type (file, pipe, TTY) Node writes stdout synchronously, i.e. on the event loop. The first chat check showed Express event-loop lag p99 up to 615 ms at c = 50. Cause not yet known; logging is one candidate among GC and `pg` parsing. | not reproduced (A/B file vs pipe, soak) | Part 3 (soak) |
| PERF-19 | Next memory | — (found in Part 0) | In the first chat check the Next process heap reached 610 MiB (RSS 772 MiB) at c = 50 and its event loop was saturated. Growth vs lazy GC to be told apart by a 10-minute run. | **fixed** (§ Part 1 · PERF-19) | Part 1 ✔ |
| PERF-20 | Login | bcrypt cost and event-loop blocking | `bcrypt` (native), cost 10 by default (production allows 10–15). Hashing runs on the libuv pool (4 threads by default), not on the event loop, so concurrent logins queue on 4 threads and share them with other pool work. | measured — documented; recommendation (thread pool) | Part 1 ✔ |
| PERF-21 | `/api/chat` | — (observed once in Part 0) | **Reproduced, then traced to the harness, not the app** (§ PERF-21 below). The Part 0 preload forwarded Gemini calls by rebuilding them as `new Request(input, init)` and passing `request.signal` on; undici links that signal to its source weakly, so a GC during the wait broke the timeout. Production (`next start`, SDK, Next's fetch, no preload) aborts at `GEMINI_TIMEOUT_MS` even with a forced full GC every second. Harness fixed, regression-tested. | refuted (harness defect, fixed) | Part 1 ✔ |

## PERF-21 — first chat turn not bounded by `GEMINI_TIMEOUT_MS` (Part 1, first item)

Setup: `node scripts/perf/run.mjs gemini-timeout --gemini-failure 1:hang` — fresh production stack, every Gemini
call hangs, three turns one after another, `GEMINI_TIMEOUT_MS=30000` unless stated. `PERF_REPRO_FORCE_GC_MS=1000`
forces a full GC in the Next process every second (`--expose-gc`, harness only), so a weakly reachable signal is
collected deterministically instead of by luck.

| # | Path to the mock | Forced GC | Timeout | Turn 1 | Turn 2 | Turn 3 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Part 0 forward (`new Request` + `request.signal`) | no | 30 s | **no answer, connection dropped at 306.5 s** (undici's 300 s headers timeout) | 504 at 30.1 s | 504 at 30.0 s |
| 2 | URL-only redirect (production's call shape) | no | 30 s | 504 at 30.3 s | 504 at 30.0 s | 504 at 30.1 s |
| 3 | same, repeated | no | 30 s | 504 at 30.1 s | 504 at 30.1 s | 504 at 30.0 s |
| 4 | URL-only redirect | every 1 s | 30 s | 504 at 30.1 s | 504 at 30.0 s | 504 at 30.0 s |
| 5 | **control:** Part 0 forward | every 1 s | 5 s | **502 at 305.6 s** | **502 at 305.4 s** | **502 at 305.8 s** |

Isolation outside Next (SDK + hanging mock, 3 s timeout, forced GCs at 0.3 / 0.8 / 1.5 s): plain `fetch` with
`AbortSignal.timeout` aborts at 3.0 s; the SDK pointed at the mock by `baseUrl` aborts at 3.0 s with and without the
caller keeping a reference to the signal; the SDK through the Part 0 forward **hangs** (> 8 s); through the URL-only
redirect it aborts at 3.0 s. Without forced GC the Part 0 forward also aborts on time, which is why only some turns
hung: it depended on whether a GC ran during the wait (the first request after start allocates the most).

Conclusion: not an application bug. `@google/genai` 2.5.0 copies `config.abortSignal` onto its own controller and
passes that controller's signal straight to `fetch`; the route and Next keep it reachable. The weak link existed only
in the harness's forward. No production code rebuilds a `Request` to forward a signal: the gateway holds its
`AbortController` in the timer closure, and the billing calls pass `AbortSignal.timeout()` directly to `fetch`.
Money: in run 1 the hung turn's reservation was released after the failure (never charged). The hold-TTL margin in
`check:config` is unaffected (the model call is bounded as designed; `/auth/me` runs before the reservation exists).

Fix (harness only): `scripts/perf/lib/gemini-redirect.mjs` rewrites the URL and passes the caller's `init` through.
Regression tests (`tests/api/perf-harness.test.ts`): the redirect hands over the identical `init` object; a child
process with `--expose-gc` and the preload must abort a hanging SDK call at its 1.5 s timeout while GCs run every
200 ms. Mutation check: with the Part 0 forward restored, that test fails (the child hangs past the 30 s cap).

Process note: one isolation run was started without the network-guard preload; the SDK then sent one request to the
real Gemini endpoint with the dummy key `x` and the prompt "hi" (rejected 400, "API key not valid"). No secret or user
data was involved. Every later experiment ran behind the guard, with the SDK pointed at the local mock.

PERF-03 (no timeout on `/auth/me`) is handled with PERF-01 below.

## Part 1 — backend and database (branch `perf/backend`)

Reference machine and method: README §2 (AMD Ryzen 7 5700X 8C/16T, 23.9 GiB, Windows 10 Pro 19045, Node 24.11.1,
PostgreSQL 18.6 in the project's Docker test container). Production builds (`next start` on `.next-perf`, Express
`dist`), mock Gemini, every figure the **median of 5 runs** after a discarded warm-up run, with [min–max] across runs.
Result files: `perf-results/` (gitignored), one folder per run. A difference inside the spread is reported as noise.

### Budgets (approved in Part 0)

| # | Budget | Baseline | After Part 1 | Verdict |
| --- | --- | --- | --- | --- |
| B1 | `/api/chat` overhead excl. Gemini, p95, c = 1 (< 50 ms) | 22.2 ms [21.3–22.9] | **18.2 ms** [17.9–19.9] | ✔ |
| B1 | same, c = 10 (< 150 ms) | 39.7 ms [36.3–40.8] | **39.8 ms** [34.8–42.6] | ✔ |
| — | same, c = 50 (reported) | 177.7 ms [169.7–1 202.8] | 170.8 ms [164.2–190.9] | tail fixed by PERF-19 |
| — | same with realistic Gemini (lognormal 1.5 s / 4 s), c = 1 / 10 / 50 | 27.3 / 22.1 / 23.7 ms | not re-run (overhead unchanged at c ≤ 10) | ✔ |
| B2 | `/history` p95, c = 10, any page, 100 k rows (< 100 ms) | 13.8–17.4 ms | unchanged | ✔ |
| B2 | same at 1 M rows (10×) | 14.0–14.5 ms; last page no slower than first | unchanged | ✔ |
| B3 | balance via BFF p95, c = 10 (< 30 ms) | 11.0 ms [11.0–11.1] | unchanged | ✔ |
| B4 | login: documented; event-loop lag p99 at c = 16 | 53 ms per login (cost 10); lag p99 25.8 ms | — | **not measurable on Windows; re-measure on Linux CI/staging** (event loop free: ELU ≤ 0.17) |
| B7 | event-loop lag p99, c = 10 (< 50 ms) | ≤ 25.6 ms (Next and Express) | ≤ 35 ms at c = 50 | ✔ |
| B8 | overload error shape | clean 429 / 503 everywhere tested | — | ✔ (Part 3 completes it) |

The event-loop histogram resolves 10 ms and Windows timers tick at ~15.6 ms: idle runs read 20–25 ms. A lag budget
under ~25 ms cannot be told apart from that floor on this machine.

### PERF-19 — every chat turn kept alive for 30 s (fixed)

Baseline at c = 50 (Gemini mock 0 ms, ~300 turns/s): the Next process reached a **1 990–2 278 MiB heap**
(RSS 2 251–2 552 MiB) and event-loop stalls of 571–649 ms; p99 655 ms [370–4 057]; 20 × 503 in one run. At the
realistic Gemini profile (27 turns/s) the heap stayed at 162 MiB.

Experiments (3 runs each, c = 50, forced full GC in Next every 2 s so the heap floor shows retained memory):

| Run | Heap floor during steady state (MiB, per run) |
| --- | --- |
| E1 `GEMINI_TIMEOUT_MS` 30 s (default) | 168 → 315 → 320 (climbing to a plateau) |
| E2 `GEMINI_TIMEOUT_MS` 5 s | 134 / 134 / 154 (flat) |
| A1 after the fix, 30 s | **93 / 74 / 86** (flat) |

Cause: `AbortSignal.timeout(ms)` cannot be cancelled. With an abort listener attached (the Gemini SDK and fetch
attach one), Node keeps the signal — and everything its listeners reach, i.e. the finished request and response —
alive until the timer fires. Each turn stayed reachable for 30 s (Gemini) and each BFF → billing call for 10 s,
≈ 27 KB per turn. Most of the 2 GB, however, was not retained: it was garbage V8 had no reason to collect on a 24 GB
machine (E1's peak was 386 MiB with frequent GCs).

Change (commit `22c2564`): `src/lib/http/deadline.ts` — `withDeadline(ms, fn)` aborts at the same deadline with the
same `TimeoutError`, and clears its timer the moment the call settles. Used for the Gemini call (`/api/chat`) and for
every BFF → billing call (call and body read under one deadline, as before). FINDING-21 / SEC-17 tests pass
unchanged; new unit tests pin the deadline and the cleared timer.

| c = 50, Gemini 0 ms | Before | After |
| --- | --- | --- |
| Next heap peak | 1 990 / 2 278 MiB | **301.5 MiB** |
| Next RSS peak | 2 251 / 2 552 MiB | **462 MiB** |
| Next event-loop lag p99 (worst second) | 571 / 649 ms | **35 ms** |
| p95 | 192.5 [187.9–1 242.9] ms | **186.4 [183.6–200.4] ms** |
| p99 | 655 [370–4 057] ms | **208.7 [199–224.5] ms** |
| failures | 20 × 503 | 0 |

c = 1 and c = 10: unchanged within noise.

### PERF-01 (and PERF-03) — the redundant `GET /auth/me` per chat turn (removed)

`/api/chat` called `GET /auth/me` (3 DB queries) only to check `is_verified`, then `POST /consume`, whose middleware
chain (`requireInternalService → requireDatabase → requireAuth → requireVerified`) enforces the same session
revocation (`jti`, `token_version`) and the same verified-email gate before reserving anything. The `/auth/me` fetch
also had no timeout (PERF-03).

**Guarantees, proven before the change** (tests added first, green on the old code, still green after):
logged-out token → 401 `UNAUTHORIZED`; older session generation (`token_version` bumped) → 401; unverified email →
403 `EMAIL_NOT_VERIFIED`; un-verifying an account stops the next turn; deleted account → never served or charged — in
every case **no hold, no ledger row, no model call**. A new test pins the call pattern after the change:
`/consume → model → /capture`, nothing else (it fails on the old code).

Change: the `/auth/me` call and `src/lib/auth/verification.ts` are gone; a 401 from `/consume` maps to 401
`UNAUTHORIZED` (it would otherwise have become 503 `BILLING_UNAVAILABLE`).

Behaviour differences (no guarantee changes): an unverified user now meets the BFF rate limit and body validation
before the 403 (an invalid body answers 400 instead of 403); a token for a deleted account answers 403 instead of
503 "Server auth is not configured". Checking DB round trips per turn: 24 → 21.

| Chat turn, Gemini 0 ms | Before | After |
| --- | --- | --- |
| loopback DB, c = 1 | p50 19.12 / p95 21.35 ms, 51.0 / s | **p50 17.00 / p95 18.72 ms, 57.7 / s** (−11 % / +13 %) |
| loopback DB, c = 10 | p50 35.46 / p95 44.24 ms, 275 / s | p50 32.88 / p95 42.38 ms, 299 / s (within noise) |
| loopback DB, c = 50 | p95 191.4 ms, 299 / s | p95 178.1 ms, 326 / s (within noise) |
| DB round trip 2.73 ms, c = 1 | p50 73.06 / p95 77.54 ms, 13.4 / s | **p50 64.35 / p95 66.32 ms, 15.4 / s** (−12 % / −14 %, +15 %) |
| DB round trip 2.73 ms, c = 10 | p50 78.32 / p95 89.12 ms, 125.7 / s | **p50 68.03 / p95 74.97 ms, 145.5 / s** (−13 % / −16 %, +16 %) |

Measured A/B on the same harness (the change stashed and rebuilt for "before"), 5 runs each; the gains at c = 1 and
at the production-like DB round trip are outside the run-to-run spread. The saving grows with the DB and network
round-trip time — in production the removed hop also crossed the internet (Vercel → Render).

### Database (PERF-05, PERF-16, PERF-17) — `EXPLAIN (ANALYZE, BUFFERS)`

`node scripts/perf/explain.mjs` at the default volume (300 k ledger rows, 1 259 holds in 24 h) and 10× (3 M rows,
10 259 holds in 24 h; hot user 1 M rows). Median of 5 executions, ms:

| Query | 300 k | 3 M | Plan (10×) |
| --- | --- | --- | --- |
| auth: revoked `jti` / `token_version` / `is_verified`, balance | 0.06–0.08 | 0.06–0.08 | PK lookups |
| history, hot user, first page | 0.23 | **3.88** | Incremental Sort over **`idx_credit_ledger_created_at`** (global), 10 019 buffers |
| history, middle / last page, regular user | 0.22–0.24 | 0.24–0.27 | Incremental Sort over `idx_credit_ledger_user_created` |
| reserve: daily caps (3 sub-selects) | 0.33 | **1.07** | index-only scans; the global count grows with the 24 h volume |
| reserve: find hold / available balance / insert hold | 0.08–0.29 | 0.09–0.26 | PK / partial index |
| capture: `post_credit_transaction` | 0.64 | 0.55 | balance UPDATE + guard trigger 0.07, FK 0.02, ledger INSERT (8 indexes) 0.15 |
| webhook: purchase lookup, user by email, credit | 0.08–0.53 | 0.09–0.51 | unique indexes |
| `ledger_reconciliation()` | 25.8 | **246** | full aggregate — linear in ledger size |
| `refunded_orders_to_review()`, `release_expired_ai_holds()` | 0.1–0.2 | 0.1–0.2 | |

No index change is applied: end to end the 10× first-page plan costs ~0.7 ms (p50 4.52 vs 3.85 ms for a middle page),
far inside B2. See recommendations R1–R3.

### Concurrency and pool (PERF-04, pool saturation)

Reserve → capture called directly on Express (as the BFF does), timed as one unit; DB sampler at 100 ms.

| Scenario | p50 | p95 | Throughput | DB |
| --- | --- | --- | --- | --- |
| one user, c = 1 / 2 / 5 / 10 / 20 | 14.7 / 20.5 / 62.0 / 140.3 / 315.8 ms | 16.9 / 22.7 / 71.1 / 151.3 / 343.1 ms | 66 / 97 / 79 / 70 / 62 per s | advisory-lock waiters = c − 1 |
| many users, c = 5 / 10 / 20 / 50 / 100 | 22.6 / 34.7 / 63.0 / 177.7 / 424.6 ms | 27.0 / 39.6 / 76.2 / 209.1 / 497.4 ms | 220 / 287 / **311** / 281 / 225 per s | no lock waits; Express event loop ~87 % busy at the peak |
| every hold INSERT slowed by 200 ms (`pg_sleep` trigger), c = 10 / 20 / 40 / 80 | 234 / 243 / 458 / 918 ms | 240 / 258 / 596 / 1 205 ms | 43 / 82 / 83 / 78 per s | pool capped at 20; clean queueing, **0 errors** |

One user's turns are fully serialised by the per-user advisory lock — by design — and each waiting turn holds a pool
connection. Through the BFF a user is held to 10 turns / min per instance, so this cannot starve the pool in
practice (R4).

### DB latency, cold start, DB down (PERF-13)

Express reaches PostgreSQL through the harness proxy (127.0.0.1, own process, precise delays; per-round-trip cost
measured: loopback 0.53 ms, proxy 0.72 ms, +1 ms/direction 2.73 ms, +5 ms/direction 11.0 ms).

| DB round trip | reserve + capture, c = 50 | balance via BFF, c = 50 | chat turn overhead p50, c = 1 |
| --- | --- | --- | --- |
| 0.72 ms | p50 101 ms, 463 / s | p50 38.5 ms, 1 227 / s | 18.4 ms (loopback) |
| 2.73 ms (≈ same-region Render → Neon) | p50 192 ms, **252 / s** | p50 41.9 ms, 1 150 / s | **72.7 ms** (before PERF-01) |
| 11.0 ms | p50 582 ms, **83 / s**; all 20 pool connections "idle in transaction" | p50 86.1 ms, 576 / s | — |

DB round-trip time, not CPU, sets production capacity for money paths: a turn's transactions hold the user's lock
and a pool connection across every round trip.

| Fault | Result |
| --- | --- |
| Cold start: all connections dropped, new ones held 0.3 s / 1.5 s | 20 / 20 concurrent balance reads succeed (slowest 0.58 s / 1.56 s) |
| Cold start held 2.5 s / 5 s (beyond the pool's 2 s connect timeout) | 20 / 20 answer **503 `DATABASE_UNAVAILABLE`** at ~2.04 s; recovery 0.47 s / 2.99 s after |
| DB down 10 s (connections refused) | 100 / 100 answer 503 `DATABASE_UNAVAILABLE` within 44 ms; recovery 90 ms after |
| Pool rebuilds during those 5 events | **44 rebuilds, 141 failed probes**: every request that finds the DB "not ready" runs its own `verifyDatabaseConnection()`, which ends the current pool and creates a new one (R5) |

The 503 mapping is right; the herd of pool rebuilds is the one thing to fix (R5).

### Login (PERF-20)

bcrypt cost 10 (production default, SEC-08 floor), every attempt from its own client IP (the limiter is not
measured here):

| c | p50 | p95 | Throughput |
| --- | --- | --- | --- |
| 1 | 53.5 ms | 54.2 ms | 18.6 / s |
| 4 | 53.5 ms | 56.4 ms | 74.2 / s |
| 16 | 201.2 ms | 207.7 ms | 78.3 / s |
| 16, `UV_THREADPOOL_SIZE=8` (comparison) | 105.0 ms | 108.8 ms | 150.7 / s |

Above 4 concurrent logins they queue on libuv's 4 threads (16 / 4 × 53 ms ≈ 212 ms). The event loop stays free
(ELU ≤ 0.17). More threads only help with more cores (R6).

### Daily caps at the boundary (production caps)

All four checks pass: turn 200 → 200, turn 201 → 429 `AI_DAILY_LIMIT` with `Retry-After: 82800`; global turn
3 000 → 200, turn 3 001 → 503 `AI_CAPACITY_REACHED`. Refusals are cheap: global 503 p95 23.9 ms (562 / s), per-user
429 p95 45.7 ms (285 / s), c = 10.

### Memory and event loop (PERF-14, PERF-18) — 10-minute soak

Mixed traffic (2 chat : 6 balance : 2 history, Gemini lognormal 300 / 1 200 ms), c = 20, 600 s: 128 011 requests, all
200. Heap after GC per minute: Express 16–19 MiB, Next 58–87 MiB, no upward trend. Seconds with an event-loop stall
> 100 ms: 1 of 637 (Express), 1 of 636 (Next). PERF-18's 700 ms Express stalls (20 in 18 min in one baseline run) did
not recur in an A/B of file vs pipe logging (0 in both) nor in the soak: environmental on this machine is the best
explanation; Part 3's soak keeps watching.

### Cross-check: in-repo driver vs autocannon 8.0.0

Same endpoints, c = 10, 15 s, 5 runs each, alternating. Throughput agrees within 1–2 %; latency agrees within the
spread for chat; for millisecond-scale requests autocannon reports up to 0.8 ms less because it keeps whole
milliseconds (Express balance p50 3.77 vs 3; p99 5.57 vs 5). No discrepancy beyond that resolution.

| Target | in-repo p50 / p90 / p99 / req/s | autocannon p50 / p90 / p99 / req/s |
| --- | --- | --- |
| balance via BFF | 7.38 / 9.61 / 14.28 / 1 271 | 7 / 9 / 14 / 1 268 |
| balance on Express | 3.77 / 4.50 / 5.57 / 2 567 | 3 / 4 / 5 / 2 530 |
| chat turn via BFF | 37.87 / 46.31 / 55.97 / 255 | 39 / 46 / 60 / 250 |

### Harness corrections made during Part 1 (so the numbers above can be trusted)

* PERF-21 (Part 0 forward lost the timeout under GC) — fixed, `a4e8a51`.
* Per-request overhead is now exact (request ids carried through `AsyncLocalStorage`), `1e89e86`.
* The DB proxy first used `setTimeout(fn, 1)`: Windows timers fire in ~15.6 ms steps, so "1 ms" and "5 ms" were
  both ~31 ms per round trip. Those runs were discarded; the proxy now uses a precise scheduler in its own process.
* The mock Gemini answered after `setTimeout(…, 0)`, i.e. on the next ~15.6 ms Windows timer tick: "0 ms" was
  1–15 ms and single-user chat runs phase-locked to the tick, hiding small changes in end-to-end time (the overhead
  metric, which subtracts each request's own Gemini time, was unaffected). The mock now uses no timer for 0 ms and a
  precise wait otherwise; PERF-01 was A/B-measured after that fix. PERF-19's effects (hundreds of MiB and ms at
  c = 50) are far above that resolution.
* The caps scenario first seeded > 3 000 turns into the window and the login scenario reused client IPs (the login
  limiter answered, as designed); both fixed and re-run.
* The `[env] Loaded …/.env` line in the perf Express log is misleading: the harness preload stubs `dotenv`, and a
  check showed the environment unchanged (92 variables before and after the loader).

### Part 1 verification (PostgreSQL 18.6, after the last code change)

| Check | Result |
| --- | --- |
| `npm run typecheck:tests`, service `npm run typecheck` | 0 errors |
| Root `vitest` (unit + api, with coverage) | 29 files, **526 passed**; BFF set (TEST_PLAN §3) **94.83 %** lines (floor 94.33 %) |
| Service `vitest` (unit + api + db, with coverage) | 36 files, **652 passed**; **91.31 %** lines, **79.72 %** branches (floors 91.31 / 79.72; service code unchanged) |
| E2E, `next dev` | 49 passed, 1 skipped (by design in dev mode) |
| E2E, `E2E_NEXT_MODE=production` | **50 / 50 passed** (paid journey incl. AI Lab, desktop + mobile) |

### PERF-22 — single-flight DB reconnect probe (R5, applied after review)

`verifyDatabaseConnection()` replaces the pool on every probe, and `requireDatabase` ran one probe per request while
the database looked unavailable, so concurrent requests rebuilt the pool for each other. Change (commit in git log):
callers that arrive during a probe share it (one in-flight promise, cleared when it settles). The 503
`DATABASE_UNAVAILABLE` mapping and the pool's 2 s connect timeout are unchanged.

Tests (`services/auth-billing-service/tests/api/db-probe-single-flight.test.ts`, against a local black-hole TCP
server that accepts and never answers): 20 concurrent requests during an outage → one probe, 20 × 503 after ~2 s;
a request after a failed probe starts a new one; recovery as soon as the database answers, no probe afterwards;
one connection attempt per outage round (not per request) and no timers left; direct callers share the probe.
On the old code 4 of the 5 fail (20 probes for 20 requests, 10 sockets for 10).

`dbfaults` scenario, same five outage events (4 cold starts + 10 s down, bursts of 20 / 5 requests), before
(`09-45-22`) and after (`10-53-13`):

| | Before | After |
| --- | --- | --- |
| probes started (`[db:config] ── environment inspection ──`) | 185 | **69** |
| pool rebuilds (probes that succeeded) | 44 | **6** — startup + exactly one per outage event |
| failed probes | 141 | **63** |
| TCP connections the proxy accepted / held for the wake | 163 / 63 | **86 / 7** |
| responses (cold start 0.3 / 1.5 / 2.5 / 5 s, down 10 s) | 200 / 200 / 503 at 2.06 s / 503 at 2.04 s / 503 ≤ 44 ms | 200 / 200 / 503 at 2.03 s / 503 at 2.03 s / 503 ≤ 10 ms |
| recovery after the database returns | 5 / 5 / 466 / 2 987 ms; 90 ms | 6 / 5 / 487 / 2 982 ms; 28 ms |
| pool saturation (B), c = 10 / 20 / 40 / 80 | 42.7 / 81.7 / 83.1 / 78.5 per s | 42.1 / 83.2 / 82.9 / 78.9 per s (noise) |

Observation (pre-existing, identical before and after): when the 2 s connect timeout fires against a server that
accepted the TCP connection but never answers, `pg` leaves that socket open (still open 7.5 s later in the test).
With the shared probe this is one socket per outage round instead of one per request; against a real database the
server side closes it. Not changed.

### Incident — one real request to the Gemini API during an isolation run (Part 1)

While isolating PERF-21, one experiment (`exp-c.mjs` in the session scratchpad, SDK + local mock, run with
`--expose-gc`) was started **without** the network-guard preload. The `@google/genai` SDK therefore sent one request
to `https://generativelanguage.googleapis.com/` with the dummy API key `x` and the prompt `hi`; Google answered 400
"API key not valid". No secret, user data or project data was sent. Cause: the experiment imported the mock in-process
but nothing checked that the guard was installed — the standing rule relied on remembering the `--import` flag.

Prevention (harness-level, with tests in `tests/api/perf-harness.test.ts`):
* `scripts/perf/lib/guard.mjs` — `assertNetworkGuard()` throws unless the guard is installed in the process;
  `createMockGemini()` calls it, so an in-process experiment cannot use the mock without the guard;
* `scripts/perf/isolate.mjs <experiment.mjs>` — the supported way to run an isolation experiment: installs the guard
  (and the Gemini redirect when `PERF_GEMINI_ORIGIN` is set), verifies it, then imports the experiment;
* the runner installs and verifies the guard in its own process before anything else;
* each perf server's preload prints a marker when it installs the guard, and the stack refuses to measure a server
  whose log lacks it.

### Login event-loop target (B4)

**Not measurable on Windows; re-measure on Linux CI/staging.** The event-loop delay histogram resolves 10 ms and
Windows timers tick at ~15.6 ms, so idle runs already read 20–25 ms; a 20 ms target cannot be told apart from the
instrument's floor here. What was measured: Express's event loop stays free during logins (ELU ≤ 0.17 at c = 16).

### R9 — fewer sequential DB round trips per chat turn (recommendation only, not implemented)

After PERF-01 a chat turn makes 21 sequential round trips. `/consume` (10): C1 revoked `jti`, C2 `token_version`
(`requireAuth`), C3 `is_verified` (`requireVerified`), C4 BEGIN, C5 advisory lock, C6 find hold `FOR UPDATE`,
C7 daily caps, C8 available balance, C9 INSERT hold, C10 COMMIT. `/capture` (11): P1–P3 as C1–C3, P4 BEGIN, P5 lock,
P6 find hold `FOR UPDATE`, P7 SAVEPOINT, P8 `post_credit_transaction`, P9 UPDATE hold → captured, P10 read balance,
P11 COMMIT. Estimated saving = round trips removed × RTT (not measured; the measured link adds ≈ 2 × the
per-direction delay, see § DB latency):

| # | Merge | Round trips saved per turn | ≈ at 2.7 ms | ≈ at 11 ms | Risk notes |
| --- | --- | --- | --- | --- | --- |
| M1 | C1 + C2 + C3 → one statement (and P1–P3): `users` row with `token_version`, `is_verified` and `EXISTS(revoked jti)` | 4 | 11 ms | 44 ms | Security-critical middleware. Must keep: the in-process revoked-JTI cache, "user row missing" behaviour (requireAuth passes, requireVerified refuses), 401 vs 403 codes. Existing auth suites + the PERF-01 guarantee tests cover it. Low–moderate |
| M2 | C6 + C7 + C8 → one statement after the lock (a `FOR UPDATE` CTE for the hold plus the two aggregates) | 2 | 5 ms | 22 ms | All reads already happen under the same advisory lock in the same transaction, so no new race. The app still checks in the same order (duplicate → caps → balance). Low |
| M3 | P9 + P10 → `WITH u AS (UPDATE … RETURNING 1) SELECT balance …` | 1 | 3 ms | 11 ms | Same transaction, reads after `post_credit_transaction`. Low |
| M4 | P7 + P8 + P9 + P10 → one plpgsql call (the function's EXCEPTION block replaces the explicit SAVEPOINT; records `capture_failed` itself) | 3 (incl. M3) | 8 ms | 33 ms | New migration; `capture_failed` and HOLD_EXPIRED semantics move into SQL; SQLSTATE → HTTP mapping. Moderate |
| M5 | Whole reservation and whole capture as one SECURITY DEFINER plpgsql call each, like `post_credit_transaction` (no client-side BEGIN/COMMIT) | 13 (supersedes M2–M4) | 35 ms | 143 ms | Largest change: billing logic in SQL (migration 015+), every hold path re-proven at DB level (expiry race, duplicates, caps, insufficient credits). Also shrinks the time the user's lock and a pool connection are held from ~6–7 network round trips to none — the cause of the throughput collapse at 11 ms (83 turns/s). Moderate–high |
| — | Not mergeable without changing guarantees | — | — | — | the two BFF → Express calls (the model must run between reserve and capture); C5/P5 as separate statements (merging a lock into a data query has no guaranteed evaluation order); BEGIN/COMMIT with parameters (no pipelining in `pg`) |

Low-risk set M1 + M2 + M3: 7 round trips → ≈ 19 ms at 2.7 ms RTT, ≈ 77 ms at 11 ms. With M5 instead of M2–M4:
17 round trips (21 → 4) → ≈ 46 ms and ≈ 187 ms. Any of these would be its own measured change (A/B with the DB proxy,
as for PERF-01), not part of the launch.

### Recommendations (not applied — measured, small, or outside Part 1's remit)

| # | Area | Recommendation | Evidence |
| --- | --- | --- | --- |
| R1 | history | **Owner: not applied.** Replace `idx_credit_ledger_user_created (user_id, created_at DESC)` with `(user_id, created_at DESC, id DESC)` (matches the ORDER BY; no incremental sort, no plan flip to the global index); drop the redundant `idx_credit_ledger_user_id`. Same write cost, as a new migration. | 10×: 3.88 → expected ~0.2 ms in-DB; end to end only ~0.7 ms — not worth a migration before launch |
| R2 | daily caps | If `AI_DAILY_TURNS_GLOBAL` is raised far above 3 000, replace the global 24 h `count(*)` with a counter: it runs inside the user's lock on every reservation | 0.33 → 1.07 ms from 1.3 k to 10 k holds in the window, linear |
| R3 | reconcile | None needed; it is a daily job (246 ms at 3 M rows). Keep it off the request path | EXPLAIN |
| R4 | holds | Optional: `SET LOCAL lock_timeout` in the reservation transaction so a burst from one user cannot hold many pool connections | one user at c = 20 held 19 connections waiting |
| R5 | DB pool | **Applied as PERF-22** (§ PERF-22). Single-flight `verifyDatabaseConnection()` (share one in-flight probe; never end a pool another request just created) | 44 rebuilds / 141 probes in 5 fault events with 20 requests each |
| R6 | login | **In the launch checklist §1.4.** On a multi-core Express instance set `UV_THREADPOOL_SIZE` to the core count (≥ 4); on a ≤ 1-CPU instance leave it | 16 concurrent logins: 78 → 151 / s with 8 threads on 16 cores |
| R7 | Neon | Keep `connectionTimeoutMillis` at 2 s unless staging shows resumes > 1.5 s; prefer a paid plan with scale-to-zero disabled for production | 0.3 / 1.5 s resumes served, 2.5 / 5 s → 503 at 2 s |
| R8 | production latency | **In the launch checklist §4.7 (post-deploy).** Measure the real Vercel → Render and Render → Neon round trips on staging: each Neon round trip costs a chat turn 21×, each Render hop 2× | 2.7 ms DB RTT: chat overhead 18 → 73 ms (before PERF-01) |
| R9 | chat DB round trips | 21 sequential round trips per turn; merges M1–M5 with savings and risks in § R9 (owner: recommendation only) | 2.7 ms RTT: low-risk set ≈ 19 ms, full ≈ 46 ms per turn |

## Part 2 — frontend (branch `perf/frontend`)

Method: production build on the perf stack; guarded Chromium (nothing but localhost resolves); Lighthouse-like
profiles — **mobile** = 412×823 @1.75, 4× CPU, 150 ms RTT, 1.6 Mbps; **desktop** = 1350×940, 40 ms, 10 Mbps
(CDP throttling); WebGL on the real GPU (AMD RX 6600 via ANGLE/D3D11) unless stated. Every figure is the median
of 5 cold loads (fresh context) after a discarded warm-up, [min–max]. Lighthouse 13.5.0 (simulated throttling)
is the cross-check; Playwright measures what the throttled browser actually does. Bundle sizes come from Next's
own analyzer (deterministic, compressed). Result files: `perf-results/` (gitignored).

### Budgets (B5, B6) — before → after

| Route (mobile) | LCP, Playwright | LCP, Lighthouse | Lighthouse score | CLS | INP proxy | TBT proxy, Playwright | JS transferred |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 7 280 → **1 332 ms** | 15 618 → **3 608 ms** | 50 → **66** | 0 → 0 | 96 → 88 ms | 1 312 → 1 103 ms | 956 → 870 KiB |
| `/explore` | 6 868 → **1 176 ms** | 15 618 → **3 458 ms** | 57 → **77** | 0 → 0 | 88 → 80 ms | 841 → 775 ms | 971 → 769 KiB |
| `/periodic-table` | 4 684 → **1 172 ms** | 5 898 → **3 307 ms** | 76 → **91** | 0 → 0 | 80 → 72 ms | 412 → **128 ms** | 600 → **296 KiB** |
| `/ai-lab` (signed in) | 6 640 → 5 868 ms | 15 469 → **7 944 ms** | 58 → 58 | 0 → 0 | 96 → 96 ms | 774 → 805 ms | 951 → 865 KiB |
| `/dashboard` (signed in) | 5 232 → **3 252 ms** | 6 066 → **4 392 ms** | 75 → **83** | 0 → 0 | 48 → 40 ms | 553 → 381 ms | 591 → **287 KiB** |

Desktop (Lighthouse score / LCP): `/` 81 → **97** / 2 738 → 729 ms; `/explore` 83 → **99** / 2 778 → 687 ms;
`/periodic-table` 98 → **100**; `/ai-lab` 83 → 84 (Playwright LCP 1 588 → 312 ms); `/dashboard` 97 → 99.

* **B5 LCP < 2.5 s (mobile):** met in the browser on `/`, `/explore`, `/periodic-table` (LCP now = first paint);
  **not met** on `/ai-lab` (5.9 s: the phone layout's LCP element is the chat greeting, which only exists after
  hydration) and `/dashboard` (3.3 s: the signed-in page renders after client-side auth state). Lighthouse's
  simulated LCP is 3.3–3.6 s on the public routes — it models the font and CSS requests on a 150 ms RTT link
  before the text can paint (recommendations R10–R12).
* **CLS < 0.1:** 0–0.01 everywhere, before and after. The theme handling (FINDING-26) causes **no** layout shift.
* **INP < 200 ms:** proxy 16–104 ms everywhere (scripted menu / element clicks; a lab proxy, not field INP).
* **B6 landing JS:** documented; ceiling = after + 10 % (`scripts/perf/bundle-budget.json`, checked in CI).

### Bundle composition (Next analyzer, compressed client JS loaded up front)

| Route group | Baseline | After | What left the initial load |
| --- | --- | --- | --- |
| Non-3D routes (`/login`, `/pricing`, `/periodic-table`, `/dashboard`, …) | 673–690 KiB | **344–362 KiB (−49 %)** | markdown + KaTeX 128.7, all 12 locales 109.6 → 8.5, three.js 96.5 |
| 3D routes (`/`, `/explore`, `/atom-models`, `/ai-lab`) | 1 007–1 059 KiB | **775–827 KiB (−22 %)** | markdown + KaTeX, 11 locales |

Initial CSS 33.7 → 30.1 KiB (KaTeX). New async chunks: the chat renderer (131 KiB, only when a chat panel exists)
and one locale file (only for a non-English visitor). Lighthouse "unused JavaScript" on `/periodic-table`:
182 → 26 KiB. Remaining weight on 3D routes: three / R3F / drei / postprocessing ≈ 358 KiB, React/Next 165 KiB,
framer-motion 57 KiB (used on most pages).

### Changes

| ID | Change | Commit | Evidence |
| --- | --- | --- | --- |
| PERF-23 | Above-the-fold entrances (hero / page headers on `/`, `/explore`, `/periodic-table`, `/ai-lab`, `/dashboard`, and the AI Lab panel) in CSS (`tw-animate-css`) instead of framer-motion's `opacity: 0` initial state, which kept the LCP text invisible until all JavaScript had hydrated. LCP elements slide/scale **without a fade**: a first attempt with a fade made Chrome drop the hero as an LCP candidate (an element first painted at opacity 0 is never one) and reported other elements — the measurement caught it and the fade was removed. `motion-reduce:animate-none` now honours reduced motion (framer-motion did not). | `2d953f4`, `3a1cb37` | LCP table above |
| PERF-27 | **Memory leak across navigations.** Every visit to a 3D page leaked its whole WebGLRenderer: two module-level GPU resources shared by all renderers — three 0.184's `DFG_LUT` texture and postprocessing's full-screen triangle — collected one `dispose` listener per renderer, and R3F's unmount never calls `renderer.dispose()`. Each listener kept the renderer's property table (environment maps, 4 MiB each) and, through the WebGL context, the unmounted page's canvas and DOM. Found with heap snapshots and retainer paths (runtime steps 9–11). `CanvasRendererRelease` (in all three `<Canvas>`es) disposes both shared resources once and then the renderer on a real unmount. | `4565148` | ArrayBuffers per visit `/` 8.02 → 0–0.2 MiB, `/explore` 4.01 → 0.67 MiB; DOM nodes / listeners retained per visit 777 / 37 → 0 / 0; JS heap after 20 cycles 46.3 MiB rising → 19.4 MiB flat |
| PERF-24 | Chat markdown / KaTeX renderer (and KaTeX CSS) on demand: `LazyChatMessageContent` (React.lazy, prefetched when a chat panel mounts; escaped plain-text fallback; `ChatMessageContent` and its SEC-15 tests unchanged). | `6ea332a` | −129 to −131 KiB on every route |
| PERF-25 | No three.js in `FocusProvider` (every page): a plain `Vector3Like` point. | `d53b0db` | −96.5 KiB on non-3D routes |
| PERF-26 | Locale content on demand: English built in; others load before the switch (TC-49). | `bf3a487` | −101 KiB on every route; production check: stored `de` switches with one extra request |

### Other Part 2 measurements (no change needed)

| Area | Result |
| --- | --- |
| 3D frame time (`/`, `/explore`) | Desktop and mobile profile on a real GPU: 60 fps idle and orbiting, ≤ 4 frames > 33 ms in 4 s. **Low-end proxy (4× CPU + SwiftShader software GL): 8.5–9 fps on `/`, 16–17 fps on `/explore`** — a pessimistic stand-in for GPU-less devices (R13). |
| Reduced motion | `prefers-reduced-motion: reduce` does not stop the 3D scene: 5 430 draw calls/s idle on `/` either way (auto-rotate keeps running). Accessibility rather than speed (R14). |
| React re-renders | 0 commits while idle on `/periodic-table` and `/dashboard`; 2.4 commits per element click. No unnecessary re-render loop. |
| Balance polling (PERF-06) | Per signed-in tab: 3 requests on a dashboard load, then **none** while idle (visible or hidden); after a checkout ~11 polls in 30 s, then stops (also while hidden — bounded). |
| AI Lab long answer (6 000 chars, markdown + math) | On screen in ~240 ms (desktop), one long task ~100 ms. **No KaTeX output survives `rehype-sanitize`** (class names and MathML are stripped — the accepted SEC-15 rendering loss), so KaTeX's processing currently produces nothing visible (R15). |
| Ledger table (`/dashboard`, 100 rows, mobile) | 1 005 DOM nodes, 101 rows — virtualisation not needed at this size. |
| Caching / TTFB | Pages `private, no-store` (required by the per-request nonce CSP — kept); `/_next/static/*` `public, max-age=31536000, immutable`; `public/` files (incl. the 3.2 MB of environment maps) `public, max-age=0, must-revalidate` (revalidated on every visit — R12). TTFB of dynamic pages p50 5–10 ms locally. |

### Recommendations (Part 2)

| # | Area | Recommendation | Evidence |
| --- | --- | --- | --- |
| R10 | LCP on `/dashboard`, `/ai-lab` mobile | Server-render the signed-in page header and the AI Lab greeting (they render after client-side auth / chat state today), or make the greeting static markup. | LCP 3.3 s / 5.9 s; element = signed-in header / chat greeting |
| R11 | Fonts | Lighthouse's simulated LCP (3.3–3.6 s) waits on the font request on a 150 ms link. Consider preloading only the display font weight used above the fold, or `font-display: optional` for it (visual trade-off). | Lighthouse vs Playwright LCP gap |
| R12 | Environment maps | Serve `/hdri/*` with a long `Cache-Control` (version the file name when it changes) and start loading them after first paint on mobile; 1.5 MB per 3D route competes with JavaScript on slow links. | `max-age=0, must-revalidate`; 1.5 MB per 3D route |
| R13 | Low-end devices | Offer a reduced 3D mode (lower DPR, no post-processing, `frameloop="demand"`) when the device tier is low or WebGL reports a software renderer. | 8.5–9 fps with software GL |
| R14 | Reduced motion | **Applied** (`8e3a68c`: camera auto-rotate, idle spin / float, particle drift and the orbiting light stop; canvas pixels changing between frames 13 % → 0.04–0.09 %). Was: stop auto-rotate / idle animation when `prefers-reduced-motion: reduce`. | 5 430 draws/s with reduce |
| R15 | KaTeX | **Applied (owner decision): KaTeX removed; maths shown as monospace source** (`src/lib/ai/math-as-code.ts`; the renderer's async chunk ~81 KiB smaller; the KaTeX advisory is gone). Was: either let the sanitiser keep KaTeX's output (a security review of the schema) or drop math rendering; today its work is discarded (owner decision, SEC-15). | 0 MathML / `.katex` nodes after sanitising |
| R16 | three.js DFG leak upstream | **Kept as a recommendation** (filing upstream issues is an outward action for the owner; draft text below). Report the shared-resource listener leak to three.js / R3F / @react-three/postprocessing; remove `CanvasRendererRelease` once fixed upstream (the budget check and runtime step 10 will show it). | PERF-27 |

### R16 — draft upstream report (not filed)

> **Title:** WebGLRenderer instances are retained after unmount through dispose listeners on module-level shared
> resources (`DFG_LUT`, postprocessing's `fullscreenGeometry`)
>
> three 0.184's `getDFGLUT()` and postprocessing 6.39's `Pass.fullscreenGeometry` are module-level singletons.
> Every WebGLRenderer that uploads them adds a `dispose` listener (WebGLTextures / WebGLGeometries) that closes over
> the renderer's internal state. @react-three/fiber 9's `unmountComponentAtNode` forces a context loss but never
> calls `renderer.dispose()`, and nothing disposes the singletons, so each unmounted canvas keeps its renderer, its
> property table (textures such as environment maps) and, through the WebGL context, the canvas and its DOM.
> Measured: ~4 MiB of ArrayBuffers and ~400–800 DOM nodes per mount/unmount cycle, unbounded. Workaround: on a real
> unmount, `getDFGLUT().dispose()` (via a material's `dfgLUT` uniform), `Pass.fullscreenGeometry.dispose()`, then
> `renderer.dispose()`. Possible fixes: R3F calling `gl.dispose()` on unmount; three removing a renderer's listeners
> from shared resources in `WebGLRenderer.dispose()`.

### Part 2 verification

| Check | Result |
| --- | --- |
| `npm run typecheck:tests` | 0 errors |
| Root `vitest` with coverage | 32 files, **542 passed**; BFF set **94.83 %** lines (floor 94.33 %) |
| Service `vitest` with coverage | 37 files, **657 passed**; **91.48 %** lines, **80.14 %** branches (floors 91.31 / 79.72; service unchanged in Part 2) |
| `next build` | OK |
| `npm run perf:bundle-budget` | OK (every route 9–10 % under its ceiling) |
| E2E `next dev` | 49 passed, 1 skipped (needs the production build, by design) |
| E2E `E2E_NEXT_MODE=production` | **50 / 50 passed** (paid journey incl. AI Lab, desktop + mobile) |
| ESLint (whole repo, harness output ignored) | 26 errors, 21 warnings — `main`: 27 / 21 (the documented React Compiler backlog; none new) |

## Part 3 — load, soak and failure injection (branch `perf/load`)

Same machine, builds and guards as Parts 1–2 (production `next start` + Express `dist`, mock Gemini lognormal
1.5 s / 4 s, PostgreSQL 18.6 in the project's test container, network guard verified in both servers on every run).
New in the harness: an **open-loop** driver (fixed arrival rate, latency from each arrival's scheduled time — no
coordinated omission) and a production-like **mixed traffic** profile, per 100 arrivals: 35 anonymous pages,
25 balance reads, 10 history reads, 10 chat turns, 8 logins (bcrypt cost 10), 6 checkouts (Lemon mocked), 6 signed
`order_created` webhooks straight to Express. Every arrival has its own client IP; users rotate over 5 000 seeded
accounts. This mix is deliberately login- and chat-heavy compared with real traffic. Result folders:
`perf-results/` (gitignored); commands: README §2.

**Repetitions.** A ramp step is one 30 s window, so each breaking point was measured in 5 separate stack runs
(the full ramp, a rerun of the top steps, three runs of the boundary steps — table below). The soak (15 min) and the
failure run (~9 min plus settling) ran twice each; the first run of each exposed a harness defect (PERF-28, and a
mock reset that dropped the model latency) and the second is the one reported. Their results are counts and
invariants, not latency comparisons.

### Ramp through the BFF (browser → Next → Express)

| req/s | errors % | page | balance | history | login | checkout | webhook | chat | Next ELU / lag p99 ms | Express ELU / lag | RSS MiB Next / Express | sockets Next / Express | DB active / idle-in-tx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 0 | 24 | 21 | 22 | 71 | 23 | 16 | 4 436 | 0.10 / 30 | 0.03 / 33 | 289 / 94 | 18 / 8 | 0 / 1 |
| 50 | 0 | 27 | 23 | 24 | 70 | 23 | 18 | 3 649 | 0.19 / 34 | 0.05 / 35 | 289 / 96 | 28 / 8 | 1 / 0 |
| 100 | 0 | 25 | 24 | 22 | 72 | 22 | 15 | 3 866 | 0.32 / 34 | 0.07 / 34 | 386 / 114 | 49 / 8 | 1 / 1 |
| 150 | 0 | 26 | 23 | 22 | 69 | 23 | 15 | 4 114 | 0.46 / 33 | 0.11 / 32 | 418 / 144 | 69 / 12 | 1 / 2 |
| 200 | 0 | 30 | 22 | 22 | 69 | 24 | 11 | 4 289 | 0.58 / 29 | 0.13 / 34 | 425 / 148 | 96 / 13 | 1 / 1 |
| 300 | 0 | 96 | 47 | 48 | 95 | 47 | 8 | 3 954 | 0.84 / 75 | 0.19 / 21 | 510 / 210 | 181 / 43 | 1 / 2 |
| **400** | **1.59** | 2 203 | 3 238 | 3 111 | 3 513 | 3 127 | 15 | 9 227 | **1.00** / 281 | 0.24 / 25 | 574 / 223 | 1 511 / 464 | 6 / 13 |
| 600 | 33.3 | 2 536 | 3 994 | 3 818 | 3 982 | 4 556 | 15 | 11 593 | 1.00 / 309 | 0.25 / 29 | 629 / 239 | 1 958 / 614 | 9 / 8 |
| recovery 300 | 0 | 61 | 32 | 31 | 81 | 31 | 7 | 3 797 | 0.83 / 31 | 0.19 / 21 | | | 2 / 2 |

p95 in ms; one full ramp (25 → 600 req/s); the recovery row is from the rerun.

* **Breaking point: ≈ 400 req/s of this mix; saturation from 350** (5 runs, table below). 300 req/s is clean
  (worst non-chat p95 88 ms median, 194 ms in the slowest run); at 400 (3 of 5 runs) the error rate passes 1 % or Next-served p95s reach 1–7 s.
* **First bottleneck: the Next process's CPU** (event-loop utilisation 0.84 at 300 → 1.00 at 400, lag p99 281 ms).
  Express is at ELU 0.24, the database shows no lock waits and ≤ 9 active backends, and webhooks — served by
  Express directly — keep a 15 ms p95 throughout. Next spends ≈ 2.8 ms of CPU per mixed request (ELU 0.84 / 300).
* **Error behaviour: connection refusals only.** Every error at 400 / 600 req/s is `ECONNREFUSED` at Next (its
  accept queue overflows while the event loop is saturated): no 5xx, no crash, no hang, no restart. On Windows a
  full accept backlog refuses connections; on Linux the same overload is more likely to show as SYN retries
  (connect latency) — re-check the shape on staging.
* **Recovery:** back at 300 req/s right after 30 s at 600, the next 30 s window has 0 errors and normal p95s.
* **Charges:** after the ramp, every reservation captured, none held, 0 CAPTURE_FAILED, `db:reconcile` exit 0.

### Ramp straight to Express (what one Express instance can take)

On Vercel, Next scales out; Express on Render is a single process (in-memory limiters, in-process sweeper —
LAUNCH_CHECKLIST §A). The same mix minus pages, sent exactly as the BFF sends it (internal key, `X-Client-IP`;
a chat turn = `/consume` then `/capture` on the same reservation, without the model wait):

| req/s | errors % | balance | history | chat (consume + capture) | login | checkout | webhook | Express ELU / lag p99 | RSS MiB | sockets | DB active / idle-in-tx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 200 | 0 | 15 | 18 | 32 | 65 | 11 | 15 | 0.19 / 34 | 142 | 14 | 2 / 1 |
| 400 | 0 | 10 | 10 | 25 | 63 | 10 | 6 | 0.34 / 22 | 214 | 22 | 3 / 2 |
| 600 | 0 | 8 | 7 | 28 | 347 | 10 | 5 | 0.52 / 12 | 240 | 48 | 3 / 3 |
| **800** | 0 | 8 | 8 | 36 | **11 538** | 10 | 4 | 0.68 / 13 | 298 | 942 | 5 / 6 |
| 1 000 | 9.05 | 10 | 10 | 55 | 19 355 | 14 | 4 | 0.79 / 13 | 342 | 1 520 | 6 / 9 |
| recovery 600 | 0 | 8 | 7 | 27 | 111 | 10 | 5 | 0.51 / 12 | | | 3 / 3 |

(RSS in this run still includes PERF-28's harness call log; the recovery row is from the rerun.)

* **Breaking point: between 600 and 700 req/s of this mix, and it is login** (5 runs, table below). 8 % of 700 =
  56 logins/s already queue under mixed load; in isolation (Part 1) bcrypt managed 74–78/s on libuv's 4 threads. Logins queue (p95 0.35 s at 600, 11.5 s at 800,
  19 s at 1 000) while every other route stays ≤ 14 ms p95 and the event loop is free (ELU ≤ 0.79, lag ≤ 13 ms).
* **Error behaviour: none from Express** — it never answers 5xx or refuses; the 9 % at 1 000 req/s are arrivals the
  driver dropped at its own 1 500 in-flight cap (sockets 1 520). The hazard is the **unbounded login queue**:
  through the BFF a queued login is answered 504 after the gateway's 10 s timeout, while Express still performs
  the hash it queued (R17).
* Without logins Express's CPU allows ≈ 1 150 req/s of the rest of the mix (ELU 0.52 at 600 incl. logins).
* **Recovery:** clean (0 errors, login p95 111 ms) in the first 30 s at 600 after the 1 000 req/s step.

### Breaking points over 5 runs

Each boundary step measured in 5 separate stack runs (3 for the intermediate 350 / 700 req/s steps); median
[min–max]. "Breaks" = > 1 % errors, dropped arrivals, or a non-chat p95 > 1 s.

| Target | req/s | runs broken | errors % | worst non-chat p95 (ms) | ELU of the bottleneck process |
| --- | --- | --- | --- | --- | --- |
| BFF | 300 | **0 / 5** | 0 [0–0.01] | 88 [77–194] | Next 0.86 [0.84–0.90] |
| BFF | 350 | 0 / 3 | 0 [0–0.03] | 228 [120–229] | Next **1.00** [0.96–1.00] |
| BFF | 400 | **3 / 5** | 0.01 [0–3.38] | 1 106 [492–7 219] | Next 1.00 |
| BFF | 600 | 2 / 2 | 33.3 [33.3–34.9] | 4 556 [4 556–4 976] | Next 1.00 |
| Express | 600 | **0 / 5** | 0 | 80 [66–347] (login) | Express 0.49 [0.48–0.52] |
| Express | 700 | **3 / 3** | 0 | 4 376 [4 349–4 551] (login) | Express 0.55 [0.55–0.56] |
| Express | 800 | 5 / 5 | 0 | 11 192 [9 969–11 538] (login) | Express 0.66 [0.64–0.69] |
| Express | 1 000 | 2 / 2 | 9.05 [9.05–9.68] (driver's in-flight cap) | 19 355 [19 355–19 382] (login) | Express 0.79 [0.79–0.82] |

So: **the BFF is clean to 300 req/s, saturates from 350 (Next's event loop 96–100 % busy, p95 ≈ 0.2 s) and breaks
at ≈ 400; one Express is clean to 600 req/s and breaks at ≈ 700 — on logins only** (56 logins/s queue under mixed
load, against 74–78/s with nothing else running in Part 1). Express answered no request with an error in any run.

### Soak: 15 minutes of mixed traffic at 200 req/s through the BFF (half the breaking rate)

180 000 requests, 15 one-minute windows (per-minute ranges):

| Measure | Range over 15 minutes |
| --- | --- |
| errors | 0 in 14 windows; 1 page + 1 chat in minute 15 (status 0: a client-side transport error; the code was not kept in this run — the scenario keeps it now), right after the second deliberate heap snapshot paused Express ≈ 0.7 s; the first soak had one (1 chat, minute 6). 3 transport errors in 360 000 requests over both soaks; neither server logged an error |
| p95 page / balance / history / checkout / webhook / login | 24–31 / 20–24 / 20–25 / 20–28 / 10–15 / 67–70 ms — no drift |
| p95 chat (model 1.5 s / 4 s lognormal) | 3.7–4.3 s — no drift |
| Next: heap / RSS / open handles / sockets / ELU / lag p99 | 275–310 MiB / 496–522 MiB / 139–231 / 92–173 / 0.50–0.55 / 25–38 ms — flat |
| Express: heap / RSS / open handles / sockets / ELU / lag p99 | 26–49 MiB / 115–160 MiB / 19–26 (151 around a snapshot) / 13–19 (130 around a snapshot) / 0.12–0.14 / 24–36 ms (670 ms: the snapshot itself) — flat; heap after full GC 21.2 MiB at 1.5 min → 24.2 MiB at 15.5 min |
| DB backends (active / idle / idle in transaction) | 1–2 / 5–7 / 1–3; idle 20 and idle-in-transaction up to 14 only around the two heap snapshots (minutes 1, 14–15), when requests queued behind the paused Express |
| After: reservations | 18 599 created, **18 599 captured**, 0 held, 0 held past expiry |
| After: CAPTURE_FAILED (BFF / Express logs) | **0 / 0** |
| After: `db:reconcile` | **exit 0** (balances = SUM(ledger), no failed or unsettled captures, no unreviewed refunds) |

The +3 MiB that remain on Express's heap after full GCs are ≈ 13 800 `Date` + `Object` pairs: the login limiter's
in-memory store (one key per IP + email for its 15-minute window — bounded by the window, ≈ 0.2 KiB per key).

### PERF-28 — the soak's Express heap grew ≈ 7 MiB/min (harness defect, fixed)

The first soak showed Express's heap after GC rising linearly, 14 → 135 MiB in 15 minutes (RSS 148 → 332 MiB).
Heap snapshots 4 minutes apart (new preload option `PERF_HEAP_SNAP`, new `scripts/perf/heap-diff.mjs`): +28 MiB
of strings, ≈ 3 700 pairs of ~1 KB JSON bodies held by a module-level array — `externalCalls` in
`scripts/test/network-guard.mjs`, which records every stubbed external call (here the mocked Lemon checkout API)
so tests can assert on them. The perf servers never read it. Production does not load the guard: **not an
application leak.** Fix: `installNetworkGuard({ recordCalls: false })` in the perf preload — blocking and stubbing
unchanged, tests keep recording by default; a new test checks that a perf server still stubs Lemon, still blocks
other hosts and records nothing. After: heap after GC 21 → 24 MiB over 15 min (table above).

### Failure injection under load (100 req/s, reservations TTL 180 s, sweep every 30 s)

Mixed traffic at a quarter of the breaking rate, through consecutive phases; DB faults through the harness proxy
between Express and PostgreSQL, "billing unavailable" through a second proxy between Next and Express (every
connection dropped, new ones refused). TTL 180 s ≥ 2 × the longest turn with the production BFF defaults.

| Phase | Errors | What the user sees | Notes |
| --- | --- | --- | --- |
| baseline 60 s | 0 % | — | chat p95 3.9 s |
| Gemini 5xx on 50 % of model calls, 60 s | 5.0 % (= every failed turn) | chat **502** at once (p95 3.9 s for the answered half); nothing else affected | all 301 failed turns **released** (`ai_generation_error`) |
| Gemini hangs on 50 %, 60 s | 5.0 % | chat **504** at 30.0 s (`GEMINI_TIMEOUT_MS`, max 30.07 s); in-flight turns 174 | all 301 **released** (`gemini_timeout`); other routes unaffected (p95 ≤ 74 ms) |
| DB +20 ms per direction, 60 s | 0 % | slower: balance / history p95 140 ms, checkout 222 ms, chat overhead +0.8 s | 17 idle + 12 idle-in-transaction backends (connections held across round trips) |
| **DB +100 ms per direction (200 ms RTT), 30 s** | **41.6 %** | balance / history / login / checkout **500 `INTERNAL_ERROR`** after ≈ 6 s; chat **503** (reservation refused) | the pool's 20 connections are all held; requests wait 2 s for one and fail with pg-pool's "timeout exceeded when trying to connect" — mapped to **500, not 503** (PERF-29, R18). Pages and webhook acks unaffected |
| billing unavailable 30 s (inside a 90 s phase) | 19.7 % (= every BFF → Express call during the 30 s) | balance, history, login, checkout, chat **503** at once (p95 ≤ 26 ms); pages fine | turns already past the reservation when billing went away: their capture retries (4 attempts in ≈ 4.3 s) fail → **CAPTURE_FAILED**, turn answered **uncharged** |
| recovery 60 s | 0 % | — | normal p95s in the first window |

Every phase failed fast and cleanly: no hang beyond the configured timeouts (longest turn 39 s, in the DB spike),
Express's event loop ELU ≤ 0.08 throughout, Next's ≤ 0.32, no crash or restart, full recovery in the first window.

**Charges afterwards** (all reservations settled 60 s after the last phase; `perf-results/…-faults`):

| Check | Result |
| --- | --- |
| reservations still `held` / held past expiry | **0 / 0** |
| answered turns (HTTP 200) vs `CREDIT_CONSUMPTION` rows | 3 042 answered = **3 020 charged + 22 uncharged**; no turn charged twice; every failed turn released (602) |
| the 22 uncharged turns | 22 `CAPTURE_FAILED` lines in the BFF log (4 × 500 `INTERNAL_ERROR` during the DB spike, 18 × 503 unreachable during the billing outage, each after 4 attempts) = **22 reservations expired by the sweeper** |
| `db:reconcile` | **exit 2: 22 × `hold_expired_unsettled`**, nothing else — every cached balance equals SUM(ledger); no `capture_failed`. This is the reconcile doing its job: an expired reservation means "answered, never charged — correlate with CAPTURE_FAILED" (migration 009). The brief's "exit 0 after failure injection" is **not met**, and cannot be with today's design whenever the capture path is down longer than the BFF's ≈ 4 s retry window (R20) |
| webhooks acknowledged 200 vs purchases credited | 2 520 acknowledged = **2 419 credited + 101 lost**; no order credited twice. The 101 arrived during the DB spike: the webhook is acknowledged **before** the database work (by design), the background allocation then failed on the pool timeout (`[Webhook] FAILED background credit allocation — replay this event manually`, 101 lines) and Lemon will not redeliver an acknowledged event. LAUNCH_CHECKLIST §5 already says to resend such deliveries from Lemon's dashboard; **56 % of the purchases arriving during a 30 s DB degradation** (101 of 180) needed it (R19) |

A first run of this scenario reset the mock's latency model to 0 ms after the first phase (`/__config` replaces the
configuration); it was fixed and rerun, and only the rerun is reported. Its integrity results were the same in kind
(8 uncharged turns, 117 webhooks to replay, reconcile exit 2 with only `hold_expired_unsettled`).

### Capacity guidance (local estimates — re-validate on staging)

Local means one desktop core per process at 4.6 GHz boost and loopback networking; cloud vCPUs are usually slower
per core and every hop costs a real round trip (README §2). Treat each figure as an upper bound and re-run the same
scenarios against staging (R8) before relying on them.

| Component | Local single-process limit (this mix) | First limit | Guidance |
| --- | --- | --- | --- |
| Next (BFF + pages), per instance | **≈ 300 req/s** clean; saturates from 350, breaks ≈ 400 | CPU (≈ 2.8 ms per mixed request) | On Vercel, instances scale with load: a single instance's ceiling is not the site's. What matters is Express behind it (next row). Set Upstash so the per-user chat limiter holds across instances (LAUNCH_CHECKLIST §A) |
| Express, single instance | **≈ 600 req/s** of the BFF's calls clean; logins queue from ≈ 56/s under mixed load | **bcrypt** on libuv's 4 threads (≈ 50 logins/s under mixed load, 74–78/s alone); then CPU at ≈ 1 150 req/s of the rest | Must stay **one instance** (in-memory limiters and sweeper). On a 1-vCPU instance bcrypt competes with the event loop for the one core: one local core hashes ≈ 19 logins/s, a cloud vCPU fewer — plan for ≈ 10/s and measure on staging. `UV_THREADPOOL_SIZE` = core count only with > 4 cores (R6). Logins are the first thing to watch (R17) |
| Chat turns | DB-bound: Part 1 measured ≈ 250 reserve + capture per second at a 2.7 ms DB round trip | DB round trips × RTT (21 per turn) | Far above the business cap: `AI_DAILY_TURNS_GLOBAL` = 3 000 per day (≈ 0.03 turns/s on average). Gemini's own quota and latency are the practical limit |
| PostgreSQL (Neon) | no lock waits; ≤ 9 active backends at the BFF's breaking point | pool of 20 per Express; RTT | Under a 200 ms RTT spike the pool saturates within seconds (R18, R19). Watch connection count and RTT |
| Memory | Express RSS 115–160 MiB at 200 req/s; Next RSS ≈ 500 MiB at 200 req/s on one instance | — | A 512 MiB Express instance fits; size Next per platform defaults |

### Part 3 verification

Full suites on PostgreSQL 18.6 after the last code change: PERFORMANCE_SUMMARY § 9 (service 657 passed, 91.48 % /
80.14 %; root 556 passed, BFF 94.83 %; type checks clean; `next build` and bundle budget OK; E2E dev 49 + 1 skipped
twice, production 50 / 50; lint unchanged from `main`).

### Recommendations (Part 3)

| # | Area | Recommendation | Evidence |
| --- | --- | --- | --- |
| R17 | login under load | Bound concurrent password hashing in Express (a small semaphore, e.g. 2 × the thread-pool size) and answer **503 + `Retry-After`** when more are waiting, instead of an unbounded queue; optionally skip the hash when the client has gone. Auth flow: owner decision. | 64 logins/s: p95 11.5 s, 19 s at 80/s; through the BFF a 504 at 10 s while Express still hashes |
| R18 | DB pool exhaustion | **Ready to apply on approval** (small, in the error handler): map pg-pool's acquire timeout ("timeout exceeded when trying to connect") and connection errors to **503 `DATABASE_UNAVAILABLE` + `Retry-After`**, like `requireDatabase` already does when the database is known to be down. The BFF already retries captures and releases on any 5xx, so retries are unchanged; users and monitors see the correct class of error. | 1 293 × 500 `INTERNAL_ERROR` in 30 s at 200 ms DB RTT |
| R19 | webhook durability | Store the verified event before acknowledging (an inbox table written in one INSERT, processed with retries), or acknowledge only after the allocation commits so Lemon redelivers (confirm Lemon's retry policy first). Until then: **page on `[Webhook] FAILED background credit allocation`** (post-launch monitoring). Money flow: owner decision. | 101 of 180 purchases during a 30 s DB spike acknowledged but not credited |
| R20 | uncharged turns in billing outages | Today a capture that fails for ≈ 4.3 s leaves the turn uncharged (reported by reconcile). Options: a longer capture backoff inside the reservation TTL, or a durable capture outbox. Or accept it as bounded revenue leakage and review `hold_expired_unsettled` daily (it is already the reconcile's job). Billing semantics: owner decision. | 22 uncharged turns: a 30 s billing outage and a 30 s DB spike |

## Findings log

| ID | Area | Baseline | After | Method | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | Part 0 builds the harness only; nothing is optimised | — | — |
| PERF-21 | harness | first turn after start hung ~306 s (1 of 3 runs); every turn under forced GC | 504 at 30.0–30.3 s on every turn, with and without forced GC | reproduction table above | see git log | refuted (harness defect, fixed) |
| PERF-19 | Next memory / tails | c = 50: heap 1 990–2 278 MiB, lag 571–649 ms, p99 655 ms [370–4 057] | heap 302 MiB, lag 35 ms, p99 209 ms [199–225] | chat c = 50, 5 runs; forced-GC floor E1/E2/A1 | `22c2564` | fixed |
| PERF-01 / PERF-03 | `/api/chat` hop | c = 1 p95 21.35 ms; at 2.73 ms DB RTT c = 10 p95 89.1 ms, 126 / s | c = 1 p95 18.72 ms; at 2.73 ms DB RTT c = 10 p95 75.0 ms, 146 / s | A/B chat, loopback and DB proxy, 5 runs | see git log | fixed |
| PERF-22 | DB reconnect (R5) | 5 outage events: 185 probes, 44 pool rebuilds, 163 DB connections | 69 probes, 6 rebuilds, 86 connections; same responses | `dbfaults` before/after; 5 new tests | see git log | fixed |
| PERF-23 | LCP (frontend) | mobile LCP / 7 280, /explore 6 868, /periodic-table 4 684 ms | 1 332 / 1 176 / 1 172 ms (Lighthouse 15 618 / 15 618 / 5 898 → 3 608 / 3 458 / 3 307 ms) | webvitals + lighthouse, 5 runs | `2d953f4`, `3a1cb37` | fixed (3 routes); /ai-lab, /dashboard → R10 |
| PERF-27 | 3D memory leak | +8.02 MiB ArrayBuffers and 777 DOM nodes per visit to /; heap 46.3 MiB rising after 20 cycles | 0–0.2 MiB, 0 nodes; heap 19.4 MiB flat | runtime steps 2, 9–11 | `4565148` | fixed |
| PERF-24 | bundle (chat renderer) | +128.7 KiB on every route | 0 (131 KiB async chunk) | Next analyzer | `6ea332a` | fixed |
| PERF-25 | bundle (three.js) | +96.5 KiB on non-3D routes | 0 | Next analyzer | `d53b0db` | fixed |
| PERF-26 | bundle (locales) | 109.6 KiB on every route | 8.5 KiB (English) | Next analyzer + production check | `bf3a487` | fixed |
| PERF-04, 05, 13, 16, 17, 20 | DB, pool, login | § Part 1 | — | metering, dbfaults, explain, login, caps | — | measured — recommendations R1–R8 |
| PERF-28 | harness (soak) | Express heap after GC +7 MiB/min (14 → 135 MiB in 15 min): the test network guard's call log | 21 → 24 MiB in 15 min (login limiter store, bounded) | `soakmix` + heap snapshots, `heap-diff.mjs` | `e83eda4` | fixed (harness only) |
| PERF-29 | DB pool exhaustion | 200 ms DB RTT for 30 s: 500 `INTERNAL_ERROR` on balance / history / login / checkout | — | `faults` | — | measured — R18 (ready on approval) |
| PERF-30 | webhooks under DB degradation | 101 of 180 acknowledged purchases not credited during a 30 s DB spike (manual resend) | — | `faults` + ledger count | — | measured — R19 |
| PERF-31 | login under overload | 64 logins/s on one Express: p95 11.5 s, unbounded queue | — | `ramp` (Express-direct) | — | measured — R17 |
| — | capacity | BFF clean to 300 req/s, breaks ≈ 400 (Next CPU); Express clean to 600, breaks ≈ 700 (bcrypt); clean recovery; soak flat; failures fast and clean; charges exact (22 uncharged turns and 101 webhooks reported, none double) | — | `ramp`, `soakmix`, `faults` | — | measured (§ Part 3) |
