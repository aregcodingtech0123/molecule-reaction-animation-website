/**
 * `npm run check:live-seo -- https://<site>` - checks a LIVE origin the way docs/seo/SEO_LAUNCH_CHECKLIST.md describes (§3, §6):
 * robots.txt, sitemap.xml, the search signals of every sitemap URL (status, robots directives, one title, canonical, h1,
 * description, Open Graph), the JSON-LD blocks, the pages that must stay out of the index, a real 404, and - with --variant -
 * that the other hostnames/protocols redirect to the canonical origin with a permanent redirect.
 *
 *   node scripts/seo/verify-live.mjs <origin> [--variant <url> ...] [--trust yes|no|either] [--canonical-origin <origin>] [--allow-http-localhost]
 *
 * Read-only: only GET requests, a few dozen, one at a time. Prints PASS / WARN / FAIL lines; exit 0 when nothing FAILs
 * (warnings do not fail), 1 when something fails, 64 on a bad argument. It never sends cookies or credentials.
 *
 *  --variant <url>        a URL that must redirect to the canonical origin (repeat it: http://example.com/ , https://www.example.com/ ...)
 *  --trust yes|no|either  are the four trust pages (about, contact, privacy, terms) expected to be indexable (yes: after
 *                         check:launch-content passes), still drafts (no), or either is fine (default)
 *  --canonical-origin     the origin the pages must name in canonical/sitemap/JSON-LD when it differs from the one fetched
 *                         (for a rehearsal against a local production server started with SITE_URL=https://studio.example)
 *  --allow-http-localhost accept http://localhost or http://127.0.0.1 as the origin (rehearsal only)
 */
import { pathToFileURL } from "node:url";

export const REQUIRED_IN_SITEMAP = ["/", "/explore", "/atom-models", "/periodic-table", "/pricing", "/molecules"];
export const TRUST_PATHS = ["/about", "/contact", "/privacy", "/terms"];
/** Never in the sitemap, never indexable. */
export const NOINDEX_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/learn", "/showcase"];
/** Signed-in areas: a signed-out visitor is redirected to /login. */
export const GATED_PATHS = ["/dashboard", "/ai-lab", "/profile"];
const NEVER_LISTED = [...NOINDEX_PATHS, ...GATED_PATHS, "/api"];
const ALLOWED_LD_TYPES = new Set(["WebSite", "WebApplication", "Organization", "BreadcrumbList"]);

const UA = {
  check: "Mozilla/5.0 (compatible; MoleculeStudioSeoCheck/1.0)",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
  claudebot: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  perplexity: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};

/** Attribute maps of every <tag ...> in the html (case-insensitive names, quoted values). */
function tags(html, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = are.exec(m[1]))) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? "";
    out.push({ attrs, index: m.index });
  }
  return out;
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const count = (html, re) => (html.match(re) ?? []).length;

export function analysePage(html) {
  const headEnd = html.search(/<\/head>/i);
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  const metas = tags(html, "meta");
  const metaByName = (n) => metas.filter((m) => (m.attrs.name ?? "").toLowerCase() === n);
  const metaByProp = (p) => metas.filter((m) => (m.attrs.property ?? "").toLowerCase() === p);
  const canonicals = tags(html, "link").filter((l) => (l.attrs.rel ?? "").toLowerCase() === "canonical");
  const robots = metaByName("robots").map((m) => (m.attrs.content ?? "").toLowerCase());
  const ld = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  return {
    titleCount: titles.length,
    title: titles[0] ? decode(titles[0][1]).trim() : "",
    titleInHead: titles.length > 0 && headEnd >= 0 && (titles[0].index ?? Infinity) < headEnd,
    canonicalHrefs: canonicals.map((c) => c.attrs.href ?? ""),
    canonicalInHead: canonicals.length > 0 && headEnd >= 0 && canonicals[0].index < headEnd,
    robots,
    noindexMeta: robots.some((r) => /noindex/.test(r)),
    description: (metaByName("description")[0]?.attrs.content ?? "").trim(),
    ogTitle: metaByProp("og:title")[0]?.attrs.content ?? "",
    ogImage: metaByProp("og:image")[0]?.attrs.content ?? "",
    h1Count: count(html, /<h1[\s>]/gi),
    lang: /<html\b[^>]*\blang=["']([^"']+)["']/i.exec(html)?.[1] ?? "",
    ldBlocks: ld,
  };
}

function usageError(message) {
  const err = new Error(message);
  err.exitCode = 64;
  return err;
}

export function parseArgs(argv) {
  const opts = { origin: "", variants: [], trust: "either", canonicalOrigin: "", allowHttpLocalhost: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--variant") opts.variants.push(argv[++i] ?? "");
    else if (a === "--trust") opts.trust = argv[++i] ?? "";
    else if (a === "--canonical-origin") opts.canonicalOrigin = argv[++i] ?? "";
    else if (a === "--allow-http-localhost") opts.allowHttpLocalhost = true;
    else if (a.startsWith("--")) throw usageError(`Unknown option ${a}`);
    else if (!opts.origin) opts.origin = a;
    else throw usageError(`Unexpected argument ${a}`);
  }
  if (!opts.origin) throw usageError("The origin to check is required, e.g. https://example.com");
  if (!["yes", "no", "either"].includes(opts.trust)) throw usageError("--trust must be yes, no or either");
  if (opts.variants.some((v) => !v)) throw usageError("--variant needs a URL");
  normaliseOrigin(opts.origin, opts, "origin");
  if (opts.canonicalOrigin) normaliseOrigin(opts.canonicalOrigin, { allowHttpLocalhost: false }, "--canonical-origin");
  return opts;
}

function normaliseOrigin(raw, { allowHttpLocalhost }, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw usageError(`${label} is not a URL: ${raw}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(allowHttpLocalhost && local && url.protocol === "http:")) {
    throw usageError(`${label} must be an https origin (got ${url.protocol}//${url.host}).`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw usageError(`${label} must be an origin only (no path, query or fragment).`);
  return url.origin;
}

/**
 * @returns {Promise<{ ok: boolean, results: { level: "pass" | "warn" | "fail", check: string, detail: string }[] }>}
 */
export async function verifyLive(options) {
  const opts = { variants: [], trust: "either", canonicalOrigin: "", allowHttpLocalhost: false, fetchImpl: fetch, delayMs: 0, ...options };
  const origin = normaliseOrigin(opts.origin, opts, "origin");
  const canonical = opts.canonicalOrigin ? normaliseOrigin(opts.canonicalOrigin, { allowHttpLocalhost: false }, "--canonical-origin") : origin;
  const results = [];
  const add = (level, check, detail = "") => results.push({ level, check, detail });
  const pass = (c, d) => add("pass", c, d);
  const fail = (c, d) => add("fail", c, d);
  const warn = (c, d) => add("warn", c, d);
  const expect = (cond, check, okDetail, failDetail) => (cond ? pass(check, okDetail) : fail(check, failDetail));

  async function get(url, { ua = UA.check, redirect = "manual" } = {}) {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const res = await opts.fetchImpl(url, { redirect, headers: { "user-agent": ua, accept: "text/html,application/xml,text/plain,*/*" }, signal: AbortSignal.timeout(20_000) });
    const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
    return { status: res.status, headers: res.headers, body, location: res.headers.get("location") ?? "" };
  }
  const safe = async (check, fn) => {
    try {
      await fn();
    } catch (err) {
      fail(check, `request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const headerNoindex = (h) => /noindex/i.test(h.get("x-robots-tag") ?? "");

  // ---- robots.txt
  await safe("robots.txt", async () => {
    const r = await get(`${origin}/robots.txt`);
    expect(r.status === 200, "robots.txt status", "200", `status ${r.status}`);
    expect(!/^\s*disallow:\s*\/\s*$/im.test(r.body), "robots.txt does not block the whole site", "no `Disallow: /`", "contains `Disallow: /` - the site is hidden from search engines (is SITE_URL set to the production https origin on the production deployment?)");
    expect(/^\s*disallow:\s*\/api\/\s*$/im.test(r.body), "robots.txt keeps /api/ out", "Disallow: /api/", "no `Disallow: /api/` line");
    expect(r.body.includes(`Sitemap: ${canonical}/sitemap.xml`), "robots.txt names the sitemap", `Sitemap: ${canonical}/sitemap.xml`, `no \`Sitemap: ${canonical}/sitemap.xml\` line`);
    expect(!headerNoindex(r.headers), "robots.txt has no noindex header", "", "robots.txt answers X-Robots-Tag: noindex");
  });

  // ---- sitemap.xml
  let sitemapPaths = [];
  await safe("sitemap.xml", async () => {
    const r = await get(`${origin}/sitemap.xml`);
    expect(r.status === 200, "sitemap.xml status", "200", `status ${r.status}`);
    expect(/xml/i.test(r.headers.get("content-type") ?? ""), "sitemap.xml content type", r.headers.get("content-type") ?? "", `content-type ${r.headers.get("content-type")}`);
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
    expect(locs.length > 0, "sitemap.xml lists URLs", `${locs.length} URLs`, "no <loc> entries (an empty sitemap means the site is in fail-closed noindex mode)");
    const offHost = locs.filter((u) => !u.startsWith(`${canonical}/`) && u !== canonical);
    expect(offHost.length === 0, "every sitemap URL is on the canonical origin", canonical, `off-origin: ${offHost.slice(0, 3).join(", ")}`);
    expect(new Set(locs).size === locs.length, "no duplicate sitemap URLs", "", "duplicates present");
    sitemapPaths = locs.map((u) => (u === canonical ? "/" : u.slice(canonical.length)));
    const listed = new Set(sitemapPaths);
    const missing = REQUIRED_IN_SITEMAP.filter((p) => !listed.has(p));
    expect(missing.length === 0, "sitemap has the public pages", REQUIRED_IN_SITEMAP.join(" "), `missing: ${missing.join(" ")}`);
    const forbidden = sitemapPaths.filter((p) => NEVER_LISTED.some((n) => p === n || p.startsWith(`${n}/`)));
    expect(forbidden.length === 0, "no auth, gated, coming-soon or API URL in the sitemap", "", `listed: ${forbidden.join(" ")}`);
    const trustListed = TRUST_PATHS.filter((p) => listed.has(p));
    if (opts.trust === "yes") expect(trustListed.length === 4, "trust pages are in the sitemap (--trust yes)", "4/4", `only ${trustListed.length}/4 listed - are placeholders still in src/lib/legal/site-owner.ts?`);
    else if (opts.trust === "no") expect(trustListed.length === 0, "trust pages are still drafts (--trust no)", "not listed", `listed: ${trustListed.join(" ")}`);
    else pass("trust pages in the sitemap", `${trustListed.length}/4`);
    pass("sitemap size", `${locs.length} URLs`);
  });

  // ---- each sitemap URL
  const descriptions = new Map();
  const titles = new Map();
  let organizationSeen = false;
  const pages = sitemapPaths.length ? sitemapPaths : [];
  for (const [i, p] of pages.entries()) {
    await safe(`page ${p}`, async () => {
      const url = `${origin}${p === "/" ? "/" : p}`;
      const r = await get(url, { ua: UA.googlebot });
      const where = p;
      if (r.status !== 200) return fail(`${where} status`, `status ${r.status}`);
      const a = analysePage(r.body);
      const problems = [];
      if (headerNoindex(r.headers)) problems.push("X-Robots-Tag noindex");
      if (a.noindexMeta) problems.push("meta robots noindex");
      if (a.titleCount !== 1) problems.push(`${a.titleCount} <title> elements`);
      if (a.canonicalHrefs.length !== 1) problems.push(`${a.canonicalHrefs.length} canonical links`);
      else if (!(p === "/" ? [canonical, `${canonical}/`] : [`${canonical}${p}`]).includes(a.canonicalHrefs[0])) problems.push(`canonical is ${a.canonicalHrefs[0]}`);
      if (a.h1Count !== 1) problems.push(`${a.h1Count} <h1>`);
      if (!a.description) problems.push("no meta description");
      if (!a.ogTitle || !a.ogImage) problems.push("incomplete Open Graph (og:title / og:image)");
      if (a.lang !== "en") problems.push(`lang="${a.lang}"`);
      if (problems.length) fail(`${where} search signals`, problems.join("; "));
      else pass(`${where} search signals`, `200, indexable, one title, canonical, one h1, description, Open Graph`);
      if (a.title) {
        if (titles.has(a.title)) fail(`${where} unique title`, `same title as ${titles.get(a.title)}`);
        titles.set(a.title, p);
      }
      if (a.description) {
        if (descriptions.has(a.description)) fail(`${where} unique description`, `same description as ${descriptions.get(a.description)}`);
        descriptions.set(a.description, p);
      }
      // JSON-LD
      const blocks = [];
      for (const raw of a.ldBlocks) {
        try {
          blocks.push(JSON.parse(raw));
        } catch {
          fail(`${where} JSON-LD`, "a block is not valid JSON");
        }
      }
      const types = blocks.flatMap((b) => (Array.isArray(b["@graph"]) ? b["@graph"] : [b])).map((b) => b["@type"]);
      const badType = types.filter((t) => !ALLOWED_LD_TYPES.has(t));
      if (badType.length) fail(`${where} JSON-LD types`, `unexpected: ${badType.join(", ")} (no FAQPage / review / rating markup is expected)`);
      if (blocks.some((b) => b["@context"] !== "https://schema.org")) fail(`${where} JSON-LD context`, "@context is not https://schema.org");
      if (types.includes("Organization")) organizationSeen = true;
      if (p === "/") {
        const site = blocks.find((b) => b["@type"] === "WebSite");
        expect(!!site && site.url === `${canonical}/` && !!site.name, "home page WebSite JSON-LD (name + canonical url)", `${site?.name}`, "missing, or url is not the canonical home page");
      }
      if (p.startsWith("/molecules/")) {
        const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList");
        expect(!!crumbs && crumbs.itemListElement?.length === 3, `${where} BreadcrumbList`, "3 items", "missing or not 3 items");
      }
      // Crawlers that skip the streamed metadata (SEO-12): title and canonical must be in <head> for the AI crawlers.
      if (i < 2) {
        for (const [name, ua] of [["GPTBot", UA.gptbot], ["ClaudeBot", UA.claudebot], ["PerplexityBot", UA.perplexity]]) {
          const b = await get(url, { ua });
          const ba = analysePage(b.body);
          expect(b.status === 200 && ba.titleInHead && ba.canonicalInHead && ba.titleCount === 1, `${where} as ${name}`, "title and canonical are in <head>", `status ${b.status}, title in head: ${ba.titleInHead}, canonical in head: ${ba.canonicalInHead}`);
        }
      }
    });
  }
  if (opts.trust === "no" && organizationSeen) fail("Organization JSON-LD", "present while --trust no (owner details are placeholders)");
  if (opts.trust === "yes" && pages.length) expect(organizationSeen, "Organization JSON-LD (--trust yes)", "present", "missing although the trust pages are indexable");
  if (descriptions.size) pass("descriptions are unique", `${descriptions.size} pages`);

  // ---- pages that must stay out of the index
  for (const p of NOINDEX_PATHS) {
    await safe(`${p} noindex`, async () => {
      const r = await get(`${origin}${p}`, { ua: UA.googlebot });
      const a = analysePage(r.body);
      expect(r.status === 200 && (headerNoindex(r.headers) || a.noindexMeta), `${p} stays out of the index`, "200 + noindex", `status ${r.status}, noindex: ${headerNoindex(r.headers) || a.noindexMeta}`);
    });
  }
  for (const p of GATED_PATHS) {
    await safe(`${p} gated`, async () => {
      const r = await get(`${origin}${p}`, { ua: UA.googlebot });
      expect(r.status >= 300 && r.status < 400 && r.location.includes("/login"), `${p} is gated for signed-out visitors`, `${r.status} -> /login`, `status ${r.status} ${r.location}`);
    });
  }
  await safe("404", async () => {
    const r = await get(`${origin}/__seo-check-${Date.now().toString(36)}`, { ua: UA.googlebot });
    const a = analysePage(r.body);
    expect(r.status === 404 && (headerNoindex(r.headers) || a.noindexMeta) && a.titleCount === 1, "unknown URLs answer a real 404 (noindex, one title)", "404", `status ${r.status}, noindex: ${headerNoindex(r.headers) || a.noindexMeta}, ${a.titleCount} titles`);
  });
  await safe("trailing slash", async () => {
    const r = await get(`${origin}/explore/`, { ua: UA.googlebot });
    expect(r.status === 308 || r.status === 301, "/explore/ redirects to /explore (no duplicate)", String(r.status), `status ${r.status}`);
  });

  // ---- other hostnames / protocols must redirect to the canonical origin
  for (const variant of opts.variants) {
    await safe(`redirect ${variant}`, async () => {
      const start = new URL(variant);
      const probe = `${start.origin}/explore?molecule=water`;
      let url = probe;
      const hops = [];
      for (let n = 0; n < 6; n++) {
        const r = await get(url, { ua: UA.googlebot });
        if (r.status >= 300 && r.status < 400 && r.location) {
          hops.push(r.status);
          url = new URL(r.location, url).toString();
        } else {
          hops.push(r.status);
          break;
        }
      }
      const finalOk = url === `${canonical}/explore?molecule=water`;
      expect(finalOk, `${variant} ends on the canonical origin with path and query kept`, url, `ended on ${url}`);
      const redirects = hops.slice(0, -1);
      expect(redirects.length >= 1 && redirects.length <= 3, `${variant} redirect chain length`, `${redirects.length} hop(s)`, `${redirects.length} hops (Google: keep chains short, ideally 3 or fewer)`);
      if (redirects.length && redirects.some((s) => s === 302 || s === 307)) {
        warn(`${variant} redirect type`, `status ${redirects.join("->")}: a temporary redirect - Google does not use it as a signal that the target is canonical. Make it permanent (301/308), see SEO_LAUNCH_CHECKLIST §2`);
      } else if (redirects.length) {
        pass(`${variant} redirect type`, `permanent (${redirects.join("->")})`);
      }
    });
  }

  return { ok: !results.some((r) => r.level === "fail"), results };
}

export function formatResults(results) {
  const tag = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  return results.map((r) => `${tag[r.level]}  ${r.check}${r.detail ? ` - ${r.detail}` : ""}`).join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\nUsage: node scripts/seo/verify-live.mjs <https-origin> [--variant <url> ...] [--trust yes|no|either] [--canonical-origin <origin>] [--allow-http-localhost]`);
    process.exit(err.exitCode ?? 64);
  }
  try {
    const { ok, results } = await verifyLive(opts);
    console.log(formatResults(results));
    const f = results.filter((r) => r.level === "fail").length;
    const w = results.filter((r) => r.level === "warn").length;
    console.log(`\n[check:live-seo] ${ok ? "OK" : "FAILED"} - ${results.filter((r) => r.level === "pass").length} passed, ${w} warning(s), ${f} failed.`);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(`[check:live-seo] ${err.message}`);
    process.exit(err.exitCode ?? 1);
  }
}
