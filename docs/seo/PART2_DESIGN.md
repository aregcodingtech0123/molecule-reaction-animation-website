# Part 2 design note — molecule pages, structured data, trust pages (branch `seo/aeo-geo`)

Written before any Part 2 code (2026-11-01). Decisions D1–D7 and the Part 1 constraints still apply
(`SEO_FINDINGS.md` §6). Facts about Google come from Google's own pages, read 2026-11-01 (sources at the end).

## 1. Molecule pages (D5)

### URL scheme

| URL | What it is | Robots | In sitemap |
| --- | --- | --- | --- |
| `/molecules` | Index of the 15 molecules: name, formula, one line each, grouped by category | index, self-canonical | yes |
| `/molecules/<id>` | One server-rendered page per molecule, `<id>` = the existing lowercase id (`water`, `caffeine`, `dna-fragment`, `heme-group` …) | index, self-canonical | yes (15) |
| `/molecules/<anything else>` | `notFound()` → the site's 404 (status 404, `noindex`) | — | — |
| `/explore` | The 3D workbench (unchanged) | index, canonical `/explore` | yes |
| `/explore?molecule=<id>` | The workbench opened on that molecule (unchanged behaviour) | canonical **`/explore`** (unchanged) | no |

* Ids are the ones `MOLECULE_MAP` already uses, so no new identifier exists anywhere. Paths are case-sensitive like the
  rest of the site (`/molecules/Caffeine` → 404); Next's existing trailing-slash 308 applies.
* The list of valid ids is the data itself (`ALL_MOLECULES`); a test fails if a molecule exists without a page or a page
  without a molecule.

### Redirects from `/explore?molecule=…` — decision: **no redirect**

`/explore?molecule=<id>` is the app's deep link: it opens the interactive 3D workbench on one molecule. It is linked from
the home page and is what users bookmark and share. Redirecting it to `/molecules/<id>` would take users away from the
viewer they asked for, and the molecule page would then need yet another URL to open the viewer, which only moves the
duplicate. The two URLs are different pages (a 3D tool vs an article), so neither is a duplicate of the other:

* `/explore?molecule=<id>` keeps `canonical: /explore` (Part 1, SEO-03): every workbench state consolidates into the
  workbench page.
* `/molecules/<id>` is the canonical page *about* the molecule and links into the workbench with
  `/explore?molecule=<id>` ("Open in the 3D explorer").
* An unknown id (`/explore?molecule=xyz`) keeps today's behaviour (default molecule, canonical `/explore`). It is not
  a soft-404 problem because the canonical never points at the query URL.

This contradicts nothing in the brief: D5 asked *whether* to redirect; this records why not.

### Metadata for non-JS bots

* Per-page title/description come from `generateMetadata` reading the in-memory molecule map (no I/O). Part 1 measured
  that in this app (every page rendered per request because of the nonce CSP) metadata lands in `<head>` for Googlebot,
  Bingbot, GPTBot, ClaudeBot, PerplexityBot and an unlisted bot (SEO-12). The production-build SEO spec gets a molecule
  page added to that check. **Only if it fails** for an AI crawler UA: set `htmlLimitedBots` to Next's default list plus
  `GPTBot|OAI-SearchBot|ClaudeBot|Claude-SearchBot|PerplexityBot|CCBot` (setting it replaces the default).
* All content is server-rendered (server components, no Suspense boundary around the facts): name, formula, answer-first
  summary, verified facts, uses, breadcrumbs, related molecules, links. No 3D canvas on these pages (no three.js in their
  bundle; the bundle budget gets entries for the two new routes).
* Title: `<Name> (<formula>) — structure, properties and uses`; description: the answer-first sentence.
* Open Graph/Twitter reuse the site share image (no per-molecule images; see §4 on images).

### Canonical rules

Self-canonical on `/molecules` and `/molecules/<id>`, absolute from `SITE_URL`, and **omitted while the site is not
indexable** (same rule as Part 1). The route registry gets a `/molecules/[id]` entry so the existing "every page is
classified" test keeps covering the new routes.

### What a molecule page shows (and what it does not)

Only facts that passed verification (§3). The data file is **not changed** (owner rule: never silently): facts marked
"for review" in `DATA_REVIEW.md` stay in `src/lib/molecules/data.ts` and Explore shows them as today, but the new
indexable pages **leave them out** until you decide. No atom/bond counts or geometry from the 3D models are stated as
facts: 7 of the 15 models do not match their formula (listed for review).

### How they link into the app

Breadcrumbs (Home › Molecules › Name), "Open in the 3D explorer" (`/explore?molecule=<id>`), related molecules (same
category), and a link to `/molecules` from the footer, the `/explore` intro and the home page. `/explore`'s server-rendered
molecule list stays a list of workbench links.

## 2. Structured data (JSON-LD)

Rule: markup only where it is a true description of visible content (Google: "Your structured data must be a true
representation of the page content"; "Don't mark up content that is not visible to readers of the page").

| Page | Type | Content | Notes |
| --- | --- | --- | --- |
| `/` | `WebSite` | `name` = site name, `url` = the canonical home URL | Google: "must be on the home page"; required `name`, `url` |
| `/` (and `/about`) | `Organization` | name, url, contact | **Only once the owner details exist.** While the legal entity / contact are placeholders it is **not emitted** (an Organization with an invented or placeholder name would be untruthful); the launch check lists it |
| `/pricing` | `WebApplication` | name, url, `applicationCategory: EducationalApplication`, `offers`: the three credit packs from `CREDIT_PACKAGES` (price, `USD`), exactly as rendered | No rating or review exists, so Google's software-app rich result is **not reachable** ("You must include one of the following properties: aggregateRating, review"). Kept because it truthfully describes the page; no fake ratings ever |
| `/molecules`, `/molecules/<id>` | `BreadcrumbList` | Home › Molecules (› Name); last item without `item` | Google: at least two `ListItem`s; the last item does not need `item` |
| — | `FAQPage` | **not used** | Google's changelog: FAQ rich result "will no longer appear in Google Search starting May 7, 2026" (entry of May 8, 2026); documentation removed June 15, 2026. The FAQ *page* itself could not be read (the fetch returned the changelog), so this rests on the changelog. Visible FAQ sections are still added where the content is real (AEO), without the markup |
| gated, auth, coming-soon, trust drafts | none | | Nothing on pages that are `noindex` |

* All JSON-LD is emitted **only while the site is indexable** (it needs the absolute origin from `SITE_URL`); otherwise
  none, consistent with SEO-20's fail-closed rule.
* Serialisation escapes `<` as `<` (Next's JSON-LD guide); values come from our own constants, never from user input.

### CSP compatibility (to verify, not assumed)

The policy is `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `'unsafe-inline'`. A `<script type="application/ld+json">`
is a data block: browsers do not execute it, so script-src should not apply. This is **verified, not assumed**: the
production-build E2E loads each page with JSON-LD under the real enforced policy, listens for `securitypolicyviolation`
events and console CSP errors (must be none), and parses every JSON-LD block (must be valid JSON with the expected
`@type`). The JSON-LD element carries no nonce (not needed; adding one would only expose the nonce in one more place).

## 3. Data verification (molecules, element categories)

Sources: PubChem (NCBI) computed properties and experimental-property sections via PUG REST, retrieved 2026-11-01; IUPAC
*Nomenclature of Inorganic Chemistry, Recommendations 2005* (Red Book), section IR-3.5. Results and every difference are in
`DATA_REVIEW.md` §6–§7; **no value is changed**. PubChem's own licence pages were behind a captcha; NCBI's policy page
says NCBI "places no restrictions on the use or distribution of the data" but submitters may hold rights. The pages
therefore **do not copy PubChem text**; they show our own values, and PubChem is cited as the source they were checked
against (citation is not a licence requirement we rely on).

## 4. Images (SEO-19)

The periodic table loads the lead image of each element's Wikipedia article at runtime. Each such image is a Commons file
with its own licence; reuse needs the author, licence name and link (Commons: "the content creator who must be credited,
not the uploader"), which the REST summary does not provide and the UI never showed. **Decision applied: no Wikipedia images.**
The panel shows the site's own generated visual (the existing phase illustration / gas cloud), the external fetch is
removed, and the CSP drops `https://upload.wikimedia.org` (img-src) and `https://en.wikipedia.org` (connect-src): the
policy only gets tighter. The new molecule pages have no images.

## 5. Trust pages (D6)

`/about`, `/contact`, `/privacy`, `/terms`, server-rendered, linked from the footer on every page (including the home
page, which Google's OAuth branding rules require for the privacy policy) and from a small links row on the home page.

* One file holds the owner details (`src/lib/legal/site-owner.ts`): legal entity, country, postal address, contact email,
  governing law, refund wording, hosting providers. Every unknown value is an explicit placeholder marker.
* Each page shows a visible **"Draft — needs legal review"** notice. While any placeholder remains the four pages are
  `noindex` and out of the sitemap, and `Organization` JSON-LD is not emitted.
* `npm run check:launch-content` **fails** (exit 1) while any placeholder remains and names each one; it is added to the
  launch checklist. A test proves it fails today and passes for a filled-in configuration.
* Privacy text is derived **strictly from the code** (what is stored, sent where, kept how long where the code decides),
  with file references in a review table in `docs/seo/TRUST_PAGES.md`. Anything the code does not decide (retention of
  host logs, legal bases, the Gemini plan's data use) is a placeholder or flagged, never invented.
* The footer's placeholder "GitHub → https://github.com" link is removed and "About" points to `/about` (SEO-10).

## 6. Answer-first content (AEO/GEO)

Short, visible, server-rendered answers from repo facts only: an answer-first sentence on each molecule page; a "Common
questions" section on the home page and on `/pricing` (credits, packs and prices from `CREDIT_PACKAGES`, guest browsing,
payments by Lemon Squeezy, what happens to credits when an AI request fails — all from code). Anything that needs a policy
decision (refunds, data deletion) is flagged for review, not answered.

## 7. Out of scope (unchanged rules)

No billing, auth or ledger changes; gating, headers and CSP intact (the CSP only loses two hosts); English only (D1);
element pages deferred (D4); `llms.txt` skipped (D7); no pushes.

## Sources (read 2026-11-01)

Google Search Central: [structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
(updated 2026-07-10) · [site names](https://developers.google.com/search/docs/appearance/site-names) (2025-12-10) ·
[Organization](https://developers.google.com/search/docs/appearance/structured-data/organization) ·
[software app](https://developers.google.com/search/docs/appearance/structured-data/software-app) (2026-09-08) ·
[breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb) ·
[documentation updates / changelog](https://developers.google.com/search/updates) (FAQ entries of May 8 and June 15, 2026).
Wikimedia: [Reusing content outside Wikimedia](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).
NCBI: [policies](https://www.ncbi.nlm.nih.gov/home/about/policies/). IUPAC Red Book 2005, IR-3.5. Next.js 16.4.3 bundled
docs: `01-app/02-guides/json-ld.md`, `generate-metadata.md` (streaming metadata, `htmlLimitedBots`).
