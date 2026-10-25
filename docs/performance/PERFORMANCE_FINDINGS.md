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
| PERF-01 | `/api/chat` | Sequential round trips before answering | Confirmed and larger than the brief says. Order: local JWT verify → `GET /auth/me` → Upstash (if set) and in-memory limit → body read → `POST /consume` → Gemini → `POST /capture`. Each Express call re-runs `requireAuth` (2 queries: `jti`, `token_version`); `/consume` and `/capture` also `requireVerified` (1). DB round trips per successful turn: `/auth/me` 3 + `/consume` 10 (7 in its transaction) + `/capture` 11 (8) = **24**, all sequential. `/auth/me` serves only the verified-email gate, which `/consume` enforces again (403 `EMAIL_NOT_VERIFIED`, already mapped by the route) — candidate to drop one hop in Part 1, keeping the 403 behaviour and its tests. | verified-code | Part 1 |
| PERF-02 | `/api/chat` | Gemini latency / `GEMINI_TIMEOUT_MS` vs hold TTL | Default timeout 30 s, TTL 600 s; `check:config` already enforces TTL ≥ 2 × (timeout + retries + capture attempts × call timeout) = 148.5 s with defaults. No correctness gap. Capacity side: each in-flight turn holds a Next request (and its memory) for up to 30 s — part of Part 3 sizing. | verified-code | Parts 1, 3 |
| PERF-03 | `/api/chat` | — (found in Part 0) | `fetchEmailVerificationStatus` (`GET /auth/me`) has **no timeout**, unlike the billing calls (`BILLING_CALL_TIMEOUT_MS`, SEC-17). A stalled Express holds the chat request until undici's default 300 s headers timeout. Robustness more than speed; would disappear with PERF-01's change. | verified-code | Part 1 |
| PERF-04 | Ledger / holds | Advisory-lock contention for one hot user | `reserve`, `capture`, `release` each take `pg_advisory_xact_lock(hashtext(user_id))`; `post_credit_transaction` takes the same lock inside `capture` (re-entrant). One user's turns are fully serialised through those transactions; different users only share the pool. The global daily-cap count is deliberately not serialised (SEC-16). | verified-code | Part 1 |
| PERF-05 | `/history` | Query plan and cursor pages at large row counts | Index `idx_credit_ledger_user_created (user_id, created_at DESC)`; the query orders by `created_at DESC, id DESC` with a row comparison `(created_at, id) < (…)`, so `id` is not in the index (ties need a sort). Harness check: flat ~4 ms from page 1 to page 1 000 at 100 k rows (1 run). EXPLAIN at 100 k and 1 M rows decides whether anything is needed. | verified-code | Part 1 |
| PERF-06 | Dashboard | Balance polling frequency × users | **Refuted as stated.** There is no steady polling. `useBalanceAutoRefresh` refreshes once on window focus / visibility, and polls every 3 s for at most 30 s (≤ 10 requests) only after a return from checkout, stopping as soon as credits arrive. The poll does not pause while the tab is hidden (bounded at 30 s). Requests per tab per minute will be counted in Part 2. | refuted | Part 2 (count) |
| PERF-07 | Bundle (3D) | 3D bundle size / first load on mobile | No `next/dynamic` or `React.lazy` anywhere in `src/`. `FocusProvider` — mounted in the root providers on **every** page — imports `three`; the landing page imports the 3D `Scene` directly. `three` is therefore very likely in every route's client JS. To confirm with `next analyze`. | verified-code | Part 2 |
| PERF-08 | Bundle (AI chat) | — (found in Part 0) | `LabAssistantChat` is mounted globally (root providers) and statically imports `AiChatPanel` → `ChatMessageContent` → `react-markdown`, `remark-math`, `rehype-katex`, `rehype-sanitize`. `katex.min.css` (and its fonts) is imported in `globals.css`. The markdown/KaTeX stack is likely on every page. | verified-code | Part 2 |
| PERF-09 | Bundle (i18n) | Do all 12 locales ship to every user? | `src/lib/i18n/content/index.ts` statically imports all 12 locale JSON files (the i18n folder is ~505 KB of source). Very likely all locales ship. | verified-code | Part 2 |
| PERF-10 | CLS | Theme flash on 48 components (FINDING-26 partial) | A pre-hydration script applies the stored theme before first paint (FINDING-26). `<body>` has `transition-colors duration-500`, so components whose classes change at hydration animate for 500 ms. Colour changes are not layout shift; whether any of them shift layout is a measurement question. | verified-code | Part 2 |
| PERF-11 | Caching | Nonce CSP makes every route dynamic | Confirmed: the root layout reads `headers()` for the nonce; the build prerenders only `/_global-error` and `/favicon.ico`. Every HTML response is rendered per request. The proxy matcher excludes `api/`, `_next/static`, `_next/image`, `favicon.ico` and `hdri/`, so static assets keep their own caching. | verified-code | Part 2 (TTFB) |
| PERF-12 | Assets | Environment maps | `public/hdri`: two 1k `.hdr` maps, 3.1 MB together. Cache headers on `public/` (and on Vercel) to be checked. | verified-code | Part 2 |
| PERF-13 | DB connect | Neon cold start vs pool connect timeout | Pool `max` 20, `idleTimeoutMillis` 30 s, `connectionTimeoutMillis` 2 s. `requireDatabase` answers 503 `DATABASE_UNAVAILABLE` while the DB is not ready. Neon documents a wake-up of a few hundred ms (checklist), which is under 2 s; slower networks or retries are to be simulated. | verified-code | Part 1 |
| PERF-14 | Memory | In-memory limiters | Express: `express-rate-limit` memory stores on auth routes only (5 limiters). BFF chat: an in-memory `Map` per user that **never deletes expired buckets** — one entry per user ever seen until restart (small, but unbounded). Revoked-JTI cache: purged every 256 checks. Sizes to be measured over a soak. | verified-code | Parts 1, 3 |
| PERF-15 | Express | Body parsing and compression | `express.json` 32 kB; webhook `express.raw` 256 kB (HMAC needs raw bytes). No compression on Express (small JSON, mostly BFF-to-service). `next start` compresses by default; Vercel compresses at its edge. Expect no action; response sizes will be recorded. | verified-code | Part 1 |
| PERF-16 | Daily caps | Migration 014 queries | One query with three sub-selects per reservation, inside the user's lock: the user's 24 h count, the user's oldest turn, and the **global** 24 h count over `idx_ai_credit_holds_created`. The global count's cost grows with the 24 h volume (bounded by the cap, 3 000 by default). EXPLAIN at default and 10× volume. | verified-code | Part 1 |
| PERF-17 | Reconcile / refunds | Reconcile and refund queries | `ledger_reconciliation()` aggregates the whole ledger (daily job). `refunded_orders_to_review()` joins refunds to credits. Timed at 300 k and 3 M ledger rows. | verified-code | Part 1 |
| PERF-18 | Express | — (found in Part 0) | Every capture logs with `console.log`. Depending on the stream type (file, pipe, TTY) Node writes stdout synchronously, i.e. on the event loop. The first chat check showed Express event-loop lag p99 up to 615 ms at c = 50. Cause not yet known; logging is one candidate among GC and `pg` parsing. | lead | Part 1 |
| PERF-19 | Next memory | — (found in Part 0) | In the first chat check the Next process heap reached 610 MiB (RSS 772 MiB) at c = 50 and its event loop was saturated. Growth vs lazy GC to be told apart by a 10-minute run. | lead | Parts 1, 3 |
| PERF-20 | Login | bcrypt cost and event-loop blocking | `bcrypt` (native), cost 10 by default (production allows 10–15). Hashing runs on the libuv pool (4 threads by default), not on the event loop, so concurrent logins queue on 4 threads and share them with other pool work. | verified-code | Part 1 |
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

## Findings log

| ID | Area | Baseline | After | Method | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | Part 0 builds the harness only; nothing is optimised | — | — |
| PERF-21 | harness | first turn after start hung ~306 s (1 of 3 runs); every turn under forced GC | 504 at 30.0–30.3 s on every turn, with and without forced GC | reproduction table above | see git log | refuted (harness defect, fixed) |
