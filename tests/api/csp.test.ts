/**
 * Part 2B: strict nonce CSP, set by src/proxy.ts on every page response (and on the request, where Next
 * reads the nonce for its own scripts). The browser-level proof — injected inline script blocked, no
 * violations across the real journeys — is tests/e2e/security-headers.spec.mts (production build).
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy, cspMode } from "@/lib/security/csp";
import { proxy } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

const directive = (policy: string, name: string) =>
  policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `))?.split(/\s+/).slice(1) ?? null;
const page = (path = "/") => proxy(new NextRequest(`http://localhost:3000${path}`));

describe("buildContentSecurityPolicy", () => {
  const prod = buildContentSecurityPolicy({ nonce: "abc123==", isDev: false, upgradeInsecureRequests: true });

  it("scripts: this request's nonce + 'strict-dynamic' only — no 'unsafe-inline', no 'unsafe-eval', no host allowlist", () => {
    expect(directive(prod, "script-src")).toEqual(["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
  });

  it("locks down framing, plugins, base and form targets", () => {
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
    expect(directive(prod, "form-action")).toEqual(["'self'"]);
    expect(directive(prod, "default-src")).toEqual(["'self'"]);
  });

  it("third parties are listed by purpose, never as a blanket https:", () => {
    for (const name of ["img-src", "connect-src", "frame-src", "style-src", "font-src", "worker-src"]) {
      expect(directive(prod, name), name).not.toContain("https:");
      expect(directive(prod, name), name).not.toContain("*");
    }
    expect(directive(prod, "frame-src")).toEqual(["https://accounts.google.com/gsi/"]);
    expect(directive(prod, "connect-src")).toEqual([
      "'self'",
      "https://pubchem.ncbi.nlm.nih.gov",
      "https://en.wikipedia.org",
      "https://accounts.google.com/gsi/",
    ]);
    expect(directive(prod, "img-src")).toEqual(["'self'", "data:", "blob:", "https://upload.wikimedia.org"]);
  });

  it("'unsafe-eval' only in development; upgrade-insecure-requests only when asked", () => {
    const dev = buildContentSecurityPolicy({ nonce: "n", isDev: true, upgradeInsecureRequests: false });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("CSP_MODE=report-only is the only way to stop enforcing", () => {
    expect(cspMode({} as NodeJS.ProcessEnv)).toBe("enforce");
    expect(cspMode({ CSP_MODE: "off" } as unknown as NodeJS.ProcessEnv)).toBe("enforce");
    expect(cspMode({ CSP_MODE: " Report-Only " } as unknown as NodeJS.ProcessEnv)).toBe("report-only");
  });
});

describe("proxy sets the CSP on every page", () => {
  it("a fresh 128-bit nonce per request, on the response and forwarded to rendering (request header + x-nonce)", async () => {
    const a = await page("/");
    const b = await page("/explore");
    const policyA = a.headers.get("content-security-policy")!;
    const policyB = b.headers.get("content-security-policy")!;
    const nonceA = policyA.match(/'nonce-([^']+)'/)![1]!;
    const nonceB = policyB.match(/'nonce-([^']+)'/)![1]!;
    expect(nonceA).not.toBe(nonceB);
    expect(Buffer.from(nonceA, "base64")).toHaveLength(16);
    // NextResponse.next({ request: { headers } }) forwards overridden request headers like this.
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonceA);
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(policyA);
  });

  it("CSP_MODE=report-only sends Content-Security-Policy-Report-Only instead (and Next still finds the nonce)", async () => {
    vi.stubEnv("CSP_MODE", "report-only");
    const res = await page("/");
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-security-policy-report-only")).toMatch(/'nonce-/);
    expect(res.headers.get("x-middleware-request-content-security-policy-report-only")).toMatch(/'nonce-/);
  });

  it("upgrade-insecure-requests only in production behind https", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRONTEND_URL", "http://localhost:3000");
    expect((await page()).headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
    vi.stubEnv("FRONTEND_URL", "https://studio.example");
    expect((await page()).headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
  });
});
