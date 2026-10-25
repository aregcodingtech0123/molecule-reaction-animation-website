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
