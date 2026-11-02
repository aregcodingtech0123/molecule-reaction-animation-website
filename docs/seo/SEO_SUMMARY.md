# SEO / AEO / GEO phase — summary

One page for the owner: what was built, what was decided, what is still yours to do, and how to keep it healthy. Details live in the
documents listed at the end; every statement here is backed by one of them or by a test.

## 1. Outcome in short

The site can now be launched **visible to search engines, or hidden, by one setting** (`SITE_URL`); it is **hidden by default** and cannot become
visible by accident. When visible it has: a correct `robots.txt` and `sitemap.xml`; unique titles, descriptions and canonical URLs; `noindex` on
sign-in, signed-in and "coming soon" pages; a real 404; a share image and icons; JSON-LD that is true (`WebSite`, `WebApplication`, `BreadcrumbList`,
`Organization` only once your details are real); server-rendered content for crawlers that do not run JavaScript; **14 molecule pages** with sourced facts;
and four **draft** trust pages. The data shown on the pages was checked against authoritative sources and corrected where it was wrong. Nothing here
guarantees rankings; search engines decide what they index and when ([`SEO_LAUNCH_CHECKLIST.md`](SEO_LAUNCH_CHECKLIST.md)).

## 2. What was built, by area

| Area | Result | Where to read |
| --- | --- | --- |
| Indexing control | `SITE_URL` (server-only, per request); unset / non-https / non-production Vercel deployment → `noindex` everywhere, `Disallow: /`, empty sitemap. `check:config` requires it and requires it to equal `FRONTEND_URL` | `SEO_FINDINGS.md` SEO-20, D3 |
| robots / sitemap | `robots.txt` (all crawlers allowed — D2; `/api/` out), `sitemap.xml` from one route registry (20 URLs; 24 when the trust pages are no longer drafts; no `lastmod` on purpose) | SEO-01, -02 |
| Per-page signals | unique title + description + self-canonical per route, Open Graph / Twitter cards, generated share image, icons, manifest, one `<h1>` per page, custom 404 | SEO-03, -04, -07, -08, -14 |
| Pages kept out | login, sign-up, reset, verify, "coming soon" → `noindex`; signed-in pages redirect and are `noindex` too | SEO-05, -06, -09 |
| Crawlers without JavaScript | content in the first HTML, metadata in `<head>` for the AI crawlers, `/explore` content not hidden behind a stream | SEO-12, -13 |
| Molecule pages | `/molecules` + 14 pages: answer-first summary, formula, molar mass, melting/boiling points, bonding, uses, sources, link into the 3D view, breadcrumbs | `PART2_DESIGN.md`, SEO-22 |
| Structured data | `WebSite` (home), `WebApplication` with the three packs, `BreadcrumbList` on molecule pages, `Organization` only with real owner details. **No FAQ markup** (Google ended FAQ rich results in May 2026), no ratings | SEO-16 |
| Data accuracy | 118 elements checked against NIST (masses, shells), 21 description claims corrected, 14 molecule facts fixed or removed, ~40 uses/fun facts sourced, reworded or removed, 9 of 14 3D models regenerated from PubChem, categories labelled "common classification, not an IUPAC designation" | `DATA_REVIEW.md` |
| Licences | Wikipedia images removed (no licence we could satisfy); NIST, PubChem, IUPAC credited on the pages; CIAAW values not shown | `DATA_REVIEW.md` §0, §5 |
| Trust pages | `/about`, `/contact`, `/privacy`, `/terms` as **drafts needing legal review**; `check:launch-content` fails while any of 14 placeholders remains | `TRUST_PAGES.md` |
| Performance | fonts measured (no change on evidence), environment-map caching fixed, signed-in pages measured | `CWV_RESULTS.md` |
| Launch tooling | `npm run check:live-seo` (checks a live origin and the host redirects), `SEO_LAUNCH_CHECKLIST.md`, both tested | `SEO_LAUNCH_CHECKLIST.md` |

### Work the phase surfaced beyond SEO (all documented, all tested)

| Change | Why it came up | Where |
| --- | --- | --- |
| Signup IP cleared after 90 days (daily `db:purge-signup-ips`, migration 016) | the privacy text had to say how long it is kept | `PRIVACY_FOLLOWUPS.md` |
| Google sign-ups no longer get an invented name/date of birth; the profile can clear stored values | invented personal data is wrong to store | `GOOGLE_PROFILE_DESIGN.md` |
| "Download my data" export; "Delete my account" by anonymisation (14-day grace, daily `db:process-deletions`, migration 017), keyed 12-month e-mail guard on the signup bonus | KVKK/GDPR rights | `ACCOUNT_DELETION_DESIGN.md`, `…_IMPLEMENTATION.md`, runbook §11 |
| `db:reconcile` lists purchases that credited nobody because no account matched (migration 018) | a deleted account's late order would otherwise be invisible | runbook §9 |
| Locale content bundles had still shown claims removed from the data | found while sourcing molecule facts | `DATA_REVIEW.md` §6.4 |

The credit ledger, balances and their triggers were never changed; tests assert it.

## 3. Decisions taken

| # | Decision |
| --- | --- |
| D1 | English-only indexing at launch: no hreflang, no locale URLs (revisit after native review of 924 machine-translated strings) |
| D2 | All crawlers allowed (policy is one small config) |
| D3 | `SITE_URL` server-only, fail-closed |
| D4 | 118 per-element pages deferred (thin data) |
| D5 | 14 molecule pages built |
| D6 | Trust pages as drafts; placeholders block `check:launch-content` |
| D7 | Atom-derived icon; fonts unchanged after measurement; `/learn`, `/showcase` noindex; no `llms.txt` |
| later | heme model left as is (counts hidden); "not produced in bulk" cutoff accepted; Phase B deletion approved with a 14-day grace; tombstone guard behind a switch (`EMAIL_TOMBSTONE_GUARD`) pending legal review |

## 4. What is still yours to do (in this order)

1. Fill the **14 placeholders** in `src/lib/legal/site-owner.ts` (legal name, country, address, contact e-mail, governing law, refund policy, hosting, log retention, Gemini data use, account deletion process, signup-IP job, deletion job, e-mail-hash decision, effective date) and **have a lawyer review `/privacy` and `/terms`**.
2. Decide the **e-mail-hash guard** with counsel (`LAUNCH_CHECKLIST.md` §1.6), then set `EMAIL_TOMBSTONE_GUARD` and, if on, a separate `EMAIL_TOMBSTONE_SECRET`.
3. Schedule the **two daily jobs** (`db:purge-signup-ips`, `db:process-deletions`) each with **both** alerts (non-zero exit; no heartbeat in 26 h), and `db:reconcile` daily (`LAUNCH_CHECKLIST.md` §5.1). The privacy text describes these practices as active only after you declare them in `site-owner.ts`.
4. Choose the **canonical host** and set up its redirects; run `npm run check:live-seo` (`SEO_LAUNCH_CHECKLIST.md` §2–§3).
5. Search Console Domain property, sitemap, and the weeks-after routine (`SEO_LAUNCH_CHECKLIST.md` §4–§7).
6. Native translation (28→34 English placeholders per language, the 924 UI strings, the new deletion/export screens) — not a blocker for English-only indexing (`LAUNCH_CHECKLIST.md` §1.7).

## 5. How to keep it healthy

* **A new page** must be classified in `src/lib/seo/routes.ts` — a unit test fails otherwise, so it cannot silently become indexable or miss the sitemap.
* **Molecule or element text** lives in two places: `src/lib/molecules/*` **and** the 12 locale bundles in `src/lib/i18n/content/` (Explore reads the bundles). A sync test fails if they drift. Every shown fact needs a fetched source or is removed (`DATA_REVIEW.md` §0).
* **After a release that touches routes, metadata or `site-owner.ts`:** `npm run check:live-seo -- https://<site> --trust <yes|no>`.
* **To hide the site:** unset `SITE_URL` and redeploy (`SEO_LAUNCH_CHECKLIST.md` §8).
* **Never** add FAQ/review/rating markup without visible, real content; the live check fails on unknown JSON-LD types on purpose.

## 6. Verification

The suites below were run on **Node 24.22.2 and PostgreSQL 18.6** (the project's test container) with these results. Floors set by the owner: service 92.10 % lines /
81.81 % branches, BFF 94.83 % lines.

| Check | Result |
| --- | --- |
| Service tests and coverage | 45 files, **824 passed** · lines **92.10 %** (1434/1557) · branches **81.81 %** (931/1138) — floors met exactly |
| Web unit + BFF tests and coverage | 61 files, **1038 passed** (including the 36 tests of the live-check script and the checklist consistency) · BFF set **94.83 %** lines (275/290), 83.61 % branches — floor met exactly |
| `tsc`, `typecheck:tests`, service `typecheck` | clean |
| Production build, bundle budget | build OK; bundle budget OK |
| E2E on the dev server, run twice | **49 passed**, 26 skipped (production-only checks) — both runs |
| E2E on the production build | **75 passed** |
| `npm run test:seo` | **25 passed** |
| `npm run check:live-seo` against the real production build (local, `SITE_URL=https://studio.example`) | all checks pass for 20 sitemap URLs (`--trust no`) |
| `npm run check:launch-content` | exit 1, 14 placeholders — intended until you fill them |

Test changes of every part are recorded in [`../testing/TEST_CHANGES.md`](../testing/TEST_CHANGES.md) (TC-60 … TC-91 for this phase).

## 7. Branches

| Branch | Content | Merged into `main` |
| --- | --- | --- |
| `seo/audit` | Part 0: audit and plan (`SEO_FINDINGS.md`) | yes |
| `seo/technical` | Part 1: technical SEO, data corrections, Core Web Vitals | yes (`5d4c982`) |
| `seo/aeo-geo` | Part 2: molecule pages, structured data, trust pages, data review, privacy and account work | yes (`6a9f6b2`) |
| `seo/launch` | Part 3: `db:reconcile` missing-user section, `check:live-seo`, `SEO_LAUNCH_CHECKLIST.md`, this summary | after your review |

## 8. Document index

[`SEO_FINDINGS.md`](SEO_FINDINGS.md) (findings, decisions, per-part results) · [`PART2_DESIGN.md`](PART2_DESIGN.md) · [`DATA_REVIEW.md`](DATA_REVIEW.md) (every data change, old → new, with source) ·
[`TRUST_PAGES.md`](TRUST_PAGES.md) · [`CWV_RESULTS.md`](CWV_RESULTS.md) · [`PRIVACY_FOLLOWUPS.md`](PRIVACY_FOLLOWUPS.md) · [`GOOGLE_PROFILE_DESIGN.md`](GOOGLE_PROFILE_DESIGN.md) ·
[`ACCOUNT_DELETION_DESIGN.md`](ACCOUNT_DELETION_DESIGN.md) · [`ACCOUNT_DELETION_IMPLEMENTATION.md`](ACCOUNT_DELETION_IMPLEMENTATION.md) · [`SEO_LAUNCH_CHECKLIST.md`](SEO_LAUNCH_CHECKLIST.md) ·
[`../ops/LAUNCH_CHECKLIST.md`](../ops/LAUNCH_CHECKLIST.md) · [`../ops/PRODUCTION_RUNBOOK.md`](../ops/PRODUCTION_RUNBOOK.md) · [`../testing/TEST_CHANGES.md`](../testing/TEST_CHANGES.md)
