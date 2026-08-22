import { cookies } from "next/headers";
import { SESSION_TOKEN_COOKIE } from "./session";

/** Parse session_token from a raw Cookie header (middleware / gateway). */
export function parseSessionTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_TOKEN_COOKIE) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}

/** Read session JWT from an incoming Request (cookie first, then Authorization). */
export function resolveSessionTokenFromRequest(request: Request): string | null {
  const cookieToken = parseSessionTokenFromCookieHeader(request.headers.get("cookie"));
  if (cookieToken) return cookieToken;

  const authorization = request.headers.get("authorization");
  if (!authorization?.trim()) return null;
  const match = authorization.trim().match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

/** Read session JWT from Next.js App Router cookies(). */
export async function resolveSessionTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_TOKEN_COOKIE)?.value ?? null;
}
