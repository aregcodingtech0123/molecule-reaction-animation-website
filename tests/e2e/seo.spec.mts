import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { expect, test } from "@playwright/test";
import { repoRoot, webEnv } from "../../scripts/test/e2e-env.mjs";

/**
 * SEO on the PRODUCTION build (`E2E_NEXT_MODE=production`), requested without JavaScript and with crawler user
 * agents: robots.txt, sitemap.xml, per-route metadata, noindex on auth / gated / coming-soon pages, the fail-closed
 * modes of SITE_URL (SEO-20), metadata in the first HTML for the AI crawlers (SEO-12), and the CSP/security headers
 * unchanged. Each mode is its own `next start` on a free port, reusing the production build the stack made.
 */
const PRODUCTION = process.env.E2E_NEXT_MODE === "production";

const AGENTS = {
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
  claudebot: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  perplexity: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};
const PUBLIC = ["/", "/explore", "/atom-models", "/periodic-table", "/pricing"];
const NOINDEX = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/learn", "/showcase"];
const GATED = ["/dashboard", "/ai-lab", "/profile"];
// Part 2: the 14 molecule pages (same ids as src/lib/molecules) and the trust pages (drafts while placeholders remain).
const MOLECULES = ["water", "methane", "glucose", "caffeine", "dna-fragment", "protein-fragment", "ethanol", "aspirin", "capsaicin", "serotonin", "dopamine", "adrenaline", "buckminsterfullerene", "heme-group"];
const TRUST = ["/about", "/contact", "/privacy", "/terms"];
const SITE = "https://studio.example";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

interface Running {
  origin: string;
  stop: () => Promise<void>;
}

async function start(env: Record<string, string>): Promise<Running> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], {
    cwd: repoRoot,
    env: { ...process.env, ...webEnv(), NODE_ENV: "production", SITE_URL: "", VERCEL_ENV: "", ...env } as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`next start exited: ${out}`);
    try {
      if ((await fetch(`${origin}/robots.txt`)).status === 200) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    origin,
    stop: async () => {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    },
  };
}

async function page(srv: Running, path: string, agent = AGENTS.googlebot) {
  const res = await fetch(`${srv.origin}${path}`, { redirect: "manual", headers: { "user-agent": agent } });
  const html = res.headers.get("content-type")?.includes("text/html") ? await res.text() : "";
  const head = html.split("</head>")[0] ?? "";
  const all = (re: RegExp, src = html) => [...src.matchAll(re)].map((m) => m[1]);
  return {
    status: res.status,
    headers: res.headers,
    html,
    head,
    titles: all(/<title>([^<]*)<\/title>/g),
    headTitles: all(/<title>([^<]*)<\/title>/g, head),
    robots: all(/<meta name="robots" content="([^"]*)"/g),
    canonical: all(/<link rel="canonical" href="([^"]*)"/g),
    description: all(/<meta name="description" content="([^"]*)"/g),
    ogTitle: all(/<meta property="og:title" content="([^"]*)"/g),
    ogImage: all(/<meta property="og:image" content="([^"]*)"/g),
    twitterCard: all(/<meta name="twitter:card" content="([^"]*)"/g),
    hiddenStreamed: /<div hidden[^>]*id="S:/.test(html),
  };
}

test.describe("indexable production site (SITE_URL = https origin)", () => {
  test.skip(!PRODUCTION, "needs the production build: run with E2E_NEXT_MODE=production");
  let srv: Running;
  test.beforeAll(async () => {
    srv = await start({ SITE_URL: SITE });
  });
  test.afterAll(async () => {
    await srv?.stop();
  });

  test("robots.txt: allow all, /api/ out, sitemap announced; no gated or auth path disallowed", async () => {
    const res = await fetch(`${srv.origin}/robots.txt`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toMatch(/User-Agent: \*\nAllow: \/\nDisallow: \/api\/\n/i);
    expect(body).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    for (const p of [...GATED, ...NOINDEX]) expect(body, p).not.toContain(p);
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  test("sitemap.xml: exactly the public routes, absolute, no lastmod, no gated / auth / coming-soon route", async () => {
    const body = await (await fetch(`${srv.origin}/sitemap.xml`)).text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    // Part 2 (TC-68): the molecule index and one URL per molecule join the public routes, in registry order.
    const expected = ["/", "/explore", "/atom-models", "/periodic-table", "/molecules", ...MOLECULES.map((id) => `/molecules/${id}`), "/pricing"];
    expect(locs).toEqual(expected.map((p) => (p === "/" ? SITE : `${SITE}${p}`)));
    expect(body).not.toContain("lastmod");
    for (const p of [...GATED, ...NOINDEX, ...TRUST]) expect(locs.some((l) => l.endsWith(p)), p).toBe(false);
  });

  for (const [name, agent] of Object.entries(AGENTS)) {
    test(`public routes carry title, description, canonical and share tags in <head> for ${name}`, async () => {
      const titles = new Set<string>();
      for (const path of PUBLIC) {
        const p = await page(srv, path, agent);
        expect(p.status, path).toBe(200);
        expect(p.headTitles, `${path} title in <head>`).toHaveLength(1);
        expect(p.titles, `${path} exactly one <title>`).toHaveLength(1);
        titles.add(p.titles[0]);
        expect(p.description[0]?.length, `${path} description`).toBeGreaterThan(60);
        expect(p.canonical, path).toEqual([path === "/" ? SITE : `${SITE}${path}`]);
        expect(p.robots, `${path} must be indexable`).toEqual([]);
        expect(p.headers.get("x-robots-tag"), path).toBeNull();
        expect(p.ogTitle, path).toHaveLength(1);
        expect(p.ogImage[0], path).toMatch(new RegExp(`^${SITE}/opengraph-image`));
        expect(p.twitterCard, path).toEqual(["summary_large_image"]);
        expect(p.html, `${path} meta description is in <head>`).toContain('<meta name="description"');
        expect(p.head, path).toContain('<meta name="description"');
      }
      expect(titles.size, "every public route has its own title").toBe(PUBLIC.length);
    });
  }

  test("/explore variants canonicalise to /explore, an unknown molecule id is still 200, and the heading is not in a hidden streamed block", async () => {
    for (const q of ["", "?molecule=caffeine", "?molecule=xyz", "?tab=reactions"]) {
      const p = await page(srv, `/explore${q}`);
      expect(p.status, q).toBe(200);
      expect(p.canonical, q).toEqual([`${SITE}/explore`]);
      expect(p.hiddenStreamed, `${q}: content must not sit in a hidden streamed block`).toBe(false);
      expect(p.html, q).toMatch(/<h1[^>]*>[\s\S]*Molecule Explorer/);
    }
    const caffeine = await page(srv, "/explore?molecule=caffeine");
    const water = await page(srv, "/explore");
    expect(caffeine.html.match(/Caffeine/g)!.length, "?molecule=caffeine is rendered on the server").toBeGreaterThan(water.html.match(/Caffeine/g)!.length);
  });

  test("auth and coming-soon pages say noindex in the HTML and have no canonical; titles stay distinct", async () => {
    for (const path of NOINDEX) {
      const p = await page(srv, path);
      expect(p.status, path).toBe(200);
      expect(p.robots[0], path).toMatch(/^noindex/);
      expect(p.canonical, path).toEqual([]);
      expect(p.titles, path).toHaveLength(1);
    }
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"]) {
      expect((await page(srv, path)).robots, path).toEqual(["noindex, nofollow"]);
    }
  });

  test("gated pages redirect a signed-out crawler to /login with X-Robots-Tag: noindex (gating unchanged)", async () => {
    for (const path of GATED) {
      const p = await page(srv, path);
      expect(p.status, path).toBe(307);
      expect(new URL(p.headers.get("location")!, srv.origin).pathname, path).toBe("/login");
      expect(p.headers.get("x-robots-tag"), path).toBe("noindex");
      expect(p.html, path).toBe("");
    }
  });

  test("404: status 404, one title, noindex, links back into the site", async () => {
    for (const path of ["/does-not-exist", "/Explore", "/api/does-not-exist"]) {
      const p = await page(srv, path);
      expect(p.status, path).toBe(404);
      expect(p.titles, path).toHaveLength(1);
      expect(p.robots[0], path).toMatch(/noindex/);
    }
    expect((await page(srv, "/does-not-exist")).html).toContain('href="/explore"');
    expect((await fetch(`${srv.origin}/explore/`, { redirect: "manual" })).status).toBe(308);
  });

  test("icons, manifest and share image are real (not the create-next-app template)", async () => {
    const home = await page(srv, "/");
    expect(home.html).toMatch(/<link rel="icon" href="\/icon\.svg/);
    expect(home.html).toMatch(/<link rel="apple-touch-icon" href="\/apple-icon/);
    expect(home.html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    const og = await fetch(`${srv.origin}/opengraph-image`);
    expect(og.status).toBe(200);
    expect(og.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await og.arrayBuffer());
    expect(png.readUInt32BE(16), "share image width").toBe(1200);
    expect(png.readUInt32BE(20), "share image height").toBe(630);
    const icon = await fetch(`${srv.origin}/icon.svg`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toMatch(/svg/);
    const manifest = await (await fetch(`${srv.origin}/manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({ name: "Molecule Architecture Studio", start_url: "/", display: "browser" });
    expect((await fetch(`${srv.origin}/apple-icon`)).status).toBe(200);
  });

  test("security headers and the nonce CSP are unchanged on every page type", async () => {
    for (const path of [...PUBLIC, "/login", "/does-not-exist"]) {
      const p = await page(srv, path);
      const csp = p.headers.get("content-security-policy") ?? "";
      const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
      expect(script, path).toMatch(/^script-src 'self' 'nonce-[^']+' 'strict-dynamic'$/);
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toContain("object-src 'none'");
      expect(p.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(p.headers.get("x-frame-options"), path).toBe("DENY");
      expect(p.headers.get("strict-transport-security"), path).toContain("max-age=");
      expect(p.headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      // The nonce on the response header is the one on the page's own scripts.
      const nonce = script!.match(/'nonce-([^']+)'/)![1];
      expect(p.html, path).toContain(`nonce="${nonce}"`);
    }
  });

  // ── Part 2: molecule pages, trust pages, JSON-LD ────────────────────────────────────────────────────────────

  for (const [name, agent] of Object.entries(AGENTS)) {
    test(`molecule pages: title, description, self-canonical in <head>, one h1, content in the first HTML, for ${name}`, async () => {
      const titles = new Set<string>();
      for (const path of ["/molecules", ...MOLECULES.map((id) => `/molecules/${id}`)]) {
        const p = await page(srv, path, agent);
        expect(p.status, path).toBe(200);
        expect(p.headTitles, `${path} title in <head>`).toHaveLength(1);
        titles.add(p.headTitles[0]);
        expect(p.head, path).toContain('<meta name="description"');
        expect(p.canonical, path).toEqual([`${SITE}${path}`]);
        expect(p.robots, path).toEqual([]);
        expect(p.html.match(/<h1/g), `${path} one h1`).toHaveLength(1);
        expect(p.hiddenStreamed, `${path}: no hidden streamed block`).toBe(false);
      }
      expect(titles.size).toBe(MOLECULES.length + 1);
      const caffeine = await page(srv, "/molecules/caffeine", agent);
      expect(caffeine.html).toContain("C₈H₁₀N₄O₂");
      expect(caffeine.html).toContain("194.19 g/mol");
      expect(caffeine.html).toContain('href="/explore?molecule=caffeine"');
    });
  }

  test("molecule pages: unknown or wrongly-cased ids are the site's 404 (noindex)", async () => {
    for (const path of ["/molecules/xyz", "/molecules/Caffeine", "/molecules/__proto__"]) {
      const p = await page(srv, path);
      expect(p.status, path).toBe(404);
      expect(p.robots[0], path).toMatch(/noindex/);
    }
  });

  test("trust pages: reachable, visibly drafts, noindex (links followed), out of the sitemap, linked from the home page footer", async () => {
    for (const path of TRUST) {
      const p = await page(srv, path);
      expect(p.status, path).toBe(200);
      expect(p.robots, path).toEqual(["noindex, follow"]);
      expect(p.canonical, path).toEqual([]);
      expect(p.html, path).toContain("Draft — needs legal review.");
      expect(p.html, path).toContain("[to be provided:");
    }
    const home = await page(srv, "/");
    for (const path of TRUST) expect(home.html, `home links ${path}`).toContain(`href="${path}"`);
    expect(home.html).not.toContain('href="https://github.com"');
  });

  test("JSON-LD in the first HTML: WebSite on /, WebApplication with the three packs on /pricing, BreadcrumbList on molecule pages; no Organization (placeholders), no FAQPage", async () => {
    const blocks = async (path: string) =>
      [...(await page(srv, path)).html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(await blocks("/")).toEqual([{ "@context": "https://schema.org", "@type": "WebSite", name: "Molecule Architecture Studio", url: `${SITE}/` }]);
    const pricing = await blocks("/pricing");
    expect(pricing.map((b) => b["@type"])).toEqual(["WebApplication"]);
    expect(pricing[0].offers.map((o: { price: string }) => o.price)).toEqual(["5.00", "20.00", "50.00"]);
    expect((await blocks("/molecules/water"))[0].itemListElement.map((i: { name: string }) => i.name)).toEqual(["Home", "Molecules", "Water"]);
    for (const path of [...PUBLIC, "/molecules", "/molecules/water", ...TRUST]) {
      const html = (await page(srv, path)).html;
      expect(html, path).not.toContain('"Organization"');
      expect(html, path).not.toContain("FAQPage");
    }
  });

  test("JSON-LD under the real enforced CSP in Chromium: no CSP violation, every block parses", async ({ browser }) => {
    const context = await browser.newContext();
    // Only this server may be reached (the pages need nothing else).
    await context.route(/^(?!http:\/\/127\.0\.0\.1:)/, (route) => route.abort());
    const tab = await context.newPage();
    const consoleCsp: string[] = [];
    tab.on("console", (m) => {
      if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) consoleCsp.push(m.text());
    });
    await tab.addInitScript(() => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        (window as unknown as { __cspViolations: string[] }).__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    for (const path of ["/", "/pricing", "/molecules", "/molecules/caffeine"]) {
      const res = await tab.goto(`${srv.origin}${path}`, { waitUntil: "load" });
      expect(res!.headers()["content-security-policy"], path).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      await tab.waitForTimeout(500);
      const parsed = await tab.evaluate(() =>
        Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent ?? "")["@type"]),
      );
      expect(parsed.length, `${path} has JSON-LD`).toBeGreaterThan(0);
      expect(await tab.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), path).toEqual([]);
    }
    expect(consoleCsp).toEqual([]);
    await context.close();
  });

  test("the language switcher creates no crawlable duplicate URLs (English only, no hreflang)", async () => {
    for (const path of PUBLIC) {
      const p = await page(srv, path);
      expect(p.html, path).not.toMatch(/hreflang/i);
      expect(p.html, path).toContain('<html lang="en"');
    }
  });
});

test.describe("fail closed: SITE_URL missing, not https, or a non-production deployment", () => {
  test.skip(!PRODUCTION, "needs the production build: run with E2E_NEXT_MODE=production");
  const modes: Array<[string, Record<string, string>]> = [
    ["SITE_URL unset", {}],
    ["SITE_URL is http", { SITE_URL: "http://studio.example" }],
    ["SITE_URL is not an origin", { SITE_URL: "https://studio.example/en" }],
    ["Vercel preview deployment", { SITE_URL: SITE, VERCEL_ENV: "preview" }],
  ];

  for (const [name, env] of modes) {
    test(`${name}: Disallow-all robots.txt, empty sitemap, noindex on every page type`, async () => {
      test.setTimeout(120_000);
      const srv = await start(env);
      try {
        const robots = await (await fetch(`${srv.origin}/robots.txt`)).text();
        expect(robots.trim()).toBe("User-Agent: *\nDisallow: /");
        const sitemap = await (await fetch(`${srv.origin}/sitemap.xml`)).text();
        expect(sitemap).not.toContain("<loc>");
        for (const path of [...PUBLIC, "/login", "/learn", "/does-not-exist"]) {
          for (const agent of [AGENTS.googlebot, AGENTS.gptbot]) {
            const p = await page(srv, path, agent);
            expect(p.headers.get("x-robots-tag"), `${path} header`).toBe("noindex, nofollow");
            expect(p.robots[0], `${path} meta`).toMatch(/^noindex/);
            expect(p.canonical, `${path} canonical`).toEqual([]);
          }
        }
        // Part 2: JSON-LD needs the indexable origin, so a fail-closed deployment emits none.
        for (const path of ["/", "/pricing", "/molecules/water"]) {
          expect((await page(srv, path)).html, `${path} JSON-LD`).not.toContain("application/ld+json");
        }
        const gated = await page(srv, "/dashboard");
        expect(gated.status).toBe(307);
        expect(gated.headers.get("x-robots-tag")).toMatch(/noindex/);
        // The CSP is still sent.
        expect((await page(srv, "/")).headers.get("content-security-policy")).toContain("'strict-dynamic'");
      } finally {
        await srv.stop();
      }
    });
  }
});
