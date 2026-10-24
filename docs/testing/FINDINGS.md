# Findings — Phase 1 (Functional) · remediated in Phase 1.5

Every finding below that can be expressed as a test has one, written as the **expected** behaviour
and marked `it.fails(...)` with its `FINDING-xx` id. Fixing the bug turns that test red ("expected
to fail but passed"), at which point the `.fails` marker is removed. Search the repo for the id to
find the test(s).

Severity: **Critical** = money or data loss reachable by a normal user; **High** = broken core flow
or production data at risk; **Medium** = incorrect behaviour with a workaround or limited blast
radius; **Low** = edge-case / error-mapping; **Info** = cosmetic.

| ID | Sev | Area | Title | Status |
| --- | --- | --- | --- | --- |
| 03 | Critical | Billing / BFF | Any user can refund successful AI operations → unlimited free AI | **Fixed** `fba88e7` — metering endpoints internal-only (key + BFF 404); reserve/capture/release; a captured charge is never refundable |
| 01 | Critical | DB | `db:setup` / `db:reset` never apply migrations 006–007 → AI metering fails on a fresh DB | **Fixed** `030a484` — tracked migration runner applies every file in `database/init` |
| 02 | High | DB | Migrations are not re-runnable (001 fails after 003) | **Fixed** `030a484` — 001 creates the legacy overload only on an empty DB; 001–007 each re-runnable (tested) |
| 34 | High | Auth / OAuth | Google sign-in links to and verifies an UNVERIFIED password account → pre-account takeover (found in Phase 1.5) | **Fixed** `ce43380` — Google user takes the account over: password invalidated, sessions revoked, pending tokens deleted |
| 04 | High | BFF / Auth | Client IP not forwarded → rate limits are site-wide buckets | **Fixed** `ce43380` `0b4a13c` — BFF forwards the platform client IP (`CLIENT_IP_HEADER`) with the internal key; service honours it only then; `TRUST_PROXY_HOPS` (default 0) stops X-Forwarded-For spoofing |
| 31 | High | 3D / AI Lab | 3D pages throw — and the AI Lab crashes entirely — if the third-party HDR CDN is unreachable | **Fixed** `2f2d975` — HDRs self-hosted under `public/hdri/`; loaded outside React's throw path, so a missing map is a warning, never a page error; E2E stand-in removed |
| 29 | High | Tooling | `db:reset` guard refuses only Supabase — a Neon URL is dropped | **Fixed** `030a484` — `db:reset` accepts local hosts only (shared `assertLocalDatabaseUrl`) |
| 07 | Medium | Billing | `/deduct` double-charges under concurrency; users can write ADMIN_ADJUSTMENT rows | **Fixed** `fba88e7` — `/deduct` removed (no callers); no client-chosen ledger types remain |
| 22 | Medium | Chat | Refund after a failed generation is a single best-effort call (no retry) | **Fixed** `fba88e7` — nothing debited before capture; retries; unsettled holds expire uncharged and are reported |
| 23 | Medium | BFF / Webhook | BFF proxies the webhook path but strips `X-Signature` | **Fixed** `0b4a13c` — BFF answers 404 for `/api/billing/webhooks/*`; `.env.example` points at Express |
| 24 | Medium | Auth | JWT returned in JSON bodies (readable by page JS) despite httpOnly cookie | **Fixed** `0b4a13c` — BFF sets the httpOnly cookie and strips `token` from bodies; `/api/auth/set-cookie` removed |
| 06 | Medium | Auth / Profile | Date of birth shifts one day earlier on servers east of UTC (and drifts on each save) | **Fixed** `05352ba` — pg `DATE` parsed as text; profile page formats the date in UTC (it showed the previous day west of UTC) |
| 09 | Medium | Auth | Registration reveals whether an email already has an account | **Fixed** `ce43380` — register answers `200` + the same message for every email and never signs in |
| 18 | Medium | Auth | Password reset does not revoke existing sessions | **Fixed** `ce43380` — `token_version` (`010`); JWT claim `tv`; password reset revokes older sessions |
| 27 | Medium | i18n | 83 UI strings (auth, credits, pricing…) are English-only in all 11 other locales | **Fixed** `aa563d4` — 84 keys × 11 locales, machine-translated, review list in `I18N_REVIEW.md` |
| 05 | Medium | DB | Ledger can be `TRUNCATE`d; `user_balances` can drift from the ledger | **Fixed** `030a484` — `008`: TRUNCATE blocked; balance writes only via `post_credit_transaction`; `ledger_reconciliation()` |
| 10 | Low | Webhook | A malformed `pending_order_id` makes the whole fulfilment fail | **Fixed** `b4d96da` — non-UUID value ignored with a warning; purchase credited |
| 11 | Low | Webhook | Losing concurrent duplicate delivery is logged as `[Webhook] FAILED` | **Fixed** `b4d96da` — unique violation on the payment reference → `already_processed` |
| 12 | Low | API | Body-parser errors (oversized / malformed JSON) return 500 | **Fixed** `b4d96da` — 400 `INVALID_JSON` / 413 `PAYLOAD_TOO_LARGE` / 415 |
| 08 | Low | Billing | `/history?limit=abc` (or `2.7`) → 500 | **Fixed** `b4d96da` — non-integer limit → default 100 |
| 15 | Low | Billing | Failed checkouts leave orphan `pending` orders, never expired | **Fixed** `fc403c2` — failures marked `failed`; `011` `expire_stale_checkout_orders()` + scheduled job; late payments still complete |
| 16 | Low | Billing | `packageId: "__proto__"` / `"constructor"` → 500 instead of 400 | **Fixed** `b4d96da` — `Object.hasOwn` → 400 `INVALID_PACKAGE` |
| 19 | Low | Auth | Google sign-in misconfiguration reported as 401 "invalid token" | **Fixed** `ce43380` — misconfiguration → `503 GOOGLE_AUTH_DISABLED` |
| 20 | Low | API | Any unhandled unique violation is answered `200 {success:true, "account created"}` | **Fixed** `ce43380` — unhandled unique violation → `409 CONFLICT` |
| 21 | Low | Chat | Gemini call has no timeout / abort signal | **Fixed** `fba88e7` — `AbortSignal.timeout(GEMINI_TIMEOUT_MS)`; timeout → 504, reservation released |
| 25 | Low | Chat | Billing unreachable → unhandled exception (500) instead of `503 BILLING_UNAVAILABLE` | **Fixed** `fba88e7` — unreachable/misconfigured billing → `503 BILLING_UNAVAILABLE` |
| 13 | Low | Webhook | Production Lemon variant IDs hard-coded as a fallback mapping | **Fixed** `3ae839d` — env-only mapping (service + frontend); production refuses to start without all three variants |
| 17 | Low | Billing | No pagination: ledger rows beyond the newest 200 are unreachable | **Fixed** `f6273fc` — keyset cursor on (`created_at`, `id`), `nextCursor`; dashboard "Load more" |
| 26 | Low | Theme | No pre-hydration theme script → White Lab users see a Night Lab flash | **Fixed** `ba12e97` — inline `<head>` script; residual: context-styled components switch at hydration (see below) |
| 14 | Info | Webhook | Valid signature + invalid JSON → 400 with body "Invalid signature" | **Fixed** `b4d96da` — body "Invalid webhook body" |
| 32 | Info | Auth UI | `/verify-email` submits the token repeatedly (later calls 400) | **Fixed** `0b4a13c` — the verification token is submitted once |
| 28 | Info | Dashboard | Unknown ledger types render as `SOME NEW TYPE` instead of Title Case | **Fixed** `a249a8c` — Title Case fallback |
| 33 | Medium | Auth UI | Stale 401s from guest-era requests close the sign-up dialog / delete a just-created session cookie (found in Phase 1.5) | **Fixed** `47fc4b8` `0b4a13c` — guest 401s neither close dialogs nor clear cookies; 401s from requests started before the latest sign-in are ignored |
| 30 | Info | Repo | Hygiene: committed `node_modules`/`dist`, outdated README, deprecated `middleware.ts` | **Fixed** `69e1034` — vendored `node_modules`/`dist` untracked; README updated; JWT_SECRET entropy check. `middleware.ts` rename intentionally deferred |

---

## Remediation status (Phase 1.5)

Branch `fix/phase1-findings`. Test changes made while fixing are logged in
[TEST_CHANGES.md](./TEST_CHANGES.md); production steps are in
[docs/ops/PRODUCTION_RUNBOOK.md](../ops/PRODUCTION_RUNBOOK.md); every caller-visible change is in
[docs/ops/BEHAVIOUR_CHANGES.md](../ops/BEHAVIOUR_CHANGES.md). All batches (0–5) are done: **34 of 34 findings fixed**, none deferred. The rename of `middleware.ts` → `proxy.ts`
(FINDING-30) was intentionally not done, as instructed. Every caller-visible change is listed in the behaviour-changes
document; the deploy owner's steps are in the runbook.

**Residual notes (not regressions):**
* **FINDING-26:** the inline script sets `data-theme` / `dark` on `<html>` before first paint, so CSS-driven colours
  (page background, globals) are right immediately. 48 components take Tailwind classes from the theme *context*; the
  server HTML renders those with Night Lab classes and they switch at hydration (now in a layout effect, before the
  hydrated paint). Removing that last window means moving those classes to CSS (`dark:` variants) — a refactor, not
  part of this fix.
* **FINDING-27:** the 83 missing keys are translated. Separately, 56–80 keys per locale (AI Lab, toasts, measurement /
  atom-focus labels, studio CTA cards) *exist* in every locale but still hold the English text. Out of scope here;
  recommended for Phase 3.
* **FINDING-31:** the brief suggested `files=`; the map is passed as `map=` (loaded by three's `HDRLoader` from the same
  self-hosted files) because R3F 9 reports even error-boundary-caught loader errors as uncaught page errors.

## FINDING-33 — Medium — Guest auth dialog closed by a late hydration probe (new in Phase 1.5)

* **Where:** `src/context/AuthContext.tsx` — guest hydration fires `/balance` and `/profile`;
  `Promise.all` finished on the first 401, `AuthGatePage` opened the dialog, then the second probe's 401
  reached the global unauthorized handler, which unconditionally ran `setAuthModalOpen(false)`.
* **Reproduce:** open `/signup` as a guest when `/profile` answers a few ms after `/balance` (observed in
  the E2E mobile run): the page says "Use the dialog…" but no dialog is shown.
* **Expected:** the dialog stays open. **Actual:** closed.
* **Tests:** `tests/unit/auth/AuthContext.test.tsx` (deterministic: the second probe is held until the
  dialog is open), plus "an expired real session still closes stale dialogs on 401".
* **Fix (`47fc4b8`):** the handler closes dialogs only when a stored session existed (real expiry).

## FINDING-34 — High — Google pre-account takeover (new in Phase 1.5; was an out-of-scope note)

* **Where:** `services/auth-billing-service/src/services/auth.service.ts#loginWithGoogle` — first Google
  sign-in for an email that already has a local account.
* **Attack:** register the victim's email with a password you know (it stays unverified). When the
  victim later signs in with Google, the account was linked to their Google identity **and marked
  verified**, while the attacker's password and sessions kept working — a shared account.
* **Expected:** an unverified account cannot keep a third party's access after the real owner proves the
  address. **Actual (before):** password and sessions survived.
* **Tests:** `services/auth-billing-service/tests/api/auth.takeover-sessions.test.ts` — verified to fail
  with the previous linking code (attacker login 200 instead of 401).
* **Fix (`ce43380`) — policy:** Google has proven ownership, so the Google user takes the account over.
  In one transaction: the password hash is replaced with an unguessable one, `token_version` is bumped
  (all sessions revoked), verification and reset tokens are deleted, then the Google subject is linked and
  the account verified (signup bonus once). A genuine owner who had simply never verified keeps the
  account and its data, and can set a password via "Forgot password". **Verified** accounts are linked
  without touching password or sessions. Rejected alternative: refusing the sign-in would lock genuine
  owners out of their own address.

## FINDING-33 addendum (Batch 3)

With FINDING-09, the verification link is where a new account first signs in. Two stale-response races
appeared on that path (E2E mobile): a guest-era `/balance` 401 arriving after sign-in triggered
"session expired", and a guest probe's `clear-cookie` landed after `verify-email` had set the cookie.
Fixed in `0b4a13c`: requests carry the session epoch they started in and stale 401s are ignored; guest
401s never call `clear-cookie`. Deterministic unit tests in `tests/unit/auth/AuthContext.test.tsx`.

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

* **Security (resolved in Phase 1.5 Batch 3):** pre-account takeover → FINDING-34; gateway `..` escapes →
  404 for every service; `clear-cookie` logout CSRF → origin/Sec-Fetch-Site guard; `X-Forwarded-For`
  spoofing → `TRUST_PROXY_HOPS` (default 0) + internal-key-only `X-Client-IP`.
* **Security (still open, Phase 2):** Output "content policy" is a 4-regex
  heuristic. Dev mailer logs raw verification/reset links whenever `RESEND_API_KEY` is unset and
  `NODE_ENV !== "production"` (e.g. a staging env).
* **Performance:** `/api/chat` makes three sequential service round-trips (`/me`, `/consume`,
  Gemini) before answering; in-memory chat rate limiting is per-instance; the balance auto-refresh
  polls every few seconds while signed in.
* **Testing tooling:** Docker was not running on the authoring machine; local DB suites ran against a
  throwaway PostgreSQL 18 cluster (`initdb`, trust auth, port 55432). CI uses `postgres:16-alpine`.

---

## Coverage report — Phase 1.5 final run (2026-10-24)

| Suite | Files | Result | Coverage |
| --- | --- | --- | --- |
| **Service total** (unit · api · db) | 21 | **487 pass · 0 expected-fail** | **88.1 %** lines, 87.9 % statements, 92.2 % functions, **73.5 % branches** (Phase 1: 85.3 / 85.1 / 90.3 / 69.9) |
| Root (BFF api + frontend unit) | 20 | **402 pass · 0 expected-fail** | BFF files **93.7 %** lines (Phase 1: 87.3 %); whole `src/` include-set 49.6 % (Phase 1: 46 %) |
| E2E (Chromium + Pixel 7) | 3 | **29 / 29**, two consecutive runs, ~1.4 min each | paid journey desktop + mobile; guest, FINDING-26 and FINDING-31 checks |
| Type check | — | `npm run typecheck:tests` (root) and `npm run typecheck` (service): **0 errors** | new CI steps |

No `it.fails` / `test.fail` marker remains. No test is skipped.

### Phase 1 baseline (for comparison)

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
