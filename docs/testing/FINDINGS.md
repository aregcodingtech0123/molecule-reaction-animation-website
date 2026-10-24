# Findings — Phase 1 (Functional)

Every finding below that can be expressed as a test has one, written as the **expected** behaviour
and marked `it.fails(...)` with its `FINDING-xx` id. Fixing the bug turns that test red ("expected
to fail but passed"), at which point the `.fails` marker is removed. Search the repo for the id to
find the test(s).

Severity: **Critical** = money or data loss reachable by a normal user; **High** = broken core flow
or production data at risk; **Medium** = incorrect behaviour with a workaround or limited blast
radius; **Low** = edge-case / error-mapping; **Info** = cosmetic.

| ID | Sev | Area | Title |
| --- | --- | --- | --- |
| 03 | Critical | Billing / BFF | Any user can refund successful AI operations → unlimited free AI |
| 01 | Critical | DB | `db:setup` / `db:reset` never apply migrations 006–007 → AI metering fails on a fresh DB |
| 02 | High | DB | Migrations are not re-runnable (001 fails after 003) |
| 04 | High | BFF / Auth | Client IP not forwarded → rate limits are site-wide buckets |
| 31 | High | 3D / AI Lab | 3D pages throw — and the AI Lab crashes entirely — if the third-party HDR CDN is unreachable |
| 29 | High | Tooling | `db:reset` guard refuses only Supabase — a Neon URL is dropped |
| 07 | Medium | Billing | `/deduct` double-charges under concurrency; users can write ADMIN_ADJUSTMENT rows |
| 22 | Medium | Chat | Refund after a failed generation is a single best-effort call (no retry) |
| 23 | Medium | BFF / Webhook | BFF proxies the webhook path but strips `X-Signature` |
| 24 | Medium | Auth | JWT returned in JSON bodies (readable by page JS) despite httpOnly cookie |
| 06 | Medium | Auth / Profile | Date of birth shifts one day earlier on servers east of UTC (and drifts on each save) |
| 09 | Medium | Auth | Registration reveals whether an email already has an account |
| 18 | Medium | Auth | Password reset does not revoke existing sessions |
| 27 | Medium | i18n | 83 UI strings (auth, credits, pricing…) are English-only in all 11 other locales |
| 05 | Medium | DB | Ledger can be `TRUNCATE`d; `user_balances` can drift from the ledger |
| 10 | Low | Webhook | A malformed `pending_order_id` makes the whole fulfilment fail |
| 11 | Low | Webhook | Losing concurrent duplicate delivery is logged as `[Webhook] FAILED` |
| 12 | Low | API | Body-parser errors (oversized / malformed JSON) return 500 |
| 08 | Low | Billing | `/history?limit=abc` (or `2.7`) → 500 |
| 15 | Low | Billing | Failed checkouts leave orphan `pending` orders, never expired |
| 16 | Low | Billing | `packageId: "__proto__"` / `"constructor"` → 500 instead of 400 |
| 19 | Low | Auth | Google sign-in misconfiguration reported as 401 "invalid token" |
| 20 | Low | API | Any unhandled unique violation is answered `200 {success:true, "account created"}` |
| 21 | Low | Chat | Gemini call has no timeout / abort signal |
| 25 | Low | Chat | Billing unreachable → unhandled exception (500) instead of `503 BILLING_UNAVAILABLE` |
| 13 | Low | Webhook | Production Lemon variant IDs hard-coded as a fallback mapping |
| 17 | Low | Billing | No pagination: ledger rows beyond the newest 200 are unreachable |
| 26 | Low | Theme | No pre-hydration theme script → White Lab users see a Night Lab flash |
| 14 | Info | Webhook | Valid signature + invalid JSON → 400 with body "Invalid signature" |
| 32 | Info | Auth UI | `/verify-email` submits the token repeatedly (later calls 400) |
| 28 | Info | Dashboard | Unknown ledger types render as `SOME NEW TYPE` instead of Title Case |
| 30 | Info | Repo | Hygiene: committed `node_modules`/`dist`, outdated README, deprecated `middleware.ts` |

---

## FINDING-03 — Critical — Any user can refund successful AI operations

* **Where:** `services/auth-billing-service/src/routes/billing.routes.ts` (`POST /refund` behind
  `requireAuth`), exposed to browsers by the BFF catch-all `src/app/api/billing/[...path]/route.ts`;
  `GET /history` returns each charge's `reference_id`.
* **Reproduce:** sign in with 1 credit → send one AI Lab message (balance 0) →
  `GET /api/billing/history` → take the `CREDIT_CONSUMPTION` row's `reference_id` →
  `POST /api/billing/refund {referenceId}` → balance is 1 again. Repeat forever.
* **Expected:** a charge for an operation that completed stays charged; refunds are issued only by
  the server that ran the operation.
* **Actual:** 200 `{refunded:true}`; credit restored.
* **Tests:** `tests/api/chat.route.test.ts` ("FINDING-03 end-to-end", characterisation + `it.fails`),
  service `tests/api/billing.ledger-api.test.ts`.
* **Fix:** make `/consume`, `/refund` (and `/deduct`) internal-only — reject requests that did not
  come from the BFF (shared service secret header, or a separate internal router bound to a private
  interface) and block `/api/billing/{consume,refund,deduct}` in the gateway. Optionally store the
  refundable state server-side (e.g. charge row → `pending` until `/api/chat` confirms success).

## FINDING-01 — Critical — `db:setup` never applies migrations 006–007

* **Where:** `services/auth-billing-service/scripts/setup-db.mjs` hard-codes `001 → 005`
  (`reset-db.mjs` delegates to it; README says the same).
* **Reproduce:** fresh DB → `npm run db:setup` → sign in, verify, use the AI Lab.
* **Expected:** every file in `database/init` is applied; AI usage is charged.
* **Actual:** `credit_transaction_type` lacks `CREDIT_CONSUMPTION`/`CREDIT_REFUND`;
  `post_credit_transaction(..., 'CREDIT_CONSUMPTION')` raises `22P02`, `/consume` returns 500,
  `/api/chat` answers 503 `BILLING_UNAVAILABLE` for every turn. The idempotency index from 007 is
  also missing.
* **Tests:** `tests/db/migrations.test.ts` (`it.fails` "applies every migration file…" and the impact
  test).
* **Fix:** apply `fs.readdirSync(database/init).filter(/^\d{3}_.*\.sql$/).sort()`; better, adopt a
  migration runner with a `schema_migrations` table (see FINDING-02).

## FINDING-02 — High — Migrations are not re-runnable

* **Where:** `database/init/001_moleculestudio_core.sql` — `CREATE OR REPLACE FUNCTION
  post_credit_transaction(4 args)` then `COMMENT ON FUNCTION post_credit_transaction IS …` (no arg list).
* **Reproduce:** apply 001→007, then apply 001 again (what `db:setup` does on every run).
* **Expected:** idempotent, as every file header claims.
* **Actual:** after 003, 001 re-creates the 4-arg overload; the unqualified `COMMENT ON FUNCTION`
  fails with `42725 function name "post_credit_transaction" is not unique`; `db:setup` aborts at 001
  so nothing after it runs. The failure is atomic (verified: schema unchanged). This also means
  that once FINDING-01's script is fixed, re-running `db:setup` on an existing database **still**
  cannot apply 006/007.
* **Tests:** `tests/db/migrations.test.ts` (`it.fails` idempotency; root-cause test).
* **Fix:** qualify the comment with the signature, and stop re-creating the legacy overload in 001
  (or guard it with `IF NOT EXISTS (SELECT … FROM pg_proc …)`); track applied migrations.

## FINDING-04 — High — Rate limits are global behind the BFF

* **Where:** `src/lib/gateway/headers.ts` forwards an allow-list that excludes `X-Forwarded-For`;
  Express keys every limiter on `req.ip` (`app.set("trust proxy", 1)`).
* **Reproduce:** four different people sign up through the website within an hour.
* **Expected:** limits apply per end-user IP.
* **Actual:** all traffic arrives from the Next server's address: the 4th sign-up **site-wide** gets
  429; likewise verify/reset (20/h), Google sign-in (10/15 min) and resend/forgot (5/h). Login is
  keyed on IP+email so it degrades to per-email. `users.signup_ip` records the Next server for everyone.
* **Tests:** `tests/api/gateway.rate-limit.test.ts` (characterisation), `gateway.rate-limit-requirement.test.ts` (`it.fails`).
* **Fix:** in the gateway set `X-Forwarded-For` from the platform's trusted client-IP source
  (e.g. `request.headers.get("x-forwarded-for")` as received by Next on Vercel, or `x-real-ip`),
  and set Express `trust proxy` to exactly the BFF hop.

## FINDING-29 — High — `db:reset` would drop a Neon (or any non-Supabase hosted) database

* **Where:** `services/auth-billing-service/scripts/reset-db.mjs` guard
  `/supabase\.co/i.test(databaseUrl) || NODE_ENV === "production"`.
* **Expected:** refuse anything that is not local (README lists Neon as a production target).
* **Actual:** a Neon URL in `.env` passes the guard; the script terminates connections and runs
  `DROP DATABASE`.
* **Tests:** `services/auth-billing-service/tests/unit/db-scripts.test.ts` (`it.fails` for Neon and
  `sslmode=require`).
* **Fix:** reuse `scripts/test/db-guard.mjs` logic: allow only localhost/127.0.0.1/docker host names.

## FINDING-07 — Medium — `/deduct` double-charges under concurrency

* **Where:** `billing.service.ts#deductCreditsForUser` (check-then-insert; no unique index for
  `AI_GENERATION_DEDUCTION`/`ADMIN_ADJUSTMENT`/`REFUND`).
* **Reproduce:** N concurrent `POST /deduct` with the same `referenceId`.
* **Expected:** one deduction. **Actual:** N deductions (deterministic race test). Also any user can
  write `ADMIN_ADJUSTMENT`/`REFUND`-typed rows into their own ledger, polluting the audit trail.
* **Tests:** service `tests/api/billing.ledger-api.test.ts`.
* **Fix:** retire `/deduct` (superseded by `/consume`) or extend the 007 partial unique index to its
  types and catch `23505`; never let clients choose the transaction type.

## FINDING-22 — Medium — Refund after a failed generation is best-effort only

* **Where:** `src/app/api/chat/route.ts` → `refundOperationCredits` (single call, errors swallowed).
* **Reproduce:** Gemini fails while billing's `/refund` returns 503 once.
* **Expected:** the user is eventually not charged. **Actual:** charged; only a console line remains.
* **Test:** `tests/api/chat.route.test.ts` (`it.fails`, flaky-billing proxy).
* **Fix:** retry with backoff, and/or record a refund-owed row (outbox) processed by a job; or charge
  after a successful generation using a reservation (hold → capture/release).

## FINDING-23 — Medium — Webhook through the Next host can never succeed

* **Where:** BFF catch-all forwards `/api/billing/webhooks/lemonsqueezy` but not `X-Signature`.
  `services/auth-billing-service/.env.example` says to configure
  `https://YOUR_PUBLIC_HOST/api/billing/webhooks/lemonsqueezy` (the README says Express only).
* **Actual:** a correctly signed delivery to the Next host becomes 401 at Express; no credits.
* **Test:** `tests/api/gateway.test.ts` (`it.fails`).
* **Fix:** have the gateway return 404 for `webhooks/*` (fail loudly) or forward `X-Signature` + raw
  body; align `.env.example` with the README.

## FINDING-24 — Medium — JWT exposed to page JavaScript

* **Where:** `/login`, `/register`, `/google`, `/verify-email` responses include `data.token`; the
  browser posts it to `/api/auth/set-cookie`.
* **Impact:** any XSS can read the session token from the response, defeating `httpOnly`.
* **Test:** `tests/api/gateway.test.ts` (`it.fails`). The positive half — never in Local/Session
  Storage — is verified in `tests/unit/auth/AuthContext.test.tsx` and E2E.
* **Fix:** set the cookie in the BFF route for these endpoints and strip `token` from the body.

## FINDING-06 — Medium — Date of birth is off by one day east of UTC

* **Where:** `utils/profile.ts#formatDateOfBirth` uses `Date#toISOString()` on a `pg`-parsed `DATE`
  (local midnight).
* **Reproduce:** run the service with `TZ=Europe/Istanbul` (this developer machine) → register with
  `1990-12-10` → response says `1990-12-09`. The profile form re-submits it, shifting it again on every save.
* **Test:** service `tests/api/auth.password.test.ts` (UTC/New York pass; Tokyo `it.fails`). Suites
  pin `TZ=UTC` for determinism.
* **Fix:** `pg.types.setTypeParser(1082, (v) => v)` or select `date_of_birth::text`.

## FINDING-09 — Medium — Registration enumerates accounts

New email → `201` + token + user; existing email → `200` + message. Test: `auth.password.test.ts`.
Fix: same status/shape for both (e.g. always 202 + "check your inbox", sign-in after verification).

## FINDING-18 — Medium — Password reset leaves old sessions valid

JWTs issued before a reset keep working until expiry (7 days by default). Test:
`auth.password.test.ts`. Fix: store `password_changed_at`/`token_version` and reject older `iat`.

## FINDING-27 — Medium — 83 UI keys are English-only in 11 locales

`getDictionary(locale)` has 285 keys for `en` and 202 for every other locale. The missing keys
(auth modal, credits chip, pricing/billing, toasts…) come from the English-only `EXTENSIONS.en`,
and components fall back to the inline English default. Locale JSON files themselves are in full
parity (same 414 keys, placeholders preserved). Test: `tests/unit/i18n/i18n.test.tsx`.

## FINDING-05 — Medium — Ledger immutability gaps

Row triggers block UPDATE/DELETE (verified) but not `TRUNCATE`; `user_balances` (the projection)
is freely updatable, so the cache can diverge from `SUM(ledger)`. Tests:
`tests/db/immutability-and-constraints.test.ts`. Fix: `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger;
revoke `TRUNCATE`/`UPDATE` from the app role on these tables (writes only via the SECURITY DEFINER
function); a periodic reconciliation check.

## FINDING-31 — High — 3D pages (and the paid AI Lab) depend on a third-party CDN at runtime

* **Where:** `src/components/canvas/SceneStage.tsx` — `<Environment preset={…}>` (drei) downloads
  `potsdamer_platz_1k.hdr` (and the studio/warehouse presets) from drei's asset CDN in the browser.
* **Reproduce:** load `/`, `/explore` or `/atom-models` with that host unreachable (CDN outage,
  offline classroom, strict CSP / corporate proxy) — E2E blocks all non-app hosts.
* **Expected:** the scene renders without the environment map (or with a bundled one).
* **Actual:** uncaught `Error: Could not load potsdamer_platz_1k.hdr: Failed to fetch`
  (`https://raw.githack.com/pmndrs/drei-assets/…`) on every 3D page; on `/ai-lab` the error escapes
  the canvas and Next renders "This page couldn't load" — the paid feature is unusable (observed in
  the authenticated E2E trace before the test started serving a local HDR stand-in).
* **Tests:** `tests/e2e/guest.spec.mts` (`test.fail` ×3).
* **Fix:** self-host the HDR files under `public/` and pass `files=` instead of `preset=`, and wrap the
  environment in an error boundary / `<Suspense>` fallback.

## Low / Info (one line each — see the referenced tests for exact repro)

* **10** — `custom_data.pending_order_id` that is not a UUID makes the `UPDATE` throw `22P02`, so the
  whole transaction (credit included) rolls back and is logged FAILED. Only API-created checkouts set
  it, so it bites raw/edited links. Fix: validate the UUID and ignore it if malformed. (`webhook.fulfilment.test.ts`)
* **11** — concurrent duplicate deliveries: correct single credit, but the loser throws `23505` and is
  logged "FAILED … replay manually". Fix: catch `23505` in `fulfillVerifiedPurchase` → `already_processed`.
* **12** — `errorHandler` ignores body-parser `status`: oversized body → 500 (should be 413), malformed
  JSON → 500 (should be 400). Fix: honour `err.status`/`err.type` for `entity.*` errors.
* **08** — `/history?limit=abc|2.7|NaN` → 500 (NaN/fraction reaches `LIMIT`). Fix: `Number.parseInt`
  + `Number.isFinite` fallback to 100.
* **15** — pending order inserted before the Lemon call; every failure leaves a `pending` row; nothing
  expires them (`expired` status unused). Fix: insert after success or mark `failed`; TTL job.
* **16** — `resolveCreditPackage` uses `CREDIT_PACKAGES[id]` on a plain object: `__proto__`,
  `constructor`, `toString` resolve → later 500. Fix: `Object.hasOwn`. (Webhook path is safe: the amount check rejects.)
* **19** — `getGoogleClient()` 503 is thrown inside a `try` that maps everything to 401 `GOOGLE_TOKEN_INVALID`.
* **20** — `errorHandler` maps every `23505` to `200 {success:true, data:{message:"…account has been created"}}`.
* **21** — `generateContent` has no `abortSignal`/timeout; a hung model call holds a charged turn open.
* **25** — `consumeCreditsForOperation` doesn't catch `fetch` rejections; route throws → generic 500.
* **13** — `packageIdForLemonVariant` (and `checkout-intent.ts`) fall back to hard-coded production
  variant IDs regardless of environment. Fix: env-only mapping; fail closed.
* **17** — `/history` has no offset/cursor; max 200 rows. Add cursor pagination (`created_at,id`).
* **26** — `layout.tsx` hard-codes `dark`/`night-lab`; ThemeProvider applies the stored theme only after
  hydration → visible flash for White Lab users. Fix: tiny inline script in `<head>` reading
  `moleculestudio-theme` before paint.
* **14** — valid signature + unparsable JSON returns 400 with `{"error":"Invalid signature"}`.
* **32** — `/verify-email` posts the token more than once (3 requests observed in the E2E trace, the
  later ones 400 "invalid or expired"); the UI showed success, but a late 400 overwriting the success
  state is a latent race. Guard the effect with a ref / AbortController.
* **28** — `formatTransactionType` fallback upper-cases first letters only (`SOME NEW TYPE`).
* **30** — Repo hygiene / README drift: `services/auth-billing-service/node_modules` (≈1.7k files) and
  `dist/` are committed (`.gitignore` only ignored root `/node_modules`; now `node_modules/` is ignored
  for new files — run `git rm -r --cached services/auth-billing-service/node_modules services/auth-billing-service/dist`);
  README says migrations `001→005`; legacy `services/auth-service`, `services/billing-service`
  (Prisma/Stripe) and `services/ai-engine` are not wired in; empty `src/app/api/ai/[...path]` directories
  remain (no route — verified 404); `src/middleware.ts` uses the convention Next 16 deprecated in favour
  of `proxy.ts` (still works; verified by E2E); `index.ts` rejects any `JWT_SECRET` that merely
  *contains* `"secret"` (substring match), which can reject strong generated keys.

---

## Source changes made for testability

**None.** No production file under `src/`, `services/*/src`, `database/` or `services/*/scripts` was
modified. All isolation is done from test code (dotenv aliased to a stub, prototype-level spies on
`pg`, a fetch guard, Playwright `webServer` env + `--import` preload).

Non-production files added/changed: `.gitignore` (test artefacts, `.env.test`, nested
`node_modules/`), root and service `package.json` (devDependencies + scripts),
`vitest.config.mts`, `services/auth-billing-service/vitest.config.ts`, `playwright.config.mts`,
`docker-compose.test.yml`, `.env.test.example`, `.github/workflows/test.yml`, `scripts/test/*`.

## Out-of-scope observations (for Phase 2 — not tested further)

* **Security:** pre-account-takeover — an attacker can register a victim's email (unverified) before
  the victim first uses Google; Google sign-in then links to and verifies the attacker-created account,
  whose password the attacker knows. Gateway `..` path segments escape the service prefix (all
  services share one Express, so impact is limited). `clear-cookie` has no origin check (logout CSRF).
  With Express exposed publicly for webhooks (as the README requires), `trust proxy 1` lets any client
  spoof `X-Forwarded-For` and bypass Express rate limits. Output "content policy" is a 4-regex
  heuristic. Dev mailer logs raw verification/reset links whenever `RESEND_API_KEY` is unset and
  `NODE_ENV !== "production"` (e.g. a staging env).
* **Performance:** `/api/chat` makes three sequential service round-trips (`/me`, `/consume`,
  Gemini) before answering; in-memory chat rate limiting is per-instance; the balance auto-refresh
  polls every few seconds while signed in.
* **Testing tooling:** Docker was not running on the authoring machine; local DB suites ran against a
  throwaway PostgreSQL 18 cluster (`initdb`, trust auth, port 55432). CI uses `postgres:16-alpine`.

---

## Coverage report (measured on the final run)

| Suite | Files | Result | Line coverage (target) |
| --- | --- | --- | --- |
| Service `db` (real Postgres) | 4 | 59 pass · 3 expected-fail | SQL — every function/trigger/constraint exercised |
| Service `api` (Supertest + real Postgres) | 6 | 207 pass · 16 expected-fail | — |
| Service `unit` | 2 | 34 pass · 4 expected-fail | — |
| **Service total** | 12 | **300 pass · 23 expected-fail** | **85.3 %** lines, 85.1 % statements, 90.3 % functions, 69.9 % branches (≥ 85 % ✔) |
| Root `api` (BFF + `/api/chat`, real Express + Postgres) | 5 | 70 pass · 7 expected-fail | BFF files **87.3 %** (≥ 85 % ✔) |
| Root `unit` (jsdom) | 8 | 176 pass · 13 expected-fail | tested frontend modules **79.5 %** (≥ 70 % ✔); whole `src/` include-set 46 % (3D/canvas components intentionally smoke-only) |
| E2E (Playwright, Chromium + Pixel 7) | 2 | **20 / 20 green** (17 pass · 3 `test.fail` for FINDING-31), stable over 2 consecutive runs, ~55 s warm | paid journey on desktop **and** mobile; 15 guest/gating checks |

"Expected-fail" = an `it.fails` / `test.fail` for a finding above; it is green in CI and flips red
when the bug is fixed. No test is skipped.

## Testing gaps & recommendations for Phase 2 (Performance / Security)

**Not covered in Phase 1 (by design or by limit):**
* Real third-party contracts — Lemon Squeezy, Gemini, Google, Resend are stubbed. Add a nightly
  contract job against Lemon's **test mode** store and a Gemini sandbox key.
* Rendering correctness of the Three.js scenes (smoke-mounted only) — consider visual-regression
  snapshots (Playwright `toHaveScreenshot`) with a fixed GPU/SwiftShader profile.
* `services/ai-engine` (Python) and the legacy Prisma services — not wired into the stack.
* Email content (verification/reset/receipt HTML) beyond "a link with a token is sent".
* Multi-instance behaviour (in-process JWT revocation cache, in-memory chat limiter, Upstash path).

**Phase 2 — Security (start here):** FINDING-03 (self-refund), -04/-29 operational guards, -24 (JWT in
bodies), -09 (enumeration), -18 (session revocation on reset), pre-account takeover via Google linking,
`X-Forwarded-For` spoofing on the publicly exposed Express service, gateway `..` traversal, logout CSRF,
webhook replay window (no timestamp/event-id check beyond order-id idempotency), CSP/headers lost
through the BFF (helmet headers are not forwarded), dependency audit (`npm audit` reports issues in both
packages).

**Phase 2 — Performance:** `/api/chat` latency budget (3 sequential hops + model) and Gemini timeout
(FINDING-21); advisory-lock contention for a single hot user; `/history` query plan at 10⁶ rows
(index `idx_credit_ledger_user_created` exists); Neon cold-start vs. the 2 s pool connect timeout;
3D bundle size / first-load on mobile tier; balance polling frequency × concurrent users.
