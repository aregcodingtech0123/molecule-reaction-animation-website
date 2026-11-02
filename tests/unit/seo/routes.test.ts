/** SEO-03/04/05/06/09: every page is classified, gated and auth pages are noindex, titles and descriptions are real and unique. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_PREFIXES } from "@/proxy";
import { CREDIT_PACKAGES } from "@/lib/billing/checkout";
import { indexableRoutes, seoRoutes, seoRoute } from "@/lib/seo/routes";
import { FULL_OWNER_ENV, OPTIONAL_OWNER_VARS, ownerEnvWithout } from "../../support/site-owner-env";

// The draft state: no SITE_OWNER_* variable set (tests/setup/owner-env.ts clears them).
const SEO_ROUTES = seoRoutes({});
const INDEXABLE_ROUTES = indexableRoutes({});
import { ALL_MOLECULES } from "@/lib/molecules/data";

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

  const PUBLIC = ["/", "/explore", "/atom-models", "/periodic-table", "/molecules", "/molecules/[id]"];
  const TRUST = ["/about", "/contact", "/privacy", "/terms"];

  it("indexes only the public product pages and the molecule pages while the owner variables are missing (the draft state)", () => {
    expect(INDEXABLE_ROUTES.map((r) => r.path)).toEqual([...PUBLIC, "/pricing"]);
  });

  it("indexes the four trust pages too once every required SITE_OWNER_* variable is set and valid; the optional ones are not needed", () => {
    expect(indexableRoutes(FULL_OWNER_ENV).map((r) => r.path)).toEqual([...PUBLIC, ...TRUST, "/pricing"]);
    expect(indexableRoutes(ownerEnvWithout(...OPTIONAL_OWNER_VARS))).toHaveLength(indexableRoutes(FULL_OWNER_ENV).length);
  });

  it("the trust pages are noindex (links followed) while any required owner variable is missing or invalid (D6)", () => {
    for (const p of TRUST) expect(seoRoute(p, {}).robots, p).toBe("noindex-follow");
    for (const name of Object.keys(FULL_OWNER_ENV).filter((n) => !OPTIONAL_OWNER_VARS.includes(n))) {
      expect(seoRoute("/privacy", ownerEnvWithout(name)).robots, `without ${name}`).toBe("noindex-follow");
    }
    expect(seoRoute("/terms", { ...FULL_OWNER_ENV, SITE_OWNER_CONTACT_EMAIL: "not an email" }).robots).toBe("noindex-follow");
    expect(seoRoute("/terms", { ...FULL_OWNER_ENV, SITE_OWNER_EFFECTIVE_DATE: "2026-13-40" }).robots).toBe("noindex-follow");
    expect(seoRoute("/terms", { ...FULL_OWNER_ENV, SITE_OWNER_EMAIL_TOMBSTONE_GUARD: "maybe" }).robots).toBe("noindex-follow");
    for (const p of TRUST) expect(seoRoute(p, FULL_OWNER_ENV).robots, p).toBe("index");
  });

  it("the only dynamic route is /molecules/[id], with exactly one id per molecule", () => {
    expect(SEO_ROUTES.filter((r) => r.dynamic).map((r) => r.path)).toEqual(["/molecules/[id]"]);
    expect(seoRoute("/molecules/[id]").dynamic!.ids).toEqual(ALL_MOLECULES.map((m) => m.id));
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
    // a dynamic route's title/description are templates; the filled-in ones are checked in metadata.test.ts
    for (const r of INDEXABLE_ROUTES.filter((x) => !x.dynamic)) {
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
