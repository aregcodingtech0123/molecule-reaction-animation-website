/** SEO-03/04/05/07/20: what each route's metadata says, in each indexing mode. */
import type { ResolvingMetadata } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rootMetadata, routeMetadata } from "@/lib/seo/metadata";
import { SEO_ROUTES } from "@/lib/seo/routes";

afterEach(() => vi.unstubAllEnvs());

const IMAGES = [{ url: "/opengraph-image", width: 1200, height: 630 }];
const parent = Promise.resolve({ openGraph: { images: IMAGES }, twitter: { images: IMAGES } }) as unknown as ResolvingMetadata;
const meta = (path: string) => routeMetadata(path)({}, parent);
const indexable = () => {
  vi.stubEnv("SITE_URL", "https://studio.example");
  vi.stubEnv("VERCEL_ENV", "");
};

describe("rootMetadata", () => {
  it("indexable site: no robots directive, metadataBase = SITE_URL, title template with the site name", () => {
    const m = rootMetadata({ SITE_URL: "https://studio.example" });
    expect(m.robots).toBeUndefined();
    expect(String(m.metadataBase)).toBe("https://studio.example/");
    expect(m.title).toMatchObject({ template: "%s · Molecule Architecture Studio" });
  });

  it.each([{}, { SITE_URL: "http://studio.example" }, { SITE_URL: "https://studio.example", VERCEL_ENV: "preview" }])(
    "fail closed %j: noindex, nofollow in the HTML as well",
    (env) => {
      expect(rootMetadata(env).robots).toEqual({ index: false, follow: false });
    },
  );
});

describe("routeMetadata", () => {
  it("indexable routes: canonical without query, own title/description, Open Graph + Twitter with the share image", async () => {
    indexable();
    const m = await meta("/explore");
    expect(m.alternates).toEqual({ canonical: "/explore" });
    expect(m.title).toBe("Explore molecules in 3D");
    expect(m.openGraph).toMatchObject({ url: "/explore", type: "website", images: IMAGES });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: IMAGES });
    expect(m.robots).toBeUndefined();
  });

  it("the home route keeps the root default title and canonicalises to /", async () => {
    indexable();
    const m = await meta("/");
    expect(m.title).toBeUndefined();
    expect(m.alternates).toEqual({ canonical: "/" });
  });

  it("while the site is not indexable there is no canonical and no og:url", async () => {
    vi.stubEnv("SITE_URL", "");
    const m = await meta("/pricing");
    expect(m.alternates).toBeUndefined();
    expect(m.openGraph).not.toHaveProperty("url");
  });

  it.each(SEO_ROUTES.filter((r) => r.robots !== "index"))("$path is noindex and has no canonical", async (route) => {
    indexable();
    const m = await meta(route.path);
    expect(m.robots).toMatchObject({ index: false });
    expect(m.alternates).toBeUndefined();
    expect(m.title).toBe(route.title);
  });

  it("auth and gated pages do not follow links; coming-soon pages do", async () => {
    expect((await meta("/login")).robots).toEqual({ index: false, follow: false });
    expect((await meta("/dashboard")).robots).toEqual({ index: false, follow: false });
    expect((await meta("/learn")).robots).toEqual({ index: false, follow: true });
  });
});
