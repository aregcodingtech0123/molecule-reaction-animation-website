/** SEO-16 (Part 2): JSON-LD is truthful, fail-closed, and cannot break out of its script element. */
import { describe, expect, it } from "vitest";
import { CREDIT_PACKAGES } from "@/lib/billing/checkout";
import { PLACEHOLDER_PREFIX, SITE_OWNER, type SiteOwner } from "@/lib/legal/site-owner";
import { breadcrumbJsonLd, organizationJsonLd, serializeJsonLd, webApplicationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";

const ON = { SITE_URL: "https://studio.example" };
const OFF_CASES = [{}, { SITE_URL: "http://studio.example" }, { SITE_URL: "https://studio.example", VERCEL_ENV: "preview" }];

const FILLED: SiteOwner = Object.fromEntries(Object.keys(SITE_OWNER).map((k) => [k, `real ${k}`])) as unknown as SiteOwner;

describe("JSON-LD builders", () => {
  it("WebSite: name + canonical home URL (Google's two required properties)", () => {
    expect(websiteJsonLd(ON)).toEqual({ "@context": "https://schema.org", "@type": "WebSite", name: "Molecule Architecture Studio", url: "https://studio.example/" });
  });

  it.each(OFF_CASES)("fails closed when the site is not indexable %j: nothing at all", (env) => {
    expect(websiteJsonLd(env)).toBeNull();
    expect(webApplicationJsonLd(env)).toBeNull();
    expect(organizationJsonLd(env, FILLED)).toBeNull();
    expect(breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "X" }], env)).toBeNull();
  });

  it("Organization: never while any owner detail is a placeholder (today), only once all are real", () => {
    expect(Object.values(SITE_OWNER).some((v) => v.startsWith(PLACEHOLDER_PREFIX))).toBe(true);
    expect(organizationJsonLd(ON)).toBeNull();
    expect(organizationJsonLd(ON, { ...FILLED, legalName: `${PLACEHOLDER_PREFIX} x` })).toBeNull();
    expect(organizationJsonLd(ON, FILLED)).toMatchObject({ "@type": "Organization", name: "real legalName", url: "https://studio.example/" });
  });

  it("WebApplication: exactly the credit packs /pricing renders, USD, and no rating or review (none exist)", () => {
    const app = webApplicationJsonLd(ON)!;
    expect(app["@type"]).toBe("WebApplication");
    expect(app.offers).toEqual(
      CREDIT_PACKAGES.map((p) => ({
        "@type": "Offer",
        name: `${p.name}: ${p.credits} AI Lab credits`,
        price: p.priceUsd.toFixed(2),
        priceCurrency: "USD",
        url: "https://studio.example/pricing",
      })),
    );
    expect(JSON.stringify(app)).not.toMatch(/aggregateRating|review|ratingValue/);
  });

  it("BreadcrumbList: at least two items; every item but the last has a URL", () => {
    expect(breadcrumbJsonLd([{ name: "Home", path: "/" }], ON)).toBeNull();
    const b = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Molecules", path: "/molecules" }, { name: "Water" }], ON)!;
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://studio.example/" },
      { "@type": "ListItem", position: 2, name: "Molecules", item: "https://studio.example/molecules" },
      { "@type": "ListItem", position: 3, name: "Water" },
    ]);
  });

  it("serialisation escapes '<' so a value can never close the script element", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  it("no FAQPage anywhere (Google ended FAQ rich results on May 7, 2026)", () => {
    const all = JSON.stringify([websiteJsonLd(ON), webApplicationJsonLd(ON), organizationJsonLd(ON, FILLED)]);
    expect(all).not.toContain("FAQPage");
  });
});
