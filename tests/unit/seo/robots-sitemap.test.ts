/** SEO-01/02/20: robots.txt and sitemap.xml in every indexing mode, and the AI-crawler policy. */
import type { MetadataRoute } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { AI_CRAWLERS, disallowedCrawlerTokens, type AiCrawler } from "@/lib/seo/crawler-policy";
import { indexableRoutes, seoRoutes } from "@/lib/seo/routes";
import { ALL_MOLECULES } from "@/lib/molecules/data";
import { FULL_OWNER_ENV } from "../../support/site-owner-env";

afterEach(() => vi.unstubAllEnvs());
const indexable = () => {
  vi.stubEnv("SITE_URL", "https://studio.example");
  vi.stubEnv("VERCEL_ENV", "");
};
const groups = (r: MetadataRoute.Robots) => (Array.isArray(r.rules) ? r.rules : [r.rules]);

describe("robots.txt", () => {
  it("indexable: allow all, keep /api/ out, announce the sitemap, no AI group while the policy is allow-all", () => {
    indexable();
    const r = robots();
    expect(groups(r)).toEqual([{ userAgent: "*", allow: "/", disallow: "/api/" }]);
    expect(r.sitemap).toBe("https://studio.example/sitemap.xml");
  });

  it.each([
    ["SITE_URL unset", { SITE_URL: "" }],
    ["SITE_URL http", { SITE_URL: "http://studio.example" }],
    ["SITE_URL has a path", { SITE_URL: "https://studio.example/x" }],
    ["preview deployment", { SITE_URL: "https://studio.example", VERCEL_ENV: "preview" }],
  ])("fail closed (%s): Disallow: / for everyone, no sitemap", (_n, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const r = robots();
    expect(groups(r)).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(r.sitemap).toBeUndefined();
  });

  it("does not disallow any auth, gated or coming-soon path (a blocked URL cannot show its noindex)", () => {
    indexable();
    for (const route of seoRoutes({}).filter((x) => x.robots !== "index")) {
      expect(JSON.stringify(robots()), route.path).not.toContain(route.path);
    }
  });
});

describe("sitemap.xml", () => {
  it("lists exactly the indexable routes as absolute URLs on SITE_URL, without lastmod", () => {
    indexable();
    const entries = sitemap();
    expect(entries.map((e) => e.url)).toEqual([
      "https://studio.example",
      "https://studio.example/explore",
      "https://studio.example/atom-models",
      "https://studio.example/periodic-table",
      "https://studio.example/molecules",
      ...ALL_MOLECULES.map((m) => `https://studio.example/molecules/${m.id}`),
      "https://studio.example/pricing",
    ]);
    // one entry per static indexable route plus one per molecule (the template path itself never appears)
    expect(entries.length).toBe(indexableRoutes({}).length - 1 + ALL_MOLECULES.length);
    expect(entries.some((e) => e.url.includes("["))).toBe(false);
    for (const e of entries) expect(e).not.toHaveProperty("lastModified");
  });

  it("with every required SITE_OWNER_* variable set the four trust pages join the list (24 URLs instead of 20) - and only then", () => {
    indexable();
    expect(sitemap()).toHaveLength(20);
    for (const [name, value] of Object.entries(FULL_OWNER_ENV)) vi.stubEnv(name, value);
    const ready = sitemap().map((e) => e.url);
    expect(ready).toHaveLength(24);
    for (const p of ["/about", "/contact", "/privacy", "/terms"]) expect(ready).toContain(`https://studio.example${p}`);
    vi.stubEnv("SITE_OWNER_PRIVACY_EMAIL", "");
    expect(sitemap()).toHaveLength(24); // optional
    vi.stubEnv("SITE_OWNER_CONTACT_EMAIL", "");
    expect(sitemap()).toHaveLength(20); // required: the gate closes again on the next request
  });

  it("never contains a gated, auth or coming-soon route", () => {
    indexable();
    const urls = sitemap().map((e) => e.url);
    for (const p of ["/dashboard", "/ai-lab", "/profile", "/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/learn", "/showcase", "/about", "/contact", "/privacy", "/terms"]) {
      expect(urls.some((u) => u.endsWith(p)), p).toBe(false);
    }
  });

  it("is empty while the site is not indexable", () => {
    vi.stubEnv("SITE_URL", "");
    expect(sitemap()).toEqual([]);
  });
});

describe("AI-crawler policy (decision D2: allow all)", () => {
  it("allows every crawler today", () => {
    expect(AI_CRAWLERS.every((c) => c.policy === "allow")).toBe(true);
    expect(disallowedCrawlerTokens()).toEqual([]);
  });

  it("lists the vendor-documented tokens, each with a source", () => {
    expect(AI_CRAWLERS.map((c) => c.token)).toEqual([
      "GPTBot", "OAI-SearchBot", "ChatGPT-User", "OAI-AdsBot",
      "ClaudeBot", "Claude-SearchBot", "Claude-User",
      "Google-Extended", "PerplexityBot", "Perplexity-User", "CCBot",
    ]);
    for (const c of AI_CRAWLERS) expect(c.source, c.token).toMatch(/^https:\/\//);
  });

  it("changing an entry to disallow adds exactly that group to robots.txt", () => {
    const flipped: AiCrawler[] = AI_CRAWLERS.map((c) => (c.token === "GPTBot" || c.token === "CCBot" ? { ...c, policy: "disallow" } : c));
    expect(disallowedCrawlerTokens(flipped)).toEqual(["GPTBot", "CCBot"]);
  });
});
