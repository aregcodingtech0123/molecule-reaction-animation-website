import type { Metadata, ResolvingMetadata } from "next";
import { metadataBaseUrl, resolveSiteIndexing, SITE_NAME } from "@/lib/seo/site";
import { seoRoute, type RouteRobots, type SeoRoute } from "@/lib/seo/routes";
import { moleculePageFacts, moleculeSummary } from "@/lib/molecules/page-facts";

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
    return pageMetadata(seoRoute(path), await parent);
  };
}

/**
 * `generateMetadata` for `/molecules/[id]` (Part 2): the registry's template filled from the verified page facts
 * (src/lib/molecules/page-facts.ts). Synchronous data, so nothing is streamed (SEO-12). Unknown ids get nothing here:
 * the page itself calls notFound().
 */
export async function moleculeMetadata(
  { params }: { params: Promise<{ id: string }> },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { id } = await params;
  const facts = moleculePageFacts(id);
  if (!facts) return {};
  const template = seoRoute("/molecules/[id]");
  const title = template.title.replace("{name}", facts.molecule.name).replace("{formula}", facts.molecule.formula);
  const description = template.description.replace("{summary}", moleculeSummary(facts));
  return pageMetadata({ ...template, path: `/molecules/${id}`, title, description }, await parent);
}

function pageMetadata(route: Pick<SeoRoute, "path" | "title" | "description" | "robots">, parent: Awaited<ResolvingMetadata>): Metadata {
  const path = route.path;
  if (route.robots !== "index") {
    return { title: route.title, description: route.description, robots: ROBOTS[route.robots] };
  }
  const canonical = resolveSiteIndexing().indexable;
  // A child `openGraph` / `twitter` object replaces the root one entirely, including the generated share image.
  const { openGraph: shared, twitter: sharedTwitter } = parent;
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
}
