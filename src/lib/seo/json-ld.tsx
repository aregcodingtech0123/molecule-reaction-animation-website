import { CREDIT_PACKAGES } from "@/lib/billing/checkout";
import { blockingFields, readSiteOwner } from "@/lib/legal/site-owner";
import { resolveSiteIndexing, SITE_NAME } from "@/lib/seo/site";

/**
 * Structured data (SEO-16, Part 2 design note §2). Rules:
 *  - only true descriptions of visible content, built from the same constants the pages render;
 *  - only while the site is indexable (absolute URLs need SITE_URL's origin; fail closed like SEO-20);
 *  - no Organization until every required SITE_OWNER_* variable is set (it would name nobody);
 *  - no FAQPage (Google ended FAQ rich results on May 7, 2026), no ratings or reviews (none exist).
 * A JSON-LD script is a data block, not executed: it needs no CSP nonce (verified in the production E2E).
 */
type Env = Record<string, string | undefined>;
export type JsonLdObject = Record<string, unknown>;

const CONTEXT = "https://schema.org";

/** `JSON.stringify` with `<` escaped, so a value can never close the script element (Next's JSON-LD guide). */
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function origin(env: Env): string | null {
  const site = resolveSiteIndexing(env);
  return site.indexable ? site.origin : null;
}

/** Home page: Google requires WebSite on the home page with `name` and `url`. */
export function websiteJsonLd(env: Env = process.env): JsonLdObject | null {
  const base = origin(env);
  if (!base) return null;
  return { "@context": CONTEXT, "@type": "WebSite", name: SITE_NAME, url: `${base}/` };
}

/** About: only once every required owner variable is set and valid; optional ones appear only when given. */
export function organizationJsonLd(env: Env = process.env, ownerEnv: Env = env): JsonLdObject | null {
  const base = origin(env);
  const status = readSiteOwner(ownerEnv);
  if (!base || blockingFields(status).length > 0) return null;
  const { owner } = status;
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    name: owner.legalName,
    url: `${base}/`,
    email: owner.contactEmail,
    address: owner.postalAddress.replace(/\n+/g, ", "),
    ...(owner.phone ? { telephone: owner.phone } : {}),
  };
}

/** Pricing: the app and the three credit packs exactly as /pricing renders them (no rating exists, none invented). */
export function webApplicationJsonLd(env: Env = process.env): JsonLdObject | null {
  const base = origin(env);
  if (!base) return null;
  return {
    "@context": CONTEXT,
    "@type": "WebApplication",
    name: SITE_NAME,
    url: `${base}/`,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any (web browser)",
    offers: CREDIT_PACKAGES.map((pack) => ({
      "@type": "Offer",
      name: `${pack.name}: ${pack.credits} AI Lab credits`,
      price: pack.priceUsd.toFixed(2),
      priceCurrency: "USD",
      url: `${base}/pricing`,
    })),
  };
}

/** Breadcrumbs: every item but the last has an `item` URL (Google: the last one does not need it). */
export function breadcrumbJsonLd(trail: { name: string; path?: string }[], env: Env = process.env): JsonLdObject | null {
  const base = origin(env);
  if (!base || trail.length < 2) return null;
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      ...(index < trail.length - 1 && crumb.path !== undefined ? { item: `${base}${crumb.path === "/" ? "/" : crumb.path}` } : {}),
    })),
  };
}

/** Renders the blocks that exist (nulls are skipped); renders nothing when none do. */
export function JsonLd({ data }: { data: (JsonLdObject | null)[] }) {
  const blocks = data.filter((d): d is JsonLdObject => d !== null);
  if (!blocks.length) return null;
  return (
    <>
      {blocks.map((block, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(block) }} />
      ))}
    </>
  );
}
