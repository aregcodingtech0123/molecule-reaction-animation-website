import { SESSION_TOKEN_COOKIE } from "./session";

/**
 * Set-Cookie values for the httpOnly session, issued by the BFF itself
 * (FINDING-24): the JWT never appears in a response body the page can read.
 */

/** Seconds until the token's own `exp` (the cookie never outlives the JWT). */
export function secondsUntilExpiry(token: string, nowMs = Date.now()): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    if (typeof payload.exp !== "number") return 0;
    return Math.max(0, Math.floor(payload.exp - nowMs / 1000));
  } catch {
    return 0;
  }
}

function attributes(maxAge: number, env: NodeJS.ProcessEnv): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function sessionCookieHeader(token: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${SESSION_TOKEN_COOKIE}=${token}; ${attributes(secondsUntilExpiry(token), env)}`;
}

export function clearedSessionCookieHeader(env: NodeJS.ProcessEnv = process.env): string {
  return `${SESSION_TOKEN_COOKIE}=; ${attributes(0, env)}`;
}
