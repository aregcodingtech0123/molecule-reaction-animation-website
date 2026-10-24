/**
 * Cross-site request guard for state-changing BFF requests (login CSRF, logout
 * CSRF, cookie injection). Browsers send Origin on cross-origin POSTs and
 * Sec-Fetch-Site on every request; server-to-server callers send neither and
 * are not affected.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const frontend = (env.FRONTEND_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  const devOrigins = env.NODE_ENV === "production" ? [] : ["http://localhost:3000", "http://127.0.0.1:3000"];
  return [...new Set([frontend, ...devOrigins])];
}

export function isCrossSiteRequest(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return !allowedOrigins(env).includes(origin);
}

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function crossSiteRejection(): Response {
  return Response.json(
    { success: false, error: "Cross-site request refused.", code: "CSRF_REJECTED" },
    { status: 403 },
  );
}
