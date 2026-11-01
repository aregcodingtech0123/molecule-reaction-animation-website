/**
 * Whether this deployment may be indexed (SEO-20, owner decision D3).
 *
 * `SITE_URL` is a server-only variable read on every request — never NEXT_PUBLIC_*, which Next inlines at
 * build time and would freeze one environment's value into a build that is later promoted. Search engines
 * may index only when it is a valid https origin AND, on Vercel, the deployment is the production one.
 * Anything else fails closed: noindex on every page, `Disallow: /` in robots.txt, an empty sitemap.
 */
export type NoindexReason = "unset" | "invalid" | "not-https" | "not-an-origin" | "non-production-deployment";

export type SiteIndexing =
  | { indexable: true; origin: string }
  | { indexable: false; reason: NoindexReason; origin: string | null };

export const SITE_NAME = "Molecule Architecture Studio";

type Env = Record<string, string | undefined>;

/** Human-readable explanation for logs and `npm run check:config` (never contains the value itself). */
export const NOINDEX_REASON_TEXT: Record<NoindexReason, string> = {
  unset: "SITE_URL is not set",
  invalid: "SITE_URL is not an absolute URL",
  "not-https": "SITE_URL does not use https",
  "not-an-origin": "SITE_URL must be an origin only (scheme://host), without a path, query or fragment",
  "non-production-deployment": "this is a non-production Vercel deployment (VERCEL_ENV is not \"production\")",
};

export function resolveSiteIndexing(env: Env = process.env): SiteIndexing {
  const raw = env.SITE_URL?.trim();
  if (!raw) return { indexable: false, reason: "unset", origin: null };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { indexable: false, reason: "invalid", origin: null };
  }
  if (url.protocol !== "https:") return { indexable: false, reason: "not-https", origin: null };
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    return { indexable: false, reason: "not-an-origin", origin: null };
  }

  const vercelEnv = env.VERCEL_ENV?.trim();
  if (vercelEnv && vercelEnv !== "production") {
    return { indexable: false, reason: "non-production-deployment", origin: url.origin };
  }
  return { indexable: true, origin: url.origin };
}

/**
 * Base for resolving relative metadata URLs (canonical, Open Graph image). Falls back to FRONTEND_URL (the
 * public origin the CSRF guard already needs) and finally to localhost so a misconfigured deployment still
 * renders; URLs built from the fallback only ever appear on pages that are noindex anyway.
 */
export function metadataBaseUrl(env: Env = process.env): URL {
  const site = resolveSiteIndexing(env);
  if (site.origin) return new URL(site.origin);
  for (const candidate of [env.SITE_URL, env.FRONTEND_URL]) {
    try {
      if (candidate?.trim()) return new URL(new URL(candidate.trim()).origin);
    } catch {
      /* try the next one */
    }
  }
  return new URL("http://localhost:3000");
}
