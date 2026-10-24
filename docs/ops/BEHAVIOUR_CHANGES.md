# Breaking and behaviour changes — Phase 1.5 remediation

Every change visible to the frontend, to API callers, to Lemon Squeezy, or to operators.
Deploy steps are in [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md); test changes are in
[TEST_CHANGES.md](../testing/TEST_CHANGES.md).

Legend: **Breaking** = an existing caller or deploy breaks unless it changes; **Behaviour** = same
contract with a different observable result; **Ops** = affects operators and deploys only.

## Summary for the deploy owner

| Area | What changes | Who notices |
| --- | --- | --- |
| Sessions | **Every user is logged out once** at the Express deploy | all signed-in users |
| Deploy order | Express **before or together with** Next.js; roll both back together | operator |
| New required env | `INTERNAL_SERVICE_SECRET` (both services, ≥ 32 chars, identical) | operator |
| New recommended env | `CLIENT_IP_HEADER` (Next.js) | operator |
| New optional env | `TRUST_PROXY_HOPS`, `GEMINI_TIMEOUT_MS`, `BILLING_RETRY_DELAYS_MS`, `AI_HOLD_TTL_SECONDS`, `AI_HOLD_SWEEP_INTERVAL_MS`, `MIGRATION_DATABASE_URL` | operator |
| Migrations | `008`–`011` via the tracked runner (`db:migrate --baseline` once in production) | operator |
| Lemon Squeezy | Webhook URL **must** point at Express; the Next.js host answers 404 | operator |
| Lemon variants | `LEMONSQUEEZY_VARIANT_*` required in production — Express refuses to start without them; no hard-coded fallback | operator |
| Scheduled job | `SELECT expire_stale_checkout_orders();` (hourly/daily) | operator |
| Billing history API | adds `nextCursor`; new `400 INVALID_CURSOR`; dashboard "Load more" | frontend, API callers |
| AI Lab | Charged only on success; new 409 / 504 / 503 answers | AI Lab users, frontend |
| Sign-up | Never signs in; same answer for new and existing emails | new users, frontend |

## Batch 0 — repo hygiene (FINDING-30)

| Kind | Change |
| --- | --- |
| Ops | `JWT_SECRET` check: the old rule rejected any key that merely **contained** `secret`. Now the key must not equal a known placeholder, must be ≥ 32 chars and must have ≥ 3 bits/char entropy. A long but repetitive key (`aaaa…`) that used to boot is now refused at startup (`FATAL:`). |
| Ops | `services/auth-billing-service/node_modules` and `dist/` are no longer tracked. A deploy that relied on the committed `dist/` must run `npm ci && npm run build`. |

## Batch 1 — database (FINDING-01, 02, 05, 29)

| Kind | Change |
| --- | --- |
| Ops | `db:setup` now creates the database **and applies every migration** through the tracked runner (`schema_migrations`). New scripts: `db:migrate`, `db:migrate:status`, `db:migrate:baseline`, `db:reconcile`. |
| Ops | Removed scripts: `migrate-email-verification.mjs`, `migrate-oauth-revocation.mjs`, `migrate-user-profiles.mjs` (their SQL is in the numbered migrations). |
| Ops | The runner refuses pooled connection URLs (PgBouncer/Neon `-pooler`/Supavisor `:6543`). Use a direct URL or set `MIGRATION_DATABASE_URL`. A production DB created before the runner must be adopted once with `--baseline`. |
| Ops | The runner aborts (non-zero exit, nothing applied) on a changed checksum, a missing file, a gap, an untracked DB, or a new file containing its own `BEGIN/COMMIT`. |
| Breaking (ops) | `db:reset` accepts **local hosts only** (and never with `NODE_ENV=production`). It used to block only Supabase URLs. |
| Breaking (DB) | `TRUNCATE` of `credit_ledger_transactions` / `user_balances` is refused. A direct `UPDATE user_balances` is refused. Balances change only through `post_credit_transaction()`. Manual "fix a balance" SQL must post a ledger row instead (see runbook). |
| Ops | `db:reconcile` exits `0` when the ledger and balances agree and no hold is unsettled, `2` when there are mismatches / `capture_failed` / expired-unsettled holds, and `1` when the job itself fails. Alert on any non-zero exit. |

## Batch 2 — AI metering (FINDING-03, 07, 21, 22, 25)

| Kind | Change |
| --- | --- |
| Breaking (API) | `POST /api/billing/consume`, `/capture`, `/refund` on Express require `X-Internal-Service-Key`. Without a valid key they answer **404** (not 401/403). Through the Next.js host they always answer **404**. |
| Breaking (API) | `POST /api/billing/deduct` is **removed** (no callers). |
| Behaviour | AI turns reserve the cost first and charge it (one `CREDIT_CONSUMPTION` row) only after a successful answer. A failed or timed-out generation is released and never appears in the ledger. Previously it was debited and then refunded (two rows). |
| Behaviour | A captured charge can no longer be refunded by anyone. |
| Behaviour | The balance shown by `/api/billing/balance` is the ledger balance; credits held by a turn in flight are not shown as spent until the turn completes. Concurrent turns cannot overspend: the check uses balance minus active holds. |
| Behaviour (frontend) | `/api/chat` new answers: `409 DUPLICATE_OPERATION` (reference already used; Gemini is not called), `504 AI_TIMEOUT` (model exceeded `GEMINI_TIMEOUT_MS`; not charged), `503 BILLING_UNAVAILABLE` (billing unreachable or misconfigured; previously a generic 500). A content-policy block (`422`) is still charged, as before. |
| Behaviour | If capture keeps failing after retries, the answer is still delivered and the turn goes uncharged; it is logged `CAPTURE_FAILED` and reported by `db:reconcile`. |
| Ops | Holds expire after `AI_HOLD_TTL_SECONDS` (default 600) and are swept every `AI_HOLD_SWEEP_INTERVAL_MS`. Expired holds are never charged. |
| Ops | Both services refuse to start without a strong `INTERNAL_SERVICE_SECRET` (`next build` does not need it). |
| Ops | Starting the service CLIs with `MOLECULESTUDIO_SKIP_DOTENV=1` and `NODE_ENV=production` is refused. |

## Batch 3 — auth and gateway (FINDING-04, 09, 18, 19, 20, 23, 24, 32, 33, 34)

| Kind | Change |
| --- | --- |
| **Breaking (all users)** | JWTs carry a `tv` (token-version) claim that must equal `users.token_version` (migration `010`). Tokens without it are refused: **every existing session ends at the Express deploy.** |
| **Breaking (deploy order)** | The new Next.js middleware refuses tokens without `tv`. Deploy Express first or both together; roll back both together. |
| Behaviour | A password reset revokes every session issued before it (`token_version` + 1). |
| Breaking (API) | `POST /api/auth/register` answers `200 { message }` with the same message for new **and** existing emails, and **never** returns a token or sets a cookie. The user signs in by following the verification link (which signs them in) or by logging in. Previously: `201` + token (signed in) for new emails and a different answer for existing ones. |
| Behaviour | Google sign-in for an email that has an **unverified** password account takes that account over: the password is invalidated, its sessions are revoked, pending verification/reset links stop working, and the account is linked to Google and marked verified. Verified accounts are linked as before. (FINDING-34) |
| Behaviour | Google sign-in misconfigured on the server → `503 GOOGLE_AUTH_DISABLED` (was `401 GOOGLE_TOKEN_INVALID`). |
| Behaviour | An unexpected unique-constraint violation → `409 CONFLICT` (was `200 { success: true, "account created" }`). |
| **Breaking (frontend API)** | Auth answers from the BFF (`login`, `google`, `verify-email`, …) **no longer include `token`** in the JSON body. The BFF sets the httpOnly `session_token` cookie itself (`SameSite=Strict`, `Secure` in production, `Max-Age` = the token's remaining lifetime). |
| **Breaking (frontend API)** | `POST /api/auth/set-cookie` is **removed** (404). A browser tab opened before the deploy calls it after sign-in and fails once; reloading fixes it. |
| Breaking (API) | Non-GET requests through the BFF and `POST /api/auth/clear-cookie` answer **403 `CSRF_REJECTED`** when `Sec-Fetch-Site: cross-site` or when `Origin` is foreign or `null`. Localhost origins are allowed only outside production. Requests without an `Origin` (server-to-server, curl) are unaffected. The allowed origin is Next.js `FRONTEND_URL`, which must be the exact public origin (it used to guard only `set-cookie`). |
| Breaking (Lemon) | `/api/billing/webhooks/*` through the Next.js host answers **404**. It could never succeed there (the signature header was stripped). The Lemon webhook URL must point at Express. |
| Behaviour | Any BFF path that escapes its service prefix (`..`, encoded slashes) answers **404** and never reaches a service. |
| Behaviour (rate limits) | Per-IP limits now apply per end user. The BFF forwards the platform's client IP (`CLIENT_IP_HEADER`) as `X-Client-IP` together with the internal key, and Express trusts it only then. Without `CLIENT_IP_HEADER`, all users share one bucket (as before) and Next.js logs a startup warning. |
| Behaviour (rate limits) | Express ignores `X-Forwarded-For` from direct callers unless `TRUST_PROXY_HOPS` > 0 (default `0`). Spoofed headers no longer select a fresh rate-limit bucket. `signup_ip` / login audit IPs are now real end-user addresses. |
| Behaviour (frontend) | `/verify-email` submits the token exactly once. A 401 from a request started before the latest sign-in (or from a guest probe) no longer signs the user out, closes the auth dialog or clears the cookie. |

## Batch 4 — billing, webhook and API edge cases (FINDING-08, 10, 11, 12, 13, 14, 15, 16, 17)

| Kind | Change |
| --- | --- |
| **Breaking (ops)** | Express **refuses to start in production** unless `LEMONSQUEEZY_VARIANT_STARTER/_PRO/_ENTERPRISE` are all set, numeric and distinct. The hard-coded production variant ids (`2154652/2154661/2154665`) are gone from the service **and** the frontend. Outside production a warning is logged. |
| Behaviour (Lemon) | A paid order whose variant id is not configured is no longer mapped to a pack by a built-in table; it falls back to `custom_data.package_id` (amount-checked) or is logged "Unable to resolve package". |
| Behaviour (frontend) | `?variant_id=` deep links resolve only through the build-time `NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_*`; unset → ignored. `loginUrlForPackage` omits `variant_id` when unset. `?redirect_checkout=` is unaffected. |
| Behaviour (Lemon) | A non-UUID `custom_data.pending_order_id` is ignored with a warning; the purchase is credited (it used to fail the whole fulfilment). |
| Behaviour (ops) | The losing delivery of two **concurrent** duplicate webhooks is reported as `already_processed` (a "Not credited" warn line), no longer as `[Webhook] FAILED … replay manually`. |
| Behaviour (Lemon) | Valid signature + unparsable body → `400 {"error":"Invalid webhook body"}` (was "Invalid signature"). Lemon does not act on the body. |
| Behaviour (API) | Body-parser errors on every Express route: malformed JSON → `400 INVALID_JSON`; body over the limit (32 kb, webhook 256 kb) → `413 PAYLOAD_TOO_LARGE`; unsupported charset/encoding → `415 UNSUPPORTED_MEDIA_TYPE`. All were `500 INTERNAL_ERROR`. |
| Behaviour (API) | `GET /api/billing/history?limit=` that is not an integer (`abc`, `2.7`, `NaN`, repeated) → the default page size (100). Was `500`. Integers keep the 1–200 clamp. |
| Behaviour (API) | `POST /api/billing/checkout` with `packageId` = `__proto__`, `constructor`, `toString` … → `400 INVALID_PACKAGE` (was `500`). |
| Behaviour (API) | `GET /api/billing/history` returns `data.nextCursor` (opaque string, `null` on the last page) next to `data.transactions`; pass it back as `?cursor=` for older rows. Order is now `created_at DESC, id DESC` (stable for equal timestamps). An invalid cursor → `400 INVALID_CURSOR`. Without `cursor` the rows are the same as before. |
| Behaviour (frontend) | Dashboard history shows a **Load more** button while older rows exist. |
| Behaviour (API) | Checkout with Lemon or the pack's variant not configured → `503` **before** any order row is written. A Lemon failure after the row exists marks it `failed` (was left `pending`). |
| Ops | Migration `011`: `expire_stale_checkout_orders(interval DEFAULT '24 hours')` (minimum 1 hour) marks old `pending` checkout rows `expired`; schedule it (runbook §9). A late payment for an `expired`/`failed` row is still credited and the row marked `completed`. |

## Batch 5 — frontend (3D, dates, i18n, theme)

_To be filled when Batch 5 lands._
