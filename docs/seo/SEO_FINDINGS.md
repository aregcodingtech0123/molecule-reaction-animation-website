# SEO / AEO / GEO — findings

Part 0 (audit and plan) of the SEO phase. Findings `SEO-xx`, the evidence behind each, the proposed fix, and its
status. Later parts fill in the commit column and add their own sections.

**Method.** Production build (`next build` + `next start`, Next 16.4.3) on branch `seo/audit` at `649bf4a`, served
from the perf harness's isolated `.next-perf` dist dir with its explicit environment and network guard preload
(`scripts/perf/config.mjs` `webEnv`). Express was not started: public pages need no API, and gated pages redirect
before any call. Every HTML route was fetched without JavaScript (`redirect: manual`) with a Googlebot user agent,
plus spot checks with `GPTBot`, `ClaudeBot`, `PerplexityBot` and a browser UA. Recorded: status, `Location`,
`X-Robots-Tag`, `X-Content-Type-Options`, CSP, `Cache-Control`, `Link`, and from the HTML: `lang`, `<title>`,
description, meta robots, canonical, hreflang, Open Graph / Twitter tags, icons, JSON-LD, heading order, `<h1>`,
links, `<img>` without `alt`, and the length of the text in `<body>` excluding scripts. Facts about third parties
were read from their official documentation on **2026-10-26** (sources at the end).

**Not verifiable before launch:** anything that needs the live domain (Search Console coverage, real crawl
behaviour, CrUX field data, rich-result eligibility on the live URL, link previews from real platforms).

## 1. Route inventory (production build, no JavaScript)

| Route | Status | Visible text¹ | `<h1>` | Indexable today? | Should be |
| --- | --- | --- | --- | --- | --- |
| `/` | 200 | 5 668 | The Future of Molecular Architecture | yes | **index** |
| `/explore` | 200 | 1 219 | Molecules | yes | **index** |
| `/explore?molecule=<id>` (15 ids, linked from `/`) | 200 | ≈ 1 200 | Molecules | yes, each a separate URL | canonical (SEO-03) |
| `/atom-models` | 200 | 1 668 | Evolution of Atomic Models | yes | **index** |
| `/periodic-table` | 200 | 2 291 | Explore the Elements | yes | **index** |
| `/pricing` | 200 | 1 133 | Pricing | yes | **index** |
| `/learn`, `/showcase` | 200 | ≈ 440 | Learn / Showcase ("coming soon") | yes | noindex until real (SEO-09) |
| `/login`, `/signup` | 200 | 415 | Sign in to continue / Create your account | yes | noindex (SEO-05) |
| `/forgot-password`, `/reset-password`, `/verify-email` | 200 | 412–491 | — | yes | noindex (SEO-05) |
| `/dashboard`, `/ai-lab`, `/profile` (signed out) | **307 → `/login`** | — | — | no (redirect) | noindex + never in sitemap (SEO-06) |
| `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/llms.txt` | **404** (HTML) | — | — | — | SEO-01, -02, -08 |
| `/does-not-exist`, `/Explore` | 404 + `noindex` | — | 404 | no | ✔ correct |
| `/explore/` | 308 → `/explore` | — | — | — | ✔ correct |
| `/api/does-not-exist` | 404, HTML not-found page with `noindex` | — | — | no | ✔ acceptable |

¹ Characters of text in the server HTML `<body>`, scripts excluded; about 350 of them are the navbar and footer.

Every HTML response already carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin` and the per-request nonce CSP; the 307s carry `nosniff` too.
No page leaks signed-in data to a signed-out crawler (gated routes redirect in `src/proxy.ts` before rendering).

## 2. Findings

Priority: **P0** fix before launch (wrong signals to search engines, or blocks a launch requirement) · **P1** clear
benefit, low risk · **P2** worthwhile, larger or needs content · **Note** recorded, no change proposed.

| ID | Pri | Area | Evidence | Proposed fix | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| SEO-01 | P0 | robots.txt | `/robots.txt` → 404 HTML page | `src/app/robots.ts`, rendered per request from the site-URL setting (SEO-20); disallows `/api/`; AI-crawler groups per decision D2 | — | open (Part 1) |
| SEO-02 | P0 | Sitemap | `/sitemap.xml` → 404 | `src/app/sitemap.ts` with absolute canonical URLs of indexable public routes only; **no `lastmod`** (no reliable per-page modification date exists; Google uses it only when "consistently and verifiably accurate") | — | open (Part 1) |
| SEO-03 | P0 | Canonical / duplicates | No `<link rel=canonical>` on any route. `/` links to 15 `/explore?molecule=<id>` URLs plus `/explore?tab=reactions`; each renders different server HTML (`?molecule=caffeine` → caffeine facts). An unknown id (`?molecule=xyz`) silently renders the default molecule with 200 | `alternates.canonical` on every indexable route. `/explore?…` canonicalises to `/explore`, or to `/molecules/<id>` if D5 adds molecule pages | — | open (Part 1) |
| SEO-04 | P0 | Titles / descriptions | Every route has the same `<title>Molecule Architecture Studio</title>` and description "A premium interactive chemistry platform to explore molecules in 3D." `DocumentMeta` rewrites both client-side to the same dictionary strings | Per-route `metadata` exports with a title template (`%s · Molecule Architecture Studio`) and a route-specific description written from the page's real content. Keep them **static** objects (SEO-12) | — | open (Part 1) |
| SEO-05 | P0 | Indexability of auth pages | `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email` answer 200 with no robots directive. The last two take one-time `?token=` URLs from emails | `robots: { index: false, follow: false }` in each route's metadata (in the original HTML, because Google "may skip rendering" after `noindex`); excluded from the sitemap. Not disallowed in robots.txt: a disallowed URL cannot show its `noindex` and "might still be indexed" | — | open (Part 1) |
| SEO-06 | P1 | Gated pages | `/dashboard`, `/ai-lab`, `/profile` → 307 to `/login` (correct, nothing rendered). The footer links `/profile` and `/dashboard` from every page, and the navbar links `/ai-lab` | Defence in depth: `noindex` metadata on the three gated routes (only a signed-in browser ever sees their HTML) and `X-Robots-Tag: noindex` on the proxy's auth redirect; never in the sitemap. The links stay (they are product navigation). Gating code is not changed | — | open (Part 1) |
| SEO-07 | P1 | Open Graph / Twitter | No `og:*` or `twitter:*` tags; no share image anywhere | `openGraph` + `twitter` (`summary_large_image`) in the root metadata with per-route title/description. One real site image generated at build with `next/og` (`opengraph-image.tsx`, 1200 × 630 — Meta's recommended size, 1.91:1) showing the product name and tagline only. No per-route images unless you want them | — | open (Part 1) |
| SEO-08 | P1 | Favicon / manifest / template leftovers | `src/app/favicon.ico` is unchanged since `8ac123c` "Initial commit from Create Next App" (the template icon). No `apple-touch-icon`, no web manifest (CSP already allows `manifest-src 'self'`). `public/{file,globe,next,vercel,window}.svg` are template files referenced nowhere in `src/` | A real icon set (`icon.svg`/`icon.png`, `apple-icon.png`) and `manifest.ts`. **Needs a logo from you** — I can generate a simple glyph from the navbar's existing Atom mark if you prefer. Delete the five unused template SVGs | — | open (Part 1, D7) |
| SEO-09 | P1 | Thin pages | `/learn` and `/showcase` are "coming soon" pages (≈ 440 characters, most of it navigation), answer 200, and are linked from navbar, footer and the home page ("View Showcase") | `noindex` until they have content; keep them out of the sitemap | — | open (Part 1) |
| SEO-10 | P0 | Trust pages (launch) | No about, contact, privacy or terms page. Footer "About" links to `/`; footer and Resources menu "GitHub" link to `https://github.com` (a placeholder, not a repository) | Add `/about`, `/contact`, `/privacy`, `/terms` (and a refund statement on terms or pricing). **Content must come from you** (legal entity, contact address, data processing, refund policy). Google OAuth verification requires the privacy policy to be "hosted within the domain that hosts your homepage" and linked on the home page. Lemon Squeezy's activation page does not list website requirements **(not verified)**. Fix or remove the GitHub link | — | open (Part 2, D6) |
| SEO-11 | Note | Language | `<html lang="en">` in every server response; `LanguageContext` switches `lang` and strings only after reading `localStorage`. Crawlers therefore always see English, consistently | Nothing for English-only indexing. hreflang needs per-locale URLs (D1) | — | — |
| SEO-12 | P1 | Streaming metadata vs AI crawlers | Next 16 streams `generateMetadata` output into `<body>` for any user agent not matching its "HTML-limited bots" list (`node_modules/next/dist/shared/lib/router/utils/html-bots.js`). The list contains Bingbot, Twitterbot, facebookexternalhit, Slackbot … but **not** `GPTBot`, `OAI-SearchBot`, `ClaudeBot`, `Claude-SearchBot`, `PerplexityBot` or `CCBot`. Static `metadata` objects are not streamed: today `<title>` and the description are in `<head>` for all four UAs tested | Use static `metadata` exports wherever possible. If dynamic routes need `generateMetadata` (element / molecule pages), set `htmlLimitedBots` to Next's default list **plus** the AI crawler tokens (setting it replaces the default), and test that `<title>` is in `<head>` for those UAs | — | open (Part 1) |
| SEO-13 | P1 | Server-rendered content | Pages are client components but are server-rendered, so a crawler gets real text (table above). Gaps: (a) on `/explore`, `/login`, `/signup` the main content is a Suspense boundary streamed after the footer in `<div hidden id="S:0">` and revealed by JavaScript: the text is in the HTML but hidden; Google renders it, non-rendering AI crawlers may skip hidden content. (b) The periodic table renders symbols and masses as text; element names exist only in `aria-label`s; descriptions only after a click. (c) `/explore` and `/pricing` have little prose explaining what they are | (a) Move the `useSearchParams` read below the page's static header/intro so headline and intro render outside the Suspense boundary (no hydration change: same markup on server and client). (b, c) A short server-rendered intro/answer section per public page (also AEO, Part 2). No hidden text: everything added is visible | — | open (Part 1–2) |
| SEO-14 | P1 | Headings / 404 page | `/pricing`: `h1` then `h3` (no `h2`). `/explore` `h1` is the generic "Molecules". The 404 page has **two** `<title>` elements (root metadata plus Next's built-in not-found title) and `h1` "404" | Fix the heading levels; descriptive `h1`s; a custom `not-found.tsx` (one title, `noindex` kept, links back to public sections, status stays 404) | — | open (Part 1) |
| SEO-15 | Note | Status codes / redirects | Unknown paths 404 with `noindex`; trailing slash 308s to the slash-less URL; paths are case-sensitive (404, not duplicates); gated routes 307. No soft 404s except SEO-03's unknown `?molecule=` | Canonical-host redirect (`www` ↔ apex, http → https) is a Vercel domain setting, documented in Part 3 | — | — |
| SEO-16 | P2 | Structured data | No JSON-LD on any page | Part 2: `WebSite` + `Organization` on `/` only (Google's site-name docs require `WebSite` on the home page), `WebApplication` with the three credit packs as `Offer`s (prices visible on `/pricing`), `BreadcrumbList` for any new detail pages. No ratings or reviews exist, so **Google's software-app rich result is not reachable** (it requires `aggregateRating` or `review`); the markup still describes the page. Nothing on gated pages. JSON-LD is a non-executable data block; CSP verification in a real browser is part of Part 2 | — | open (Part 2) |
| SEO-17 | Note | Caching | Every HTML page answers `Cache-Control: private, no-cache, no-store` (a consequence of the per-request nonce). No direct ranking effect; it rules out CDN caching of HTML (TTFB) and may limit the back/forward cache | Keep: changing it would weaken the nonce CSP. Record only | — | — |
| SEO-18 | P1 | Core Web Vitals (R10–R12) | R11: two `woff2` fonts preloaded via `Link` on every page (Inter, Syne); Lighthouse's simulated LCP on public routes waits on them. R12: `/hdri/*.hdr` served `Cache-Control: public, max-age=0`, 1.68 MB each. R10: LCP on `/dashboard` 3.3 s, `/ai-lab` 5.9 s (both gated, so they never appear in search, but CrUX origin-level data includes them) | Part 1, measured before/after with the perf harness: R11 (preload only the display weight above the fold, or `display: optional` — visual trade-off, your call), R12 (versioned file names + `max-age=31536000, immutable` via `next.config` headers; defer loading on mobile after first paint), R10 if it stays small (static greeting markup on `/ai-lab`; server-render the dashboard header) | — | open (Part 1) |
| SEO-19 | P1 | Data sources and licence | `src/lib/periodic-table/elements.ts` and `src/lib/molecules/data.ts` cite **no source**. Atomic masses look like IUPAC abridged standard atomic weights (He 4.003, C 12.011) — **needs your confirmation**. Element descriptions and molecule "fun facts" are hand-written and unsourced. Element photos are loaded at runtime from the Wikipedia REST API; the UI links the article, but the image's own Commons licence/author is not shown | Before any of this becomes citeable content: name the source per data set, check licence compatibility, add a visible "Sources" note. Commons images: show licence + author from the image's file page, or link the file page. Facts on new pages flagged for your review | — | open (Part 2, D4/D5) |
| SEO-20 | P0 | Site URL / fail-closed indexing | No site-URL setting. `FRONTEND_URL` exists (server-side, validated at start). Vercel adds `X-Robots-Tag: noindex` to preview deployments automatically, but not to a custom domain on a non-production branch | One setting (D3). Unset, non-https or invalid → `noindex, nofollow` meta + `X-Robots-Tag: noindex` on every page, robots.txt `Disallow: /`, empty sitemap. Also noindex when `VERCEL_ENV` is set and is not `production`. `check:config` warns when unset in production | — | open (Part 1) |
| SEO-21 | P1 | Accuracy of shown data | `estimateElectronShells()` fills shells 2-8-18-32…; correct for light elements, wrong from potassium on (K → 2, 8, 9; real 2, 8, 8, 1; Fe → 2, 8, 16; real 2, 8, 14, 2). It drives the orbit animation | Fine as a visual; it must **not** be stated as a fact on indexable element pages or in structured data. Optional: label it "simplified" in the UI | — | open (Part 2) |
| SEO-22 | Note | Internal linking | Navbar and footer link all public sections from every page (server-rendered `<a href>`). No breadcrumbs, no links between related content (molecule ↔ element ↔ reaction), all molecule links are query URLs | Part 2: detail pages (if D4/D5) with related links and breadcrumbs | — | — |
| SEO-23 | Note | Images / alt text | No `<img>` in any server HTML; icons are inline SVG. The one runtime image (Wikipedia element photo) has an `alt`. Canvas scenes have no text alternative | Short visible captions/descriptions next to the 3D canvases (Part 1–2), no hidden text | — | — |

## 3. Decisions for you

### D1 — i18n URL strategy

The 12 locales are a client-side dictionary keyed by `localStorage`; every URL serves English HTML. Google
"recommends using different URLs for each language version" rather than cookies or browser settings, and its crawler
"sends HTTP requests without setting `Accept-Language`". hreflang therefore needs one URL per locale.

| Option | What it means | For | Against |
| --- | --- | --- | --- |
| **A. English-only indexing** (recommended for launch) | Keep the client-side switcher; index English URLs only; no hreflang | Zero routing change, no risk to gating or CSP; consistent signals | No non-English search visibility |
| B. Locale-prefixed routes (`/tr/explore`, …) | `[locale]` segment over all public routes, locale from URL, hreflang + `x-default`, localized server-rendered metadata, sitemap × 12 | The only way to rank in other languages | Large change touching every route, link and the proxy (`PROTECTED_PREFIXES` must also match `/tr/dashboard` — security-sensitive); **924 machine-translated strings await native review** (LAUNCH_CHECKLIST §7): indexing unreviewed machine translation at scale is a quality risk (Google's scaled-content policy names automated "translating" used to generate many pages) |
| C. Cookie / Accept-Language on the same URL | Server picks the language per request | Small change | Google advises against it; crawlers see one language anyway; no hreflang possible |

Recommendation: **A now**; B after launch for locales that have passed native review, one locale at a time.

### D2 — AI-crawler policy (default: **undecided**)

Each robots.txt group is independent (OpenAI: blocking `GPTBot` does not remove ChatGPT search visibility).

| Token | Operator | Purpose (official docs) | Honours robots.txt |
| --- | --- | --- | --- |
| `GPTBot` | OpenAI | content that may train foundation models | yes |
| `OAI-SearchBot` | OpenAI | surfaces sites in ChatGPT search | yes |
| `ChatGPT-User` | OpenAI | fetches on a user's request | "may not apply" |
| `ClaudeBot` | Anthropic | content that may train models | yes |
| `Claude-SearchBot` | Anthropic | search relevance/indexing | yes |
| `Claude-User` | Anthropic | fetches on a user's request | yes (Anthropic: all its bots honour robots.txt) |
| `Google-Extended` | Google | control token (no own crawler): Gemini **training and grounding**; "does not impact a site's inclusion in Google Search" and is "not used as a ranking signal". AI Overviews / AI Mode follow normal Googlebot rules | yes |
| `PerplexityBot` | Perplexity | surfaces and links sites in Perplexity search; "not used to crawl content for AI foundation models" | yes |
| `Perplexity-User` | Perplexity | user-requested fetches | "generally ignores robots.txt" |
| `CCBot` | Common Crawl | open web crawl dataset (widely used for training by third parties) | opt-out documented via robots.txt |

| Option | robots.txt | For | Against |
| --- | --- | --- | --- |
| 1. Allow all | no AI groups | Maximum presence in AI answers and future models | Content may be used for training |
| 2. Allow search, block training | allow `OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot` (and the user agents); disallow `GPTBot`, `ClaudeBot`, `CCBot`; `Google-Extended` your choice | Keeps citation/visibility in ChatGPT, Claude and Perplexity search; opts out of training | Blocking `Google-Extended` also removes **grounding** in Gemini apps; some user-triggered fetchers ignore robots.txt anyway |
| 3. Block all AI | disallow every token above | Strongest opt-out signal | Likely invisible in AI search answers; voluntary protocol only |

robots.txt is advisory; it is not access control. The policy lives in one constant in `robots.ts`.

### D3 — Production site URL (fail-closed)

| Option | For | Against |
| --- | --- | --- |
| a. `NEXT_PUBLIC_SITE_URL` (your suggestion) | Familiar convention | Inlined at build: a build cannot be promoted between environments with another value; nothing on the client needs it |
| **b. Server-only `SITE_URL`** (recommended) | Read per request (every page is dynamic already); `robots.ts`, `sitemap.ts`, metadata and JSON-LD are all server code; `check:config` can require it to equal `FRONTEND_URL` | `robots.ts`/`sitemap.ts` must be forced dynamic so a build without it does not bake in `noindex` |

Either way: indexing only when the value is a valid `https` origin and (on Vercel) `VERCEL_ENV=production`;
otherwise noindex everywhere (SEO-20).

### D4 — Per-element pages (`/periodic-table/<symbol>`, 118 pages)

Potentially the highest-value content, but **not with today's data**: each element has name, symbol, number, mass,
category, period, group and one hand-written sentence. 118 pages of that are thin, templated pages — the pattern
Google's spam policies describe as scaled content. Worth doing only with a vetted dataset (electron configuration,
electronegativity, melting/boiling point, discovery, uses) from a source whose licence permits reuse and is shown on the
page (candidates to check: PubChem's periodic-table data, NIST; licence **not yet verified**), with your review of the
text. Options: (i) defer (recommended for this phase), (ii) build with a vetted dataset you approve (larger: data
import + review), (iii) no element pages.

### D5 — Per-molecule pages (`/molecules/<id>`, 15 pages)

Feasible now: each molecule already has a description, formula, molar mass, state, melting/boiling point, bond
types, uses and facts (`src/lib/molecules/data.ts`), and `/explore?molecule=<id>` already renders them server-side.
Server-rendered detail pages with a link into the 3D Explore view, breadcrumbs and related reactions would replace
the query URLs as canonical targets (SEO-03). The facts need your review and sources (SEO-19). Options: (i) build
them in Part 2 (recommended), (ii) keep `/explore?molecule=` and canonicalise to `/explore`.

### D6 — Trust pages content

Who publishes the site (person or company, country), a contact address, privacy policy content (data collected:
account, Google sign-in, Lemon Squeezy as merchant of record, Resend email, Gemini prompts, retention), terms and
refund wording. I can build the pages and a structure; the facts and legal text must come from you (or a template you
choose), I will not invent them.

### D7 — Smaller choices

* Icon: provide a logo, or let me derive a simple icon from the existing Atom mark.
* R11 fonts: `display: optional` (no late font swap; first visit may show the fallback font) vs preloading only the
  display weight.
* `/learn` and `/showcase`: noindex (recommended) or remove from navigation until ready.
* `llms.txt`: an unofficial proposal ("open for community input", not a standard). None of OpenAI, Anthropic or
  Google documents reading it; Google says "You don't need to create new machine readable files, AI text files, or
  markup" for AI Overviews/AI Mode. Cost is trivial; I would add it only labelled as unproven, or skip it.

## 4. Proposed plan

| Part | Scope (recommended) | Findings |
| --- | --- | --- |
| **1 — technical** (`seo/technical`) | Site-URL setting with fail-closed noindex; `robots.ts` (D2); `sitemap.ts` (public routes, no `lastmod`); per-route static metadata, title template, canonical; OG/Twitter + one generated share image; noindex on auth, gated and coming-soon pages, `X-Robots-Tag` on the auth redirect; custom `not-found.tsx`; heading fixes; Explore/login intro outside the Suspense boundary; icons + manifest; remove template SVGs; R11 + R12 (+ R10 if small) with before/after numbers from the perf harness | 01–09, 12–14, 18, 20 |
| **2 — structured data, AEO, GEO** (`seo/aeo-geo`) | JSON-LD (`WebSite`, `Organization`, `WebApplication` + offers, `BreadcrumbList`) with CSP checked in a browser; answer-first intro + real FAQ section on public pages (FAQ markup optional: rich results ended May 2026); molecule pages (D5); source attribution (SEO-19); trust pages (D6); `llms.txt` only if D7 says yes | 10, 13, 16, 19, 21, 22 |
| **3 — launch checklist** (`seo/launch`) | `SEO_LAUNCH_CHECKLIST.md`, consistent with `LAUNCH_CHECKLIST.md` | 15 and everything live-only |

Tests added with the fixes: robots and sitemap output (allowed and fail-closed), no gated/auth route in the sitemap,
`noindex` present on gated/auth/coming-soon routes, canonical/title present and unique on indexable routes, `<title>` in
`<head>` for AI-crawler user agents, CSP header unchanged. Out of scope unless you ask: locale routes (D1-B), element
pages (D4-ii), analytics.

## 5. Sources (read 2026-10-26)

* Google: [robots.txt intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro) ·
  [Build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) ·
  [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) ·
  [Multi-regional and multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites) ·
  [Common crawlers (Google-Extended)](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) ·
  [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) ·
  [Site names](https://developers.google.com/search/docs/appearance/site-names) ·
  [Software app structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app) ·
  [FAQ structured data / changelog](https://developers.google.com/search/docs/appearance/structured-data/faqpage) ·
  [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies) ·
  [OAuth app branding requirements](https://support.google.com/cloud/answer/13464321)
* OpenAI: [Overview of OpenAI crawlers](https://developers.openai.com/api/docs/bots)
* Anthropic: [Does Anthropic crawl data from the web?](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
* Perplexity: [Perplexity crawlers](https://docs.perplexity.ai/guides/bots) · Common Crawl: [CCBot](https://commoncrawl.org/ccbot)
* [llms.txt proposal](https://llmstxt.org/) · Meta: [Images in link shares](https://developers.facebook.com/docs/sharing/webmasters/images/)
* Vercel: [Are preview deployments indexed?](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines) ·
  Lemon Squeezy: [Activate your store](https://docs.lemonsqueezy.com/help/getting-started/activate-your-store)
* Next.js 16.4.3 bundled docs: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`
  (streaming metadata), `…/05-config/01-next-config-js/htmlLimitedBots.md`, `01-app/02-guides/json-ld.md`,
  `…/03-file-conventions/01-metadata/{robots,sitemap,manifest,opengraph-image}.md`
* FAQ rich-result end date (May 7, 2026): read from Google's FAQ page/changelog via a fetch summary and consistent
  secondary coverage; re-check the changelog before relying on the date.
