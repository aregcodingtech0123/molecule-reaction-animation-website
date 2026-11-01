import type { MetadataRoute } from "next";
import { disallowedCrawlerTokens } from "@/lib/seo/crawler-policy";
import { resolveSiteIndexing } from "@/lib/seo/site";

// SEO-20: SITE_URL is read on every request, never baked in at build time.
export const dynamic = "force-dynamic";

/**
 * SEO-01. Indexable site: everything is allowed except `/api/`, the sitemap is announced, and the AI-crawler
 * policy (src/lib/seo/crawler-policy.ts) adds a group for each token that is set to "disallow".
 * Not indexable (SITE_URL unset / not https / non-production deployment): `Disallow: /` for everyone, no sitemap.
 *
 * Auth, signed-in and "coming soon" pages are deliberately NOT disallowed here: a URL blocked in robots.txt
 * cannot show its `noindex` and may still be indexed from links; they carry `noindex` instead.
 */
export default function robots(): MetadataRoute.Robots {
  const site = resolveSiteIndexing();
  if (!site.indexable) return { rules: [{ userAgent: "*", disallow: "/" }] };

  const blocked = disallowedCrawlerTokens();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      ...blocked.map((userAgent) => ({ userAgent, disallow: "/" })),
    ],
    sitemap: `${site.origin}/sitemap.xml`,
  };
}
