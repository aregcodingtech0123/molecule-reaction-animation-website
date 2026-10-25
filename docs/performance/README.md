# Performance harness and measurement plan

Phase: performance (Part 0, branch `perf/measurement`). Findings, baselines and changes are recorded in
[`PERFORMANCE_FINDINGS.md`](PERFORMANCE_FINDINGS.md); this file explains **how** numbers are produced and what is
measured against which budget. Nothing here contacts a remote service: the stack is local, production-mode, and both
servers run behind the same fail-closed network guard as the E2E suite.

## 1. What the harness runs

| Piece | File | What it does |
| --- | --- | --- |
| Runner | `scripts/perf/run.mjs` | One command: checks the build, seeds, starts the stack, runs a scenario (1 discarded warm-up run + `--runs` measured runs per measurement), writes `perf-results/<timestamp>-<scenario>/result.json`, stops the stack |
| Stack | `scripts/perf/stack.mjs` | Mock Gemini, Express `node dist/index.js` (**NODE_ENV=production**), Next `next start` on the `.next-perf` build; logs to the run folder; kills process trees on exit |
| Config | `scripts/perf/config.mjs` | Ports (Next **3200**, Express **4200**, mock Gemini **4290**), the guarded DB `moleculestudio_perf_test`, every env variable both servers read (process env wins over `.env` files), random secrets per run (never written to disk) |
| Preload | `scripts/perf/preload.mjs` | Loaded into both servers: network guard (`scripts/test/network-guard.mjs`); Gemini **redirected to the mock** by rewriting the URL only, so the caller's `init` and abort signal are untouched (`lib/gemini-redirect.mjs`, PERF-21); `PERF_FORCE_GC_MS` forces GCs for PERF-21 checks only; Lemon checkout and Resend stubbed; optional instrumentation (below) |
| Mock Gemini | `scripts/perf/mock-gemini.mjs` | Gemini REST shape; latency `fixed` / `uniform` / `lognormal(median, p95)`; failure rate and mode `500`/`503`/`hang`/`empty`/`reset`; seeded RNG; reconfigured at runtime (`POST /__config`) |
| Seed | `scripts/perf/seed.mjs` | Recreates the DB with the production migration runner, then a deterministic dataset in SQL (below); checks `ledger_reconciliation()` is empty |
| Load driver | `scripts/perf/lib/load.mjs` | Dependency-free closed-loop HTTP driver: N virtual users on keep-alive sockets, warm-up discarded, latency to the end of the body |
| Scenarios | `scripts/perf/scenarios/*.mjs` | `smoke`, `balance`, `history`, `chat` (Part 0); `gemini-timeout` (PERF-21); Parts 1–3 add theirs here |
| Tests | `tests/api/perf-harness.test.ts` | Statistics, seeded randomness (lognormal hits its median/p95), argument parsing, the DB guard, mock failure modes |

Guards that stay in force: `scripts/test/db-guard.mjs` (the perf DB URL is built from `TEST_DATABASE_URL` and must
be local, named `*test*`, no `sslmode=require`, no hosted host) and `scripts/test/network-guard.mjs` (any
non-loopback request from either server throws unless stubbed). The only exception is `next build`, which may reach
`fonts.googleapis.com` / `fonts.gstatic.com` to self-host `next/font` files, exactly as the E2E production build does.
Docker: only the project's `postgres:18-alpine` test container (`npm run test:db:up`) is used.

### Seeded dataset (`node scripts/perf/seed.mjs [options]`)

| Option | Default | Meaning |
| --- | --- | --- |
| `--users` | 1000 | regular users (plus user 0, the "hot" user) |
| `--rows` | 200 | ledger rows per regular user |
| `--hot-rows` | 100 000 | ledger rows of the hot user (history at scale) |
| `--spacing-min` / `--hot-spacing-min` | 720 / 5 | minutes between a user's rows (controls the 24 h hold volume) |
| `--seed` | 1 | ids, emails, references derive from it (md5) |

Per user: one `ADMIN_ADJUSTMENT` of 1 000 000 credits (load never runs dry), `CREDIT_PURCHASE` +50 every 10th row,
`CREDIT_CONSUMPTION` −1 otherwise, and a captured `ai_credit_holds` row for every consumption of the last 48 h, as the
reservation flow leaves them. `user_balances` = SUM(ledger). Rows are inserted with explicit `created_at` (the ledger
function stamps `NOW()`); no trigger is disabled and nothing is updated or deleted. Default: 1 001 users, 300 000
ledger rows, ~1 300 holds in the last 24 h (under the production global cap of 3 000) in ~13 s. All users are verified
with password `PERF_PASSWORD` (bcrypt cost 10). `--spacing-min 72` gives ~10× the 24 h volume; `--hot-rows 1000000`
gives the 10× history. The hot user is over the per-user AI cap (≈ 260 holds in 24 h) and is used for read paths only.

Sessions are minted by the runner with the service's exact claim set (`scripts/perf/lib/tokens.mjs`) and the run's
`JWT_SECRET`; one `GET /api/auth/me` must answer 200 before anything is measured.

### Instrumentation (optional, per scenario)

* **Per-hop log** (`hopLog: true`): the Next process records each upstream fetch (`auth/me`, `billing/consume`,
  `gemini`, `billing/capture`, …) with its time to response headers. The runner joins it with each run's window, so
  `/api/chat` is broken down per hop. The Gemini hop includes the SDK's own work and the loopback call to the mock;
  "overhead excluding Gemini" = end-to-end − Gemini hop, which therefore slightly **under**-states overhead.
* **Process log** (`procLog: true`, default): both servers sample RSS, heap, event-loop utilisation and event-loop
  delay (p50/p99/max) every second. Only samples inside measured windows are summarised (startup excluded).
* Both write JSON lines buffered and appended once a second; the cost is measured once in Part 1 (run with and
  without) and reported.

## 2. Running it

```bash
npm run test:db:up                                     # project test container (PostgreSQL 18), if not running
node scripts/perf/run.mjs smoke --runs 1 --build       # first time: builds Express (tsc) and Next (.next-perf)
node scripts/perf/run.mjs balance                      # 5 runs × 20 s at c = 1, 10, 50 (defaults)
node scripts/perf/run.mjs history --seed-args "--hot-rows 1000000"
node scripts/perf/run.mjs chat --gemini lognormal:1500:4000 --concurrency 1,10,50
node scripts/perf/run.mjs chat --gemini fixed:200 --gemini-failure 0.1:hang
```

Options: `--runs N` (default 5), `--build`, `--allow-stale`, `--no-seed`, `--seed-args "…"`, `--concurrency a,b`,
`--duration s`, `--warmup s`, `--gemini fixed:MS|uniform:MIN:MAX|lognormal:MEDIAN:P95`, `--gemini-failure RATE:MODE`.

The build is fingerprinted (HEAD + a hash of uncommitted changes to anything that goes into either build). A run
refuses a build made from other sources (`--build` rebuilds; `--allow-stale` overrides and is recorded). Results
(`perf-results/`, `.next-perf/`) are gitignored.

**Every result records**: machine (CPU, cores, RAM, OS, Node, PostgreSQL version), build fingerprint, seed manifest,
options, env overrides, per-run summaries (n, p50/p90/p95/p99/max/mean, req/s, statuses, errors), the across-run
median with its spread (min, max, (max−min)/median), per-hop summaries, and process figures.

### Reading the numbers honestly

* **Reference machine:** AMD Ryzen 7 5700X (8 cores / 16 threads), 23.9 GiB RAM, Windows 10 Pro 19045, Node
  24.11.1, PostgreSQL 18.6 in Docker Desktop (loopback port). The load driver, both servers, the mock and the
  database share these 16 threads: at high concurrency they compete for CPU, which the process figures show.
* **Local is a lower bound for network cost.** Locally Next → Express and Express → PostgreSQL are loopback
  (sub-millisecond). In the planned hosting, every Next → Express call crosses the internet (Vercel → Render) and
  every query crosses Render → Neon. A chat turn makes **3** sequential Next → Express calls and **24**
  sequential DB round trips (`/auth/me` 3, `/consume` 10, `/capture` 11 — PERF-01); a balance read makes 1 and 3. Local numbers must be scaled by these
  counts × the real RTT, which is a staging measurement.
* **Closed loop:** a stalled virtual user stops sending, so tails are under-reported under stalls (coordinated
  omission). Parts 1–2 use it for cost per request; Part 3 adds an open-loop (fixed arrival rate) mode.
* Each figure is the **median of ≥ 5 runs** after a discarded warm-up run, reported with its spread. A difference
  smaller than the spread of either side is noise and is reported as such.

## 3. Measurement plan (for approval)

### 3.1 Scenarios

| Part | Scenario | Method | Main outputs |
| --- | --- | --- | --- |
| 1 | `chat` breakdown | c = 1, 10, 50; Gemini `fixed:0` (pure overhead) and `lognormal:1500:4000` (realistic) | end-to-end + per hop; overhead excl. Gemini; process figures |
| 1 | chat without instrumentation | same, `hopLog` off | instrumentation cost |
| 1 | hot-user contention | one user, c = 1…20 parallel turns (per-user caps raised for the test, recorded) | lock wait (`pg_locks` sampling), turns/s for one user |
| 1 | many users | c = 10…100 rotating users | reserve → capture throughput, pool usage |
| 1 | cap boundary | production caps; user at 199/200 and service at 2 999/3 000 | correct 429/503, cost of the refusal path |
| 1 | pool saturation | c > 20 (pool `max`) with slow queries injected (`pg_sleep` via a perf-only DB function on the perf DB) | queueing vs errors, `connectionTimeoutMillis` 2 s behaviour |
| 1 | DB slowness / cold start | latency or refused connections on first connect via a local TCP proxy in the harness | 503 mapping, retry, recommended timeouts |
| 1 | `balance`, `history` | c = 1, 10, 50; history at 100 k and 1 M rows (first, middle, last page) | budgets below |
| 1 | EXPLAIN | `EXPLAIN (ANALYZE, BUFFERS)` of every hot query at default and 10× data | plans, buffers; index proposals as migration 015+ only with before/after |
| 1 | login | c = 1, 4, 16 at bcrypt cost 10 | latency, event-loop lag (bcrypt runs on the libuv pool, 4 threads by default) |
| 1 | memory | 10-minute mixed run with `procLog` | heap trend after GC, limiter / revocation-cache / chat-bucket sizes |
| 2 | bundles | `next analyze --output --snapshot <name>` + `next analyze export` (built into Next 16.4; `next build` no longer prints sizes) | per-route client JS, largest modules, 3D/markdown/KaTeX/i18n on routes that do not need them |
| 2 | Core Web Vitals | 4 routes (`/`, `/explore`, `/periodic-table`, `/ai-lab`) × mobile (4× CPU, slow-4G-like) and desktop × logged-out/in × 5 runs | LCP, CLS (incl. theme flash and fonts), INP proxy, TTFB, JS transferred |
| 2 | 3D runtime | orbit script; 20 navigations in and out of 3D routes; 4× CPU | frame time, JS heap / WebGL context count after navigation (leak check) |
| 2 | React | `next build --profile` build, React Profiler on periodic table, dashboard, AI Lab long answers | re-render counts and commit times |
| 2 | caching | headers on `/_next/static`, `public/`, `/hdri/*`; TTFB per page | what may be cached without weakening the nonce CSP |
| 3 | mixed load / ramp | open-loop arrival rate: browse, sign-in, balance, checkout (mock Lemon), signed webhook burst, chat | breaking point, first bottleneck, error shape (clean 429/503 vs 5xx/hangs) |
| 3 | soak | 15 min mixed | memory, connections, handles, `hold_expired_unsettled` / CAPTURE_FAILED = 0, `db:reconcile` exit 0 |
| 3 | failure injection | Gemini timeouts/5xx, DB latency spikes, billing unavailable, under load | charges consistent afterwards (reconcile, no unsettled holds past TTL) |

### 3.2 Budgets (proposed; local, production build, reference machine)

| # | Budget | Proposed | Change vs your suggestion and why |
| --- | --- | --- | --- |
| B1 | `/api/chat` overhead excl. Gemini, p95 | **< 50 ms at c = 1; < 150 ms at c = 10**; c = 50 reported | Tightened at c = 1. Locally every hop is loopback; production adds 3 internet round trips (Vercel → Render) and 24 DB round trips (Render → Neon). A 150 ms local budget would leave nothing for that. A first harness check measured ~19 ms at c = 1 (1 run, not a baseline). |
| B2 | `/history` p95 at 100 k rows (one user) | **< 100 ms at c = 10**, any page; same budget at **1 M rows** (10×) | Kept, plus the 10× case and a shape rule: a deep page slower than 3× the first page means the plan is not index-driven. |
| B3 | balance p95 | **< 30 ms at c = 10** through the BFF | Kept; concurrency made explicit. |
| B4 | login p95 | **documented, not budgeted**: cost 10 (SEC-08 floor); target event-loop lag p99 < 20 ms at c = 16 (bcrypt must stay off the main thread) | The latency is bcrypt by design. The real risk is queueing on the 4-thread libuv pool, so that is what is measured. |
| B5 | LCP / CLS / INP (mobile profile) | **LCP < 2.5 s, CLS < 0.1, INP < 200 ms** on `/`, `/explore`, `/periodic-table`, `/ai-lab` | Kept (Google's "good" thresholds). Added: on 3D routes LCP ignores `<canvas>`, so a "first 3D frame" time is reported next to LCP. Lab INP is a proxy (scripted interactions), not field INP. |
| B6 | landing JS transferred | **document now; ceiling = measured baseline + 10 %** after Part 2 changes, checked by script | No absolute number can be justified before the first measurement. |
| B7 | event-loop lag p99 (both servers), c = 10 | **< 50 ms** | Added: the first chat check showed long event-loop stalls on Express (to be explained in Part 1). |
| B8 | overload error shape | **only 429 / 503 / 504** with `Retry-After` where applicable; no 500, no hang, no crash | Added for Part 3. |
| B9 | webhook acknowledgement p95 | **< 50 ms** (it answers before any DB work) | Added; a slow ack makes Lemon retry. |

### 3.3 Tools

| Need | Proposal | New dependency? |
| --- | --- | --- |
| HTTP load (Parts 1, 3) | The in-repo driver (`scripts/perf/lib/load.mjs`); Part 3 adds an open-loop mode to it | **No** |
| Cross-check of the driver | `autocannon` as a dev dependency (npm package, no container), only if you want an independent tool to confirm the in-repo numbers | Yes, **ask first** (optional) |
| k6 | Not needed | — |
| DB analysis | `EXPLAIN (ANALYZE, BUFFERS)` and `pg_locks` / `pg_stat_activity` sampling through `pg`. `pg_stat_statements` is not used: it needs `shared_preload_libraries`, a change to the test container's settings | No |
| Bundles | `next analyze --output` / `next analyze export` (built in) | No |
| Core Web Vitals | **Primary:** Playwright (already installed) with CDP CPU/network throttling and in-page `PerformanceObserver` (LCP, CLS, Event Timing for INP). Logged-in flows are easy and nothing new is installed. **Optional:** Lighthouse CLI (`lighthouse` dev dependency, run against Playwright's Chromium) for standard scoring | Lighthouse: yes, **ask first** |
| React profiling | `next build --profile` (a separate profiling build) + React Profiler | No |
| Memory / leaks | Process sampling in the preload (done); heap snapshots through a perf-only trigger in the preload | No |

## 4. Harness validation (Part 0) — not baselines

These runs only prove the harness works end to end. They are single short runs (except where noted), so they carry no
spread and are **not** baselines. Part 1 measures properly.

| Check | Result |
| --- | --- |
| `smoke` (1 run; page, BFF balance, chat turn) | all 2xx; chat hops p50: `auth/me` 3.0 ms, `consume` 8.9 ms, Gemini forward 3.8 ms, `capture` 8.7 ms |
| `balance` (2 runs × 4 s) | BFF p95 3.4 ms (c = 1), 11.6 ms (c = 10); Express direct p95 2.2 / 4.4 ms |
| `history` (1 run × 3 s, c = 1) | hot user (100 k rows, 1 000 pages): page 1 / 501 / 1 000 p95 4.6 / 3.9 / 4.0 ms |
| `chat`, Gemini `fixed:0` (1 run × 4 s) | p95 31.9 ms (c = 1), 39.1 ms (c = 10), 158.9 ms (c = 50, ~300 turns/s); Next heap reached 610 MiB and its event loop was saturated at c = 50; Express event-loop lag p99 reached 615 ms |
| Seed | default dataset in 12.6 s; 5 000-user chat dataset in 13.7 s; reconciliation clean |
| `tests/api/perf-harness.test.ts` | 14 tests pass |

Problems found and fixed while building the harness: the mock never answered (an `IncomingMessage` is "destroyed"
once its body is read, so the client-gone check fired on every request; it now checks the socket); `next build`
rewrote `tsconfig.json` to add `.next-perf` include paths (the two lines are now committed, like `.next-e2e`'s); and
the build inlined `NEXT_PUBLIC_*` values from a developer's `.env` (now set explicitly).
