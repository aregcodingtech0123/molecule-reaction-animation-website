# Security findings — Phase 2

ID `SEC-xx` · severity Critical / High / Medium / Low / Info · each fixed finding has a regression test.
Scope, method and threat model: see `THREAT_MODEL.md` (Part 2). Local test stack only; no external host was scanned.

| ID | Sev | Area | Title | Status |
| --- | --- | --- | --- | --- |
| SEC-01 | Critical | Dependencies / Next.js | `next` 16.2.6 affected by 20 published advisories (6 critical RCE, SSRF, cache poisoning, DoS, middleware bypass) | **Fixed** (branch `security/next-upgrade`) — `next` / `eslint-config-next` 16.4.3 |

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
