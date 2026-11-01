import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_TOKEN_COOKIE } from "@/lib/auth/session";
import { resolveSessionTokenFromRequest } from "@/lib/auth/resolve-session-token";
import { verifyJwtToken } from "@/lib/auth/verify-jwt";
import { buildContentSecurityPolicy, cspHeaderName, cspMode, generateNonce } from "@/lib/security/csp";
import { resolveSiteIndexing } from "@/lib/seo/site";

/**
 * Runs before every page (Next 16 `proxy`, formerly `middleware`):
 *  1. a fresh CSP nonce per request (Part 2B) — Next reads it from the request's CSP header and puts it
 *     on its own scripts; the root layout reads `x-nonce` for the theme script;
 *  2. page gating for the signed-in areas (unchanged);
 *  3. SEO (SEO-06, SEO-20): the auth redirect is never indexed, and every response is `noindex` while the site URL
 *     says this deployment must not be indexed (unset, not https, or a non-production Vercel deployment).
 */
export const PROTECTED_PREFIXES = ["/dashboard", "/ai-lab", "/profile"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function redirectToAuthRequired(request: NextRequest): NextResponse {
  // Send unauthenticated users to the dedicated login page — never dump them
  // onto a public route with an auto-opened modal (?auth=required).
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.delete("auth");
  const response = NextResponse.redirect(url);
  // SEO-06: a signed-out crawler is redirected, never shown the page; keep the redirect out of any index too.
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

export async function proxy(request: NextRequest) {
  if (isProtectedPath(request.nextUrl.pathname)) {
    const token = resolveSessionTokenFromRequest(request);
    if (!token) {
      return redirectToAuthRequired(request);
    }
    const session = await verifyJwtToken(token);
    if (!session) {
      const response = redirectToAuthRequired(request);
      response.cookies.delete(SESSION_TOKEN_COOKIE);
      return response;
    }
  }

  const nonce = generateNonce();
  const header = cspHeaderName(cspMode());
  const policy = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    // Only behind https: on plain-http localhost it would rewrite same-origin requests.
    upgradeInsecureRequests: process.env.NODE_ENV === "production" && /^https:/i.test(process.env.FRONTEND_URL ?? ""),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(header, policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  // SEO-20: fail closed. Unless SITE_URL says this deployment is the indexable production site, no page is indexed.
  if (!resolveSiteIndexing().indexable) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  // Every HTML response — including 404 pages for paths like /robots.txt (found by the ZAP baseline) — but not
  // API routes (JSON, own static policy), build assets, or the public 3D environment maps.
  matcher: ["/((?!api/|_next/static|_next/image|favicon\\.ico$|hdri/).*)"],
};
