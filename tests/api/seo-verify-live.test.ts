/**
 * `npm run check:live-seo` (scripts/seo/verify-live.mjs): it passes a healthy site and FAILS for each defect the launch checklist
 * warns about. The "site" is a local stub server; the canonical origin it must name is https://studio.example.
 */
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { formatResults, parseArgs, verifyLive } from "../../scripts/seo/verify-live.mjs";

const CANON = "https://studio.example";
const PUBLIC = ["/", "/explore", "/atom-models", "/periodic-table", "/pricing", "/molecules", "/molecules/water", "/molecules/methane"];
const NOINDEX = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/learn", "/showcase"];
const GATED = ["/dashboard", "/ai-lab", "/profile"];

interface Defects {
  robotsBody?: string;
  sitemapPaths?: string[];
  sitemapStatus?: number;
  pages?: Record<string, Partial<PageOpts>>;
  notFoundStatus?: number;
  gatedStatus?: number;
  noindexMissingOn?: string[];
  variantResponses?: Record<string, { status: number; location?: string }[]>;
}
interface PageOpts {
  title: string;
  titles: number;
  canonical: string | null;
  description: string;
  h1: number;
  robots: string;
  ld: unknown[];
  rawLd: string[];
  og: boolean;
  noindexHeader: boolean;
  titleAfterHead: boolean;
}

let defects: Defects = {};
let server: http.Server;
let base: string;

function pageHtml(p: string, o: Partial<PageOpts> = {}): string {
  const title = o.title ?? `Title of ${p}`;
  const canonical = o.canonical === undefined ? (p === "/" ? CANON : `${CANON}${p}`) : o.canonical;
  const ld =
    o.ld ??
    (p === "/"
      ? [{ "@context": "https://schema.org", "@type": "WebSite", name: "Studio", url: `${CANON}/` }]
      : p.startsWith("/molecules/")
        ? [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [1, 2, 3].map((n) => ({ "@type": "ListItem", position: n })) }]
        : []);
  const titles = Array.from({ length: o.titles ?? 1 }, () => `<title>${title}</title>`).join("");
  const head = [
    o.titleAfterHead ? "" : titles,
    canonical ? `<link rel="canonical" href="${canonical}"/>` : "",
    `<meta name="description" content="${o.description ?? `Description of ${p}`}"/>`,
    o.robots ? `<meta name="robots" content="${o.robots}"/>` : "",
    o.og === false ? "" : `<meta property="og:title" content="${title}"/><meta property="og:image" content="${CANON}/opengraph-image"/>`,
    ...ld.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`),
    ...(o.rawLd ?? []).map((b) => `<script type="application/ld+json">${b}</script>`),
  ].join("");
  return `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${o.titleAfterHead ? titles : ""}${"<h1>x</h1>".repeat(o.h1 ?? 1)}</body></html>`;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const p = url.pathname;
    const send = (status: number, body: string, type = "text/html", extra: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, ...extra });
      res.end(body);
    };
    if (p === "/robots.txt") return send(defects.robotsBody === undefined ? 200 : 200, defects.robotsBody ?? `User-Agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${CANON}/sitemap.xml\n`, "text/plain");
    if (p === "/sitemap.xml") {
      const paths = defects.sitemapPaths ?? PUBLIC;
      const xml = `<?xml version="1.0"?><urlset>${paths.map((x) => `<url><loc>${x === "/" ? CANON : CANON + x}</loc></url>`).join("")}</urlset>`;
      return send(defects.sitemapStatus ?? 200, xml, "application/xml");
    }
    if (p.startsWith("/__seo-check-")) {
      return send(defects.notFoundStatus ?? 404, pageHtml(p, { robots: "noindex, nofollow" }));
    }
    // The redirect probe (`/explore?molecule=water` on another host) is answered from a scripted table.
    const variant = url.search.includes("molecule=water") ? defects.variantResponses?.[`${req.headers.host}${p}`] : undefined;
    if (variant) {
      const next = variant.shift() ?? { status: 200 };
      if (next.status >= 300 && next.status < 400) return send(next.status, "", "text/plain", { location: next.location ?? "/" });
      return send(next.status, "ok");
    }
    if (p === "/explore/") return send(308, "", "text/plain", { location: "/explore" });
    if (GATED.includes(p)) {
      return defects.gatedStatus === 200 ? send(200, pageHtml(p)) : send(307, "", "text/plain", { location: "/login" });
    }
    if (NOINDEX.includes(p)) {
      return send(200, pageHtml(p, { robots: defects.noindexMissingOn?.includes(p) ? "" : "noindex, follow" }));
    }
    if (PUBLIC.includes(p) || (defects.sitemapPaths ?? []).includes(p)) {
      const o = defects.pages?.[p] ?? {};
      return send(200, pageHtml(p, o), "text/html", o.noindexHeader ? { "x-robots-tag": "noindex" } : {});
    }
    return send(404, pageHtml(p, { robots: "noindex" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  defects = {};
});

const run = (extra: Record<string, unknown> = {}) => verifyLive({ origin: base, canonicalOrigin: CANON, allowHttpLocalhost: true, ...extra });
const failures = (r: { results: { level: string; check: string; detail: string }[] }) => r.results.filter((x) => x.level === "fail");
const failText = (r: { results: { level: string; check: string; detail: string }[] }) => failures(r).map((f) => `${f.check} ${f.detail}`).join(" | ");

describe("a healthy site", () => {
  it("passes every check, with no failures and no warnings", async () => {
    const r = await run();
    expect(failText(r)).toBe("");
    expect(r.ok).toBe(true);
    expect(r.results.filter((x) => x.level === "warn")).toEqual([]);
    expect(formatResults(r.results)).toMatch(/PASS {2}robots\.txt status/);
    expect(r.results.find((x) => x.check === "sitemap size")?.detail).toBe(`${PUBLIC.length} URLs`);
  });
});

describe("it fails for each defect the checklist warns about", () => {
  it("robots.txt blocking everything (the fail-closed noindex mode)", async () => {
    defects = { robotsBody: "User-Agent: *\nDisallow: /\n" };
    const r = await run();
    expect(r.ok).toBe(false);
    expect(failText(r)).toMatch(/robots\.txt does not block the whole site/);
    expect(failText(r)).toMatch(/names the sitemap/);
  });

  it("an empty sitemap", async () => {
    defects = { sitemapPaths: [] };
    expect(failText(await run())).toMatch(/sitemap\.xml lists URLs/);
  });

  it("a sitemap that lists a login, gated or coming-soon page", async () => {
    defects = { sitemapPaths: [...PUBLIC, "/login", "/dashboard", "/learn"] };
    expect(failText(await run())).toMatch(/no auth, gated, coming-soon or API URL in the sitemap.*\/login \/dashboard \/learn/);
  });

  it("a sitemap that names another host", async () => {
    defects = { sitemapPaths: PUBLIC };
    const r = await run({ canonicalOrigin: "https://www.studio.example" });
    expect(failText(r)).toMatch(/every sitemap URL is on the canonical origin/);
  });

  it("noindex (meta or header) on an indexable page", async () => {
    defects = { pages: { "/explore": { robots: "noindex" }, "/pricing": { noindexHeader: true } } };
    const text = failText(await run());
    expect(text).toMatch(/\/explore search signals.*meta robots noindex/);
    expect(text).toMatch(/\/pricing search signals.*X-Robots-Tag noindex/);
  });

  it("two titles, a missing or wrong canonical, two h1, no description, no Open Graph, and duplicated titles/descriptions", async () => {
    defects = {
      pages: {
        "/explore": { titles: 2 },
        "/atom-models": { canonical: null },
        "/periodic-table": { canonical: `${CANON}/somewhere-else` },
        "/pricing": { h1: 2 },
        "/molecules": { description: "", og: false },
        "/molecules/water": { title: "Same", description: "Same description" },
        "/molecules/methane": { title: "Same", description: "Same description" },
      },
    };
    const text = failText(await run());
    expect(text).toMatch(/\/explore search signals.*2 <title> elements/);
    expect(text).toMatch(/\/atom-models search signals.*0 canonical links/);
    expect(text).toMatch(/\/periodic-table search signals.*canonical is https:\/\/studio\.example\/somewhere-else/);
    expect(text).toMatch(/\/pricing search signals.*2 <h1>/);
    expect(text).toMatch(/\/molecules search signals.*no meta description.*incomplete Open Graph/);
    expect(text).toMatch(/\/molecules\/methane unique title.*same title as \/molecules\/water/);
    expect(text).toMatch(/\/molecules\/methane unique description/);
  });

  it("the home page without a correct WebSite JSON-LD, FAQ markup, or invalid JSON-LD", async () => {
    defects = {
      pages: {
        "/": { ld: [{ "@context": "https://schema.org", "@type": "WebSite", name: "Studio", url: "https://other.example/" }, { "@context": "https://schema.org", "@type": "FAQPage" }] },
        "/explore": { rawLd: ["{not json"] },
      },
    };
    const text = failText(await run());
    expect(text).toMatch(/home page WebSite JSON-LD/);
    expect(text).toMatch(/\/ JSON-LD types.*FAQPage/);
    expect(text).toMatch(/\/explore JSON-LD.*not valid JSON/);
  });

  it("a molecule page without its breadcrumb list", async () => {
    defects = { pages: { "/molecules/water": { ld: [] } } };
    expect(failText(await run())).toMatch(/\/molecules\/water BreadcrumbList/);
  });

  it("title and canonical streamed after </head> (invisible to the AI crawlers)", async () => {
    defects = { pages: { "/": { titleAfterHead: true } } };
    expect(failText(await run())).toMatch(/\/ as GPTBot.*title in head: false/);
  });

  it("a login page without noindex, a gated page that answers 200, and a soft 404", async () => {
    defects = { noindexMissingOn: ["/login"], gatedStatus: 200, notFoundStatus: 200 };
    const text = failText(await run());
    expect(text).toMatch(/\/login stays out of the index/);
    expect(text).toMatch(/\/dashboard is gated for signed-out visitors/);
    expect(text).toMatch(/unknown URLs answer a real 404/);
  });

  it("--trust yes without the four trust pages in the sitemap, and --trust no with them", async () => {
    expect(failText(await run({ trust: "yes" }))).toMatch(/trust pages are in the sitemap \(--trust yes\).*0\/4/);
    defects = { sitemapPaths: [...PUBLIC, "/about", "/contact", "/privacy", "/terms"] };
    expect(failText(await run({ trust: "no" }))).toMatch(/trust pages are still drafts \(--trust no\).*\/about/);
    expect(failText(await run({ trust: "either" }))).not.toMatch(/trust pages/);
  });
});

describe("other hostnames and protocols (--variant)", () => {
  const probe = (host: string) => `${host}/explore`;
  it("a permanent redirect to the canonical origin that keeps path and query passes", async () => {
    const host = new URL(base).host;
    defects = { variantResponses: { [probe(host)]: [{ status: 308, location: `${CANON}/explore?molecule=water` }] } };
    // the stub serves the final hop itself: the final URL is not fetched because it is on the canonical origin
    const r = await run({ variants: [`${base}/`], fetchImpl: async (url: string, init: RequestInit) => (String(url).startsWith(CANON) ? new Response("ok", { status: 200 }) : fetch(url, init)) });
    expect(failText(r)).toBe("");
    expect(r.results.find((x) => x.check.endsWith("redirect type"))?.detail).toMatch(/permanent \(308\)/);
  });

  it("a temporary redirect (307/302) is a warning, not a failure", async () => {
    const host = new URL(base).host;
    defects = { variantResponses: { [probe(host)]: [{ status: 307, location: `${CANON}/explore?molecule=water` }] } };
    const r = await run({ variants: [`${base}/`], fetchImpl: async (url: string, init: RequestInit) => (String(url).startsWith(CANON) ? new Response("ok", { status: 200 }) : fetch(url, init)) });
    expect(r.ok).toBe(true);
    const w = r.results.filter((x) => x.level === "warn");
    expect(w).toHaveLength(1);
    expect(w[0].detail).toMatch(/temporary redirect/);
  });

  it("no redirect at all, a redirect that loses the path, and a long chain fail", async () => {
    const host = new URL(base).host;
    defects = { variantResponses: { [probe(host)]: [{ status: 200 }] } };
    expect(failText(await run({ variants: [`${base}/`] }))).toMatch(/ends on the canonical origin/);

    defects = { variantResponses: { [probe(host)]: [{ status: 301, location: `${CANON}/` }] } };
    const lost = await run({ variants: [`${base}/`], fetchImpl: async (url: string, init: RequestInit) => (String(url).startsWith(CANON) ? new Response("ok") : fetch(url, init)) });
    expect(failText(lost)).toMatch(/ends on the canonical origin with path and query kept/);

    const chain = Array.from({ length: 4 }, () => ({ status: 301, location: `${base}/explore?molecule=water` }));
    defects = { variantResponses: { [probe(host)]: [...chain, { status: 301, location: `${CANON}/explore?molecule=water` }] } };
    const long = await run({ variants: [`${base}/`], fetchImpl: async (url: string, init: RequestInit) => (String(url).startsWith(CANON) ? new Response("ok") : fetch(url, init)) });
    expect(failText(long)).toMatch(/redirect chain length.*hops/);
  });
});

describe("arguments and exit codes", () => {
  it("parseArgs accepts the documented options", () => {
    expect(parseArgs(["https://a.example", "--variant", "http://a.example/", "--variant", "https://www.a.example/", "--trust", "yes"])).toMatchObject({
      origin: "https://a.example",
      variants: ["http://a.example/", "https://www.a.example/"],
      trust: "yes",
    });
  });

  it.each([
    [[], /origin to check is required/],
    [["https://a.example", "--trust", "maybe"], /--trust must be/],
    [["https://a.example", "--wat"], /Unknown option/],
    [["https://a.example", "extra"], /Unexpected argument/],
    [["https://a.example", "--variant"], /--variant needs a URL/],
  ])("parseArgs(%j) is a usage error", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it("verifyLive refuses an http origin, an origin with a path, and an http canonical origin", async () => {
    await expect(verifyLive({ origin: "http://example.com" })).rejects.toThrow(/must be an https origin/);
    await expect(verifyLive({ origin: "https://example.com/app" })).rejects.toThrow(/origin only/);
    await expect(verifyLive({ origin: base, allowHttpLocalhost: true, canonicalOrigin: "http://studio.example" })).rejects.toThrow(/must be an https origin/);
  });

  const script = path.resolve(__dirname, "../../scripts/seo/verify-live.mjs");
  const childEnv = { PATH: process.env.PATH ?? "", NODE_ENV: "test" } as NodeJS.ProcessEnv;
  const cli = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 60_000, env: childEnv });

  it("the CLI exits 64 on a bad argument and prints the usage", () => {
    const res = cli(["http://example.com"]);
    expect(res.status).toBe(64);
    expect(res.stderr).toMatch(/must be an https origin/);
    expect(res.stderr).toMatch(/Usage: node scripts\/seo\/verify-live\.mjs/);
    expect(cli([]).status).toBe(64);
  });

  it("the CLI exits 0 for a healthy site and 1 when a check fails (async: the stub lives in this process)", async () => {
    const asyncCli = (args: string[]) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const c = spawn(process.execPath, [script, ...args], { env: childEnv });
        let out = "";
        c.stdout.on("data", (d: Buffer) => (out += d));
        c.stderr.on("data", (d: Buffer) => (out += d));
        c.on("close", (code: number | null) => resolve({ code, out }));
      });
    const ok = await asyncCli([base, "--canonical-origin", CANON, "--allow-http-localhost"]);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toMatch(/\[check:live-seo\] OK/);
    defects = { robotsBody: "User-Agent: *\nDisallow: /\n" };
    const bad = await asyncCli([base, "--canonical-origin", CANON, "--allow-http-localhost"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/FAIL {2}robots\.txt does not block the whole site/);
    expect(bad.out).toMatch(/\[check:live-seo\] FAILED/);
  });
});
