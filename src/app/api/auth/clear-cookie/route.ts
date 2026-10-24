import { cookies } from "next/headers";
import { SESSION_TOKEN_COOKIE } from "@/lib/auth/session";
import { crossSiteRejection, isCrossSiteRequest } from "@/lib/security/csrf";

/** POST only (other methods → 405). Cross-site callers cannot log a user out (logout CSRF). */
export async function POST(request: Request) {
  if (isCrossSiteRequest(request)) return crossSiteRejection();
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_TOKEN_COOKIE);
  return Response.json({ success: true });
}
