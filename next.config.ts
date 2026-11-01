import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Security headers for every response. The Content-Security-Policy is NOT here: it carries a fresh
 * nonce per request and is set by src/proxy.ts (see src/lib/security/csp.ts).
 */
const securityHeaders = [
  // Legacy twin of CSP frame-ancestors 'none'.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Google Identity Services' recommendation for production.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Isolates the window from cross-origin openers; keeps Google sign-in popups working (Google's guidance).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // HTTPS-only for two years once served over TLS (browsers ignore it over plain http). No `preload`: an
  // owner decision, hard to undo.
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

/** API routes answer JSON: nothing may load, frame it or be submitted to it (pages get the nonce CSP). */
const API_CSP = "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const nextConfig: NextConfig = {
  // Testability: the E2E suite runs its own `next dev` in `.next-e2e` so it never
  // collides with a developer's dev server (Next allows one dev server per distDir).
  // Unset → Next's default `.next`.
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  // No `X-Powered-By: Next.js` (fingerprinting).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // SEO-18 / R12: environment maps never change under the same name (the name carries the content hash).
        source: "/hdri/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: API_CSP }],
      },
    ];
  },
};

export default nextConfig;
