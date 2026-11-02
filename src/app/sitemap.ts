import type { MetadataRoute } from "next";
import { indexableRoutes } from "@/lib/seo/routes";
import { resolveSiteIndexing } from "@/lib/seo/site";

// SEO-20: SITE_URL is read on every request, never baked in at build time.
export const dynamic = "force-dynamic";

/**
 * SEO-02. Absolute canonical URLs of the indexable public routes only (the list in src/lib/seo/routes.ts); a dynamic
 * route (`/molecules/[id]`) contributes one URL per id, never its template path.
 * No `lastmod`: no page has a reliable modification date, and Google uses the field only when it is
 * "consistently and verifiably accurate". Empty while the site is not indexable.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = resolveSiteIndexing();
  if (!site.indexable) return [];
  const paths = indexableRoutes().flatMap((route) =>
    route.dynamic ? route.dynamic.ids.map((id) => route.path.replace(/\[[^\]]+\]/, id)) : [route.path],
  );
  return paths.map((path) => ({ url: path === "/" ? site.origin : `${site.origin}${path}` }));
}
