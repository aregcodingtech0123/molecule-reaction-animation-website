import type { Metadata, ResolvingMetadata } from "next";
import { metadataBaseUrl, resolveSiteIndexing, SITE_NAME } from "@/lib/seo/site";
import { seoRoute, type RouteRobots } from "@/lib/seo/routes";

const ROBOTS: Record<Exclude<RouteRobots, "index">, NonNullable<Metadata["robots"]>> = {
  "noindex-follow": { index: false, follow: true },
  noindex: { index: false, follow: false },
};

/** Site-wide defaults (root layout). Child segments replace `robots`, `openGraph` and `twitter` as whole objects. */
export function rootMetadata(env: Record<string, string | undefined> = process.env): Metadata {
  const home = seoRoute("/");
  return {
    metadataBase: metadataBaseUrl(env),
    title: { default: `${SITE_NAME} · ${home.title}`, template: `%s · ${SITE_NAME}` },
    description: home.description,
    applicationName: SITE_NAME,
    // SEO-20: while the site URL does not allow indexing, every page says so in its own HTML too.
    ...(resolveSiteIndexing(env).indexable ? {} : { robots: { index: false, follow: false } }),
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", title: SITE_NAME, description: home.description },
    twitter: { card: "summary_large_image", title: SITE_NAME, description: home.description },
  };
}

/**
 * `generateMetadata` for one registered route. Indexable routes get a canonical URL (the path without any query
 * string, so `/explore?molecule=…` variants all canonicalise to `/explore`, SEO-03) plus Open Graph / Twitter
 * text; the others get `noindex`. The canonical is left out while the site is not indexable.
 */
export function routeMetadata(path: string) {
  return async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
    const route = seoRoute(path);
    if (route.robots !== "index") {
      return { title: route.title, description: route.description, robots: ROBOTS[route.robots] };
    }
    const canonical = resolveSiteIndexing().indexable;
    // A child `openGraph` / `twitter` object replaces the root one entirely, including the generated share image.
    const { openGraph: shared, twitter: sharedTwitter } = await parent;
    const title = path === "/" ? undefined : route.title;
    const ogTitle = path === "/" ? `${SITE_NAME} · ${route.title}` : `${route.title} · ${SITE_NAME}`;
    return {
      ...(title ? { title } : {}),
      description: route.description,
      ...(canonical ? { alternates: { canonical: path } } : {}),
      openGraph: {
        type: "website",
        siteName: SITE_NAME,
        locale: "en_US",
        title: ogTitle,
        description: route.description,
        ...(canonical ? { url: path } : {}),
        images: shared?.images,
      },
      twitter: { card: "summary_large_image", title: ogTitle, description: route.description, images: sharedTwitter?.images ?? shared?.images },
    };
  };
}
