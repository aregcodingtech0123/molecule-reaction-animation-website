import * as jose from "jose";
import type { VerifiedSession } from "./session";

const ISSUER = "moleculestudio-auth-billing";
const AUDIENCE = "moleculestudio-api";

function getJwtSecret(): Uint8Array | null {
  const raw = process.env.JWT_SECRET?.trim();
  if (!raw || raw.length < 32) return null;
  return new TextEncoder().encode(raw);
}

export function isJwtConfigured(): boolean {
  return getJwtSecret() !== null;
}

/** Verify a JWT issued by auth-billing-service (HS256). */
export async function verifyJwtToken(token: string): Promise<VerifiedSession | null> {
  const secret = getJwtSecret();
  if (!secret) return null;

  try {
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });

    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : null;
    // Session generation claim (FINDING-18/34). Tokens issued before it existed are refused, so
    // the middleware sends their holders to /login and deletes the stale cookie.
    const tv = Number.isInteger(payload.tv) && (payload.tv as number) >= 0;
    if (!sub || !email || !tv) return null;

    return { sub, email };
  } catch {
    return null;
  }
}

export function extractBearerToken(authorization: string | null): string | null {
  if (!authorization?.trim()) return null;
  const match = authorization.trim().match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}
