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
* **Optional hardening (Part 2):** `inflate: false` on the parsers if no client needs compressed request bodies.

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
