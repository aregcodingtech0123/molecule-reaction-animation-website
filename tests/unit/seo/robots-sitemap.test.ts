/** SEO-01/02/20: robots.txt and sitemap.xml in every indexing mode, and the AI-crawler policy. */
import type { MetadataRoute } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { AI_CRAWLERS, disallowedCrawlerTokens, type AiCrawler } from "@/lib/seo/crawler-policy";
import { INDEXABLE_ROUTES, SEO_ROUTES } from "@/lib/seo/routes";

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
    for (const route of SEO_ROUTES.filter((x) => x.robots !== "index")) {
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
      "https://studio.example/pricing",
    ]);
    expect(entries.length).toBe(INDEXABLE_ROUTES.length);
    for (const e of entries) expect(e).not.toHaveProperty("lastModified");
  });

  it("never contains a gated, auth or coming-soon route", () => {
    indexable();
    const urls = sitemap().map((e) => e.url);
    for (const p of ["/dashboard", "/ai-lab", "/profile", "/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/learn", "/showcase"]) {
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
