/** SEO-03/04/05/06/09: every page is classified, gated and auth pages are noindex, titles and descriptions are real and unique. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_PREFIXES } from "@/proxy";
import { CREDIT_PACKAGES } from "@/lib/billing/checkout";
import { INDEXABLE_ROUTES, SEO_ROUTES, seoRoute } from "@/lib/seo/routes";

const appDir = path.resolve(__dirname, "../../../src/app");

function pageRoutes(dir = appDir, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "api") continue;
      found.push(...pageRoutes(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === "page.tsx") {
      found.push(prefix || "/");
    }
  }
  return found;
}

describe("SEO route registry", () => {
  it("classifies exactly the pages that exist under src/app (a new page cannot be forgotten)", () => {
    expect(SEO_ROUTES.map((r) => r.path).sort()).toEqual(pageRoutes().sort());
  });

  it("indexes only the public product pages", () => {
    expect(INDEXABLE_ROUTES.map((r) => r.path)).toEqual(["/", "/explore", "/atom-models", "/periodic-table", "/pricing"]);
  });

  it.each(["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"])("%s is noindex, nofollow", (p) => {
    expect(seoRoute(p).robots).toBe("noindex");
  });

  it("every gated route is noindex", () => {
    for (const prefix of PROTECTED_PREFIXES) expect(seoRoute(prefix).robots, prefix).toBe("noindex");
  });

  it("/learn and /showcase (coming soon) are noindex", () => {
    expect(seoRoute("/learn").robots).toBe("noindex-follow");
    expect(seoRoute("/showcase").robots).toBe("noindex-follow");
  });

  it("titles and descriptions are unique and a sensible length", () => {
    const titles = SEO_ROUTES.map((r) => r.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const r of INDEXABLE_ROUTES) {
      expect(r.description.length, r.path).toBeGreaterThanOrEqual(70);
      expect(r.description.length, r.path).toBeLessThanOrEqual(240);
      expect(r.title.length, r.path).toBeLessThanOrEqual(60);
    }
    const descriptions = INDEXABLE_ROUTES.map((r) => r.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("the pricing description is built from the credit packs the page renders", () => {
    const description = seoRoute("/pricing").description;
    for (const pkg of CREDIT_PACKAGES) expect(description).toContain(`${pkg.name} $${pkg.priceUsd} for ${pkg.credits} credits`);
  });

  it("makes no unverifiable claims (ratings, rankings, best-in-class)", () => {
    for (const r of SEO_ROUTES) {
      expect(`${r.title} ${r.description}`, r.path).not.toMatch(/\b(best|#1|top-rated|award|rated|reviews?|stars?|trusted by)\b/i);
    }
  });

  it("an unregistered path throws instead of producing default metadata", () => {
    expect(() => seoRoute("/nope")).toThrow(/No SEO route/);
  });
});
