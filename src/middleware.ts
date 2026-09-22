import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_TOKEN_COOKIE } from "@/lib/auth/session";
import { resolveSessionTokenFromRequest } from "@/lib/auth/resolve-session-token";
import { verifyJwtToken } from "@/lib/auth/verify-jwt";

const PROTECTED_PREFIXES = ["/dashboard", "/ai-lab", "/profile"];

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
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

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

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/ai-lab/:path*", "/profile/:path*"],
};
