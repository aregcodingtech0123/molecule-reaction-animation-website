/** SEO-06 / SEO-20: X-Robots-Tag from the proxy, and the CSP is unchanged by it. */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());
const page = (path: string) => proxy(new NextRequest(`https://studio.example${path}`));

describe("proxy: X-Robots-Tag", () => {
  it("indexable site: public pages carry no X-Robots-Tag", async () => {
    vi.stubEnv("SITE_URL", "https://studio.example");
    vi.stubEnv("VERCEL_ENV", "");
    const res = await page("/pricing");
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  });

  it.each([
    ["SITE_URL unset", { SITE_URL: "" }],
    ["SITE_URL not https", { SITE_URL: "http://studio.example" }],
    ["non-production Vercel deployment", { SITE_URL: "https://studio.example", VERCEL_ENV: "preview" }],
  ])("%s: every page is noindex, nofollow and the CSP is still sent", async (_name, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const res = await page("/");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("content-security-policy")).toContain("'strict-dynamic'");
  });

  it("the signed-out redirect from a gated page is noindex (the gating itself is unchanged)", async () => {
    vi.stubEnv("SITE_URL", "https://studio.example");
    for (const path of ["/dashboard", "/ai-lab", "/profile"]) {
      const res = await page(path);
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex");
    }
  });
});
