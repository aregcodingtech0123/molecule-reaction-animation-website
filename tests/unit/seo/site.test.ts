/** SEO-20 (owner decision D3): indexing is allowed only for a valid https SITE_URL on a production deployment. */
import { describe, expect, it } from "vitest";
import { metadataBaseUrl, resolveSiteIndexing } from "@/lib/seo/site";

describe("resolveSiteIndexing", () => {
  it("indexable for a valid https origin (trailing slash normalised)", () => {
    expect(resolveSiteIndexing({ SITE_URL: "https://studio.example" })).toEqual({ indexable: true, origin: "https://studio.example" });
    expect(resolveSiteIndexing({ SITE_URL: " https://studio.example/ " })).toEqual({ indexable: true, origin: "https://studio.example" });
  });

  it("indexable on Vercel only when VERCEL_ENV is production", () => {
    expect(resolveSiteIndexing({ SITE_URL: "https://studio.example", VERCEL_ENV: "production" }).indexable).toBe(true);
  });

  it.each(["preview", "development", "staging"])("not indexable on a %s deployment", (vercelEnv) => {
    expect(resolveSiteIndexing({ SITE_URL: "https://studio.example", VERCEL_ENV: vercelEnv })).toMatchObject({
      indexable: false,
      reason: "non-production-deployment",
    });
  });

  it.each([
    [undefined, "unset"],
    ["", "unset"],
    ["   ", "unset"],
    ["studio.example", "invalid"],
    ["not a url", "invalid"],
    ["http://studio.example", "not-https"],
    ["ftp://studio.example", "not-https"],
    ["https://studio.example/en", "not-an-origin"],
    ["https://studio.example/?a=1", "not-an-origin"],
    ["https://studio.example/#top", "not-an-origin"],
    ["https://user:pw@studio.example", "not-an-origin"],
  ])("fails closed for %j (%s)", (value, reason) => {
    expect(resolveSiteIndexing({ SITE_URL: value })).toMatchObject({ indexable: false, reason });
  });

  it("is read from the environment passed in on every call (never frozen)", () => {
    const env: Record<string, string | undefined> = { SITE_URL: "https://a.example" };
    expect(resolveSiteIndexing(env)).toMatchObject({ indexable: true, origin: "https://a.example" });
    env.SITE_URL = undefined;
    expect(resolveSiteIndexing(env)).toMatchObject({ indexable: false, reason: "unset" });
  });

  it("does not read NEXT_PUBLIC_SITE_URL", () => {
    expect(resolveSiteIndexing({ NEXT_PUBLIC_SITE_URL: "https://studio.example" })).toMatchObject({ indexable: false, reason: "unset" });
  });
});

describe("metadataBaseUrl", () => {
  it("prefers SITE_URL, then FRONTEND_URL, then localhost", () => {
    expect(metadataBaseUrl({ SITE_URL: "https://studio.example", FRONTEND_URL: "https://other.example" }).href).toBe("https://studio.example/");
    expect(metadataBaseUrl({ FRONTEND_URL: "https://other.example/" }).href).toBe("https://other.example/");
    expect(metadataBaseUrl({ SITE_URL: "garbage", FRONTEND_URL: "http://localhost:3000" }).href).toBe("http://localhost:3000/");
    expect(metadataBaseUrl({}).href).toBe("http://localhost:3000/");
  });
});
