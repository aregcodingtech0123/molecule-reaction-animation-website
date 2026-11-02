# SEO launch checklist (Part 3)

**Who runs this:** the project owner, by hand, after (or alongside) [`../ops/LAUNCH_CHECKLIST.md`](../ops/LAUNCH_CHECKLIST.md). Tick each box
(`- [ ]` → `- [x]`) and stop at the first line that does not match its "Expected".

**What it covers — only what cannot be checked before launch:** the canonical host and its redirects (finding SEO-15), the search signals
on the *live* origin, Google Search Console and Bing, social link previews, Core Web Vitals field data, what to look at in weeks 1–12, and how
to hide the site again. Everything that *can* be tested offline is already tested (`npm run test:seo`, `tests/unit/seo/*`) and is not repeated.

**How it fits `LAUNCH_CHECKLIST.md` (this file does not duplicate it):**

| This file | Builds on `LAUNCH_CHECKLIST.md` |
| --- | --- |
| §1 content and configuration gates | §1.4 environment variables (`SITE_URL`), §1.5 `check:config`, §1.6 `check:launch-content` and legal review, §1.7 translations |
| §2 canonical host and redirects | §A hosting (`FRONTEND_URL` exactness, Vercel), §4.0 headers (HSTS) |
| §3 the live-origin check | §4.0 "Search signals (SEO-20)" — the same checks, automated, plus every sitemap URL |
| §4–§6 Search Console, Bing, previews | §4 first live verification, §5.4 outside the services |
| §7 field data and weeks 1–12 | §5 monitoring |
| §8 hiding the site again | §6 secrets, incidents, rollback |
| Go / no-go (end of this file) | "Go / no-go" at the end of `LAUNCH_CHECKLIST.md` |

> **Convention.** `<site>` is the canonical origin (`SITE_URL` = `FRONTEND_URL`, https, no path); `<other>` is every other hostname that
> reaches the app. Facts about Vercel, Google, Bing and the share debuggers were read from their **official documentation on 2026-11-02**
> (sources at the end). Anything the documents do not say is marked **(not documented)** or **(unverified)** — do not treat it as a promise.
> Search engines decide what they index and when; **none of this guarantees a ranking or even an index entry**.

---

## 1. Gates before the site is public (content and configuration)

The site is fail-closed: unless `SITE_URL` is a valid https origin **and** the deployment is Vercel's production one, every page is `noindex`,
`robots.txt` says `Disallow: /` and the sitemap is empty (SEO-20). So there is no way to launch visible by accident — and no way to launch
visible by forgetting these gates:

- [ ] **`npm run check:launch-content` exits 0** (`LAUNCH_CHECKLIST.md` §1.6). Until you set the **14 required variables** (`SITE_OWNER_*` on the web host) it exits 1 and names them. While any remains, `/about`, `/contact`, `/privacy`, `/terms` are `noindex` and out of the sitemap and no
      `Organization` JSON-LD is emitted — that is the intended *soft launch* state, **not** an error. Decide which you want:
      *(a)* launch now with draft trust pages (20 sitemap URLs), or *(b)* set the required owner variables first (24 URLs).
- [ ] If *(b)*: a lawyer has reviewed `/privacy` and `/terms` (§1.6), and the three declarations are set **only when true**:
      `SITE_OWNER_SIGNUP_IP_PURGE_JOB`, `SITE_OWNER_ACCOUNT_DELETION_JOB` (§5.1 jobs scheduled, both alerts exist) and `SITE_OWNER_EMAIL_TOMBSTONE_GUARD` (`enabled …` / `disabled …`,
      matching `EMAIL_TOMBSTONE_GUARD`).
- [ ] `npm run check:config` passes with the production values, including **`SITE_URL` equal to `FRONTEND_URL`** (§1.5). A `SITE_URL` that differs
      is a `PROBLEM`: canonical URLs and the sitemap would name a host that is not the app's public origin.
- [ ] Decisions already taken stay as they are (`SEO_FINDINGS.md` §6): **English-only indexing** (no `hreflang`, no locale URLs — D1; the
      language switcher must not create crawlable duplicates), **all crawlers allowed** (D2), **no per-element pages** (D4), **no `llms.txt`** (D7).
- [ ] Source attribution is visible on the live pages (not only in this repo): the periodic-table page names NIST (and the classification and IUPAC
      sources), each molecule page names PubChem where its 3D model or data comes from, `/about` lists the sources. `DATA_REVIEW.md` §5 has the licence terms.
- [ ] Native translation is done or consciously deferred (`LAUNCH_CHECKLIST.md` §1.7). It does **not** block English-only indexing.

## 2. Canonical host and redirects (SEO-15)

**Why.** `www.<domain>`, `<domain>`, `http://…` and the `*.vercel.app` URL can all reach the same pages. Google: *"Pick one of those URLs as your canonical URL,
and use redirects to send traffic from the other URLs to your preferred URL."* Redirects are *"a strong signal that the target of the redirect should become
canonical"*; `rel="canonical"` (which every page here already emits, pointing at `SITE_URL`) is the weaker second signal
([consolidate duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)). The app also *requires* one host: every
POST/PUT/PATCH/DELETE is compared with `FRONTEND_URL` and refused with `403 CSRF_REJECTED` from any other origin (`LAUNCH_CHECKLIST.md` §A).

**Decide once, before DNS:**

| Choice | For | Against |
| --- | --- | --- |
| `www.<domain>` canonical, apex redirects to it | Vercel: *"We recommend using the `www` subdomain as your primary domain, with a redirect from the non-`www` domain to it."* Subdomains use a `CNAME`, apex needs an `A` record | — |
| apex canonical, `www` redirects to it | shorter URL | the apex needs an `A` record at your DNS provider; same redirect work |

Google states no preference ("pick one"). Whatever you choose becomes `SITE_URL` **and** `FRONTEND_URL` **and** the Google OAuth origin, the Lemon redirect
URL and every link you publish.

- [ ] Both hostnames are added to the Vercel project (Project Settings → **Domains**); adding the apex prompts for `www` (Vercel docs).
- [ ] DNS: the records **shown in your project's Domains settings** (Vercel's docs use `76.76.21.21` only as an example `A` value — use the dashboard's value;
      subdomains use the project's `CNAME`; nameservers are the alternative). Propagation: Vercel says *"it can be normal to take up to 24-48 hours"*.
- [ ] Certificates: Vercel generates one per domain automatically once DNS validates (Let's Encrypt; renewed 14–30 days before expiry). Open both
      `https://<site>/` and `https://<other>/` and confirm a valid certificate before anything else.
- [ ] Redirect set in the dashboard: Project Settings → Domains → **Edit** on `<other>` → **Redirect to** `<site>`.
- [ ] **Check the redirect type — Vercel's pages do not say which status code this dashboard redirect uses (not documented).** Google treats `301`/`308` as
      permanent (*"Show the new redirect target in search results"*) and `302`/`307` as temporary (*"the indexing pipeline doesn't use the redirect as a signal
      that the redirect target should be canonical"*). Run:

      ```bash
      curl -sI "http://<other>/explore?molecule=water"  | grep -iE '^(HTTP|location)'
      curl -sI "https://<other>/explore?molecule=water" | grep -iE '^(HTTP|location)'
      curl -sI "http://<site>/explore?molecule=water"   | grep -iE '^(HTTP|location)'
      ```

      Expected: each ends on `https://<site>/explore?molecule=water` (path **and** query kept), in **at most 3 hops** (Google: *"ideally no more than 3 and
      fewer than 5"*), with `301`/`308` on the redirecting hop. Vercel forwards plain HTTP to HTTPS itself with a `308` and *"can't be disabled"*.
      Or let the script do it: `npm run check:live-seo -- https://<site> --variant http://<other>/ --variant https://<other>/ --variant http://<site>/` (§3) —
      a `307`/`302` is reported as a **WARN**.
- [ ] If the redirect turns out to be temporary (`307`/`302`): either accept it (the canonical tags and the sitemap still point to `<site>`; the signal is weaker),
      or replace it with a permanent one. Vercel documents a hostname-scoped permanent redirect in `vercel.json` (`"permanent": true` = `308`):
      ```json
      { "redirects": [ { "source": "/:path*", "has": [ { "type": "host", "value": "<other-host-as-regex>" } ], "destination": "https://<site>/:path*", "permanent": true } ] }
      ```
      Not committed here because it names your domain. (A host redirect in the app's own `src/proxy.ts` would also work; it is a code change and needs your go.)
- [ ] **The production `*.vercel.app` URL** serves the same pages. The documents do not say whether it stays reachable (**not documented**), so test it:
      `curl -sI https://<project>.vercel.app/ | grep -iE '^(HTTP|location|x-robots-tag)'`. Vercel's options: a hostname-scoped permanent redirect to `<site>` (the
      `vercel.json` form above with the `*.vercel.app` host), or keep both with the canonical tag. Recommended: the redirect — Vercel notes *"Duplicate URLs don't
      automatically incur a search penalty, but they can split signals and make search engines choose a different canonical URL."* Note that a POST from the
      `vercel.app` host is refused by the CSRF check anyway.
- [ ] **Preview deployments** are `noindex` by Vercel (`X-Robots-Tag: noindex`). Vercel *omits* that header when a **custom domain is assigned to a non-production
      branch** — the app's own gate covers it (indexing requires `VERCEL_ENV=production`; the E2E asserts it). Never assign the production domain to a preview.
- [ ] HSTS: the app sends `max-age=63072000; includeSubDomains` in production (§4.0). Vercel adds HSTS per custom subdomain only. Every subdomain of the domain
      (`api.<domain>`, `mail.<domain>` for web content, …) must serve https before launch — `LAUNCH_CHECKLIST.md` §A. No `preload` (hard to undo).

## 3. Verify the live origin (run this right after the production deploy)

`npm run check:live-seo` (`scripts/seo/verify-live.mjs`) is read-only (GET only, one request at a time, no cookies) and checks, for the real origin:

* `robots.txt`: 200, **no `Disallow: /`**, `Disallow: /api/`, `Sitemap: <site>/sitemap.xml`, no noindex header;
* `sitemap.xml`: 200, XML, every URL on `<site>`, no duplicates, the public pages present, **no login / gated / coming-soon / API URL**;
* **every sitemap URL**: status 200, no `X-Robots-Tag: noindex`, no `meta robots noindex`, exactly one `<title>`, exactly one canonical equal to the page itself,
  exactly one `<h1>`, a meta description, Open Graph title and image, `lang="en"`, **titles and descriptions unique across pages**;
* JSON-LD on each page: valid JSON, `@context` schema.org, only `WebSite` / `WebApplication` / `Organization` / `BreadcrumbList` (no `FAQPage`, no ratings);
  `WebSite` on `/` with the canonical URL; a three-item `BreadcrumbList` on each molecule page; `Organization` only when the trust pages are real;
* the first two pages fetched as **GPTBot, ClaudeBot and PerplexityBot** have title and canonical inside `<head>` (SEO-12 — they do not wait for streamed metadata);
* login/sign-up/reset/verify and the coming-soon pages answer 200 **with `noindex`**; `/dashboard`, `/ai-lab`, `/profile` redirect a signed-out visitor to `/login`;
  an unknown URL is a real **404** with `noindex` and one title; `/explore/` is a `308` to `/explore`;
* with `--variant`: the redirect checks of §2.

```bash
npm run check:live-seo -- https://<site> --trust no  --variant http://<other>/ --variant https://<other>/
#   --trust no      the four trust pages are still drafts (20 sitemap URLs)   --trust yes  they are indexable (24 URLs)   --trust either  don't care
```

- [ ] Exit 0, no `FAIL` line. **Expected size:** `sitemap size - 20 URLs` with draft trust pages, **24** once `check:launch-content` passes (home, explore, atom-models,
      periodic-table, pricing, molecules, 14 molecule pages — plus about, contact, privacy, terms).
- [ ] Any `WARN` is understood (a temporary redirect, §2).
- [ ] A `FAIL` on robots/sitemap/noindex means `SITE_URL` is wrong or the deployment is not Vercel's production one (§8 says how to read each failure).
- [ ] Open `https://<site>/` in a normal browser with DevTools → Console: **no CSP violation** (`Refused to execute inline script …`) on `/`, `/molecules/water`,
      `/periodic-table` — the JSON-LD blocks and the nonce CSP coexist, but only a browser proves it on the live host.
- [ ] Structured data: paste `https://<site>/` and a molecule page into the [Schema Markup Validator](https://validator.schema.org/) (Google: *site names aren't supported in
      the Rich Results Test*; use a schema validator for `WebSite`). Google's software-app rich result is **not reachable** (it needs ratings, which do not exist — SEO-16);
      don't expect rich results, and don't add markup to chase them. Google: *"Don't mark up content that is not visible to readers of the page."*

## 4. Google Search Console

- [ ] Add a **Domain property** for `<domain>` (covers `www`, apex, http and https in one property). Google: it *"requires you to verify ownership using DNS record verification"*,
      and *"To stay verified, don't remove the DNS record from your provider, even after verification succeeds."* A manually added record can take *"up to two or three days"* to be served.
      (A URL-prefix property for `https://<site>/` can be verified by HTML file or tag, but covers only that prefix.)
- [ ] **Sitemaps** → submit `https://<site>/sitemap.xml`. Expected status **Success** (*"All URLs will be queued for crawling"*). *Couldn't fetch* has documented causes:
      blocked by robots.txt, wrong URL (404), low crawl demand. Google: submitting is *"merely a hint"* and *"There is no guarantee that a page URL discovered in a sitemap has been or will be crawled or indexed"*.
      No `lastmod` is published on purpose (no reliable per-page date).
- [ ] **URL Inspection** on `https://<site>/` and one molecule page → *Test live URL* → "URL is available to Google". Optionally **Request indexing** for those two only: there is *"a daily limit"*,
      it does not guarantee indexing (*"URL is on Google" doesn't actually guarantee that your page will appear in Search results*), and Google says *"When you add new content, it can take a few days for Google to index it. You can reduce the indexing lag by requesting indexing."* (**the exact quota is not documented**).
      Do not request indexing for every page, and do not resubmit repeatedly.
- [ ] Review who has access to the property (only people you trust).
- [ ] Optional: link Search Console with nothing else. The privacy policy says there is **no analytics** on the site; Search Console (data from Google Search itself) is the only
      traffic view you will have — keep that statement true unless you also change the policy.

## 5. Bing

- [ ] Add the site in Bing Webmaster Tools and submit the same `https://<site>/sitemap.xml`. **(unverified)** — Bing's onboarding pages could not be read in this review
      (the pages returned no help text), so the steps, the Search Console import and Bing's handling of robots/noindex are not confirmed here. Nothing in the app is Bing-specific;
      Bingbot is on Next.js's list of crawlers that receive complete HTML.
- [ ] IndexNow is **optional** and not implemented: it needs a key file hosted at the site root and a call per change (documented at indexnow.org; no statement there that it is mandatory).
      Skip it for launch.

## 6. Link previews (share cards)

The share image is generated by the app (`/opengraph-image`, 1200 × 630, product name and tagline only; no claim, rating or statistic).

- [ ] `curl -s https://<site>/ | grep -oE '<meta property="og:[^>]*>'` shows `og:title`, `og:image` (an `https://<site>/…` URL), `og:url`/`og:description`; open the `og:image` URL: **200, `image/png`, 1200 × 630**.
- [ ] Meta/Facebook (needs a Facebook login): run `https://<site>/` through the **Sharing Debugger** once to pre-cache. Documented: images *"are cached based on the URL and won't be updated unless the URL changes"*;
      at least 600 × 315 (1200 × 630 recommended), at most 8 MB, close to 1.91:1; the crawler needs gzip/deflate.
- [ ] LinkedIn: image at least 1200 × 627, at most 5 MB, ratio 1.91:1; `og:title`, `og:image`, `og:description`, `og:url` must exist. *If the image does not appear, "your website may be blocking us
      from pulling the image"* — `robots.txt` here does not. The LinkedIn **Post Inspector** page and its cache-refresh behaviour could not be read **(unverified)**.
- [ ] X (Twitter): **(unverified)** — X's card documentation returned `402` to the fetch used for this review. The app emits `twitter:card = summary_large_image` (tested); confirm by posting the link.
- [ ] If you ever change the share image, the platforms keep the old one per URL until refreshed — change the image URL or refresh in each debugger.

## 7. Field data and what to look at, week by week

Lab numbers are in `CWV_RESULTS.md` (public routes, mobile simulated slow 4G: LCP ≈ 3.6 s simulated / 0.3–0.5 s observed, CLS 0; fonts and the HDRI cache were measured and the
fonts left unchanged on evidence). **Field data does not exist for a new site** and cannot be produced by you.

- [ ] PageSpeed Insights (`https://pagespeed.web.dev/` for `https://<site>/`): lab data (Lighthouse) appears at once. Field data comes from CrUX and needs *"sufficient number of distinct samples"* —
      for a new page PSI *"will fall back to origin-level granularity"*, and may show nothing at all.
- [ ] Search Console → **Core Web Vitals** needs the same real-user data; it *"must have a minimum amount of data to be shown"* (the minimum is **not documented**), reports a **28-day** window, and after a new
      property is created *"it can take a few days"* before existing data is posted. "No data available" for the first weeks is normal, not a fault.

| When | Look at | What is normal / what to do |
| --- | --- | --- |
| Day 0 | `npm run check:live-seo` (§3), Search Console sitemap status | all green; sitemap **Success** |
| Day 1–3 | URL Inspection of `/` and `/molecules/water` | "URL is available to Google" (live test). Not yet *on* Google is normal |
| Week 1–2 | Page indexing report | Google: *"It can take a week or so for Google to start crawling and indexing a new page or site."* "Discovered – currently not indexed" and "Crawled – currently not indexed" are statuses, not errors; *"Non-indexed URLs can be fine."* Only act on **unexpected** reasons, e.g. a *noindex* on a page that should be indexed (→ §8) |
| Week 4 | Page indexing: how many of the 20/24 sitemap URLs are indexed; Performance report (impressions/queries) | Google: *"you likely want to wait a few weeks to assess whether your work had beneficial effects"*. Expect the home page and the molecule pages first. `/login`, `/signup`, `/learn`, `/showcase` must show as not indexed because of `noindex` (the report's label is *URL marked "noindex"*) — that is correct |
| Week 4–8 | Core Web Vitals report, PSI field data | first real-user numbers; compare with `CWV_RESULTS.md`; a regression is a new performance task, not an SEO fix |
| Week 8–12 | Branded query ("Molecule Architecture Studio") and molecule-name queries; site name in results | Google supports one site name per site from `WebSite` structured data, but doing so is not guaranteed. Re-run `check:live-seo` after every deploy that touches routes, metadata or `site-owner.ts` |

**After any release that changes pages:** `npm run check:live-seo -- https://<site> --trust <yes|no>`; if you add a page, classify it in `src/lib/seo/routes.ts` (the unit test fails otherwise)
so it cannot silently become indexable or miss the sitemap.

## 8. Hiding the site again, and reading a failed check

- **Fast, safe hide (fail-closed):** unset `SITE_URL` on the production web service (or change it to a non-https value) and redeploy. Every page then answers `noindex, nofollow`,
  `robots.txt` says `Disallow: /`, the sitemap is empty. `check:config` will call that a `PROBLEM` — expected. This takes effect **when each page is next crawled**; pages already in the index
  stay until then. A temporary removal tool exists in Search Console **(not covered by the documents read for this checklist)**.
- **Never** put `Disallow: /` in robots.txt to hide *already indexed* pages while keeping them crawlable — Google must be able to fetch a page to see its `noindex`.
- **Reading `check:live-seo` failures**

| FAIL | Likely cause | Fix |
| --- | --- | --- |
| robots blocks the whole site / sitemap empty / `noindex` on every page | `SITE_URL` unset, not https, or the deployment is not `VERCEL_ENV=production` | `LAUNCH_CHECKLIST.md` §1.4; redeploy the **production** deployment |
| sitemap or canonical names another host | `SITE_URL` ≠ the host you are checking | set `SITE_URL` = the canonical origin; or check the canonical host |
| trust pages missing (`--trust yes`) | a required `SITE_OWNER_*` variable is empty or invalid on the web host (`npm run check:launch-content` names it) | §1 |
| title/canonical not in `<head>` for an AI crawler | the crawler is not in Next's HTML-limited list (SEO-12) | `htmlLimitedBots` config; see `SEO_FINDINGS.md` |
| `FAQPage`/unknown JSON-LD type | someone added markup | remove it, or update the allowed list deliberately |
| gated page answers 200 | the proxy matcher changed | security issue — `src/proxy.ts`, `PROTECTED_PREFIXES` |

## 9. Known limits (accepted)

* English-only indexing; the 924 machine-translated UI strings and the English-placeholder molecule statements await native review (`LAUNCH_CHECKLIST.md` §1.7).
* 118 per-element pages are not built (thin data); molecule pages are (14).
* No `llms.txt`, no analytics, no hreflang, no `lastmod`, no IndexNow.
* Every HTML response is `Cache-Control: private, no-cache, no-store` (per-request CSP nonce): no CDN caching of HTML (SEO-17).
* The social-card checks for X and LinkedIn's Post Inspector, and Bing's onboarding, are **unverified** (documents unreadable in this review).

## Go / no-go (SEO)

Launch **visible** only when all of these are true; otherwise leave `SITE_URL` as is (the site is hidden by design):

- [ ] §1: `check:config` passes; the trust-page decision is made (soft launch with drafts, or the owner variables set and reviewed).
- [ ] §2: one canonical host chosen; the other hostnames and `http://` redirect to it (permanent, ≤ 3 hops, path and query kept — or the temporary type is accepted knowingly); the `*.vercel.app` question is answered.
- [ ] §3: `npm run check:live-seo` exits 0 against the production origin, and the browser console shows no CSP violation on `/` and a molecule page.
- [ ] §4: Search Console Domain property verified (the DNS record stays), sitemap shows **Success**.
- [ ] §6: `og:image` loads at 1200 × 630.
- [ ] You know §8: how to hide the site again, and that indexing takes weeks and is not guaranteed.

---

## Sources (read 2026-11-02 unless noted)

* **Vercel:** [Deploying and redirecting domains](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting) · [Add a domain](https://vercel.com/docs/domains/add-a-domain) ·
  [Working with DNS](https://vercel.com/docs/domains/working-with-dns) · [Working with SSL](https://vercel.com/docs/domains/working-with-ssl) ·
  [Encryption (HTTP→HTTPS 308, HSTS)](https://vercel.com/docs/cdn-security/encryption) · [Redirects (status codes, `*.vercel.app` duplicates)](https://vercel.com/docs/routing/redirects) ·
  [Are preview deployments indexed?](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines) · [System environment variables (`VERCEL_ENV`)](https://vercel.com/docs/environment-variables/system-environment-variables)
* **Google:** [301/308 and 302/307 redirects](https://developers.google.com/search/docs/crawling-indexing/301-redirects) · [Consolidate duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) ·
  [Site move with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes) · [Add a property](https://support.google.com/webmasters/answer/34592) ·
  [Verify ownership](https://support.google.com/webmasters/answer/9008080) · [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) ·
  [Sitemaps report](https://support.google.com/webmasters/answer/7451001) · [URL Inspection](https://support.google.com/webmasters/answer/9012289) ·
  [Page indexing report](https://support.google.com/webmasters/answer/7440203) · [Core Web Vitals report](https://support.google.com/webmasters/answer/9205520) ·
  [CrUX](https://developer.chrome.com/docs/crux) · [Structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) ·
  [Site names](https://developers.google.com/search/docs/appearance/site-names) · [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) ·
  [PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/about)
* **Others:** [IndexNow](https://www.indexnow.org/documentation) · [Meta: sharing for webmasters](https://developers.facebook.com/docs/sharing/webmasters) and
  [images](https://developers.facebook.com/docs/sharing/webmasters/images) · [LinkedIn: make your website shareable](https://www.linkedin.com/help/linkedin/answer/a521928) · [Open Graph protocol](https://ogp.me/)
* Where only a summary of a page was available (the Page-indexing status definitions), this checklist paraphrases instead of quoting; re-read the page before relying on the wording.
