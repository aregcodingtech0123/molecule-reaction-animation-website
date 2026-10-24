import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { JwtPayload } from "../types/index.js";

export interface SignTokenInput {
  sub: string;
  email: string;
  /** users.token_version at issue time (FINDING-18 / FINDING-34). */
  tv: number;
}

export function signToken(payload: SignTokenInput): string {
  const jti = randomUUID();

  return jwt.sign(
    {
      sub: payload.sub,
      email: payload.email,
      tv: payload.tv,
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"],
      issuer: "moleculestudio-auth-billing",
      audience: "moleculestudio-api",
      algorithm: "HS256",
      jwtid: jti,
    },
  );
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.jwtSecret, {
    issuer: "moleculestudio-auth-billing",
    audience: "moleculestudio-api",
    algorithms: ["HS256"],
  }) as jwt.JwtPayload;

  const sub = typeof decoded.sub === "string" ? decoded.sub : null;
  const email = typeof decoded.email === "string" ? decoded.email : null;
  const jti =
    typeof decoded.jti === "string"
      ? decoded.jti
      : typeof decoded.jwtid === "string"
        ? decoded.jwtid
        : null;
  const exp = typeof decoded.exp === "number" ? decoded.exp : null;
  // Tokens issued before session versioning carry no `tv` and are rejected (one-time logout).
  const tv = Number.isInteger(decoded.tv) && (decoded.tv as number) >= 0 ? (decoded.tv as number) : null;

  if (!sub || !email || !jti || !exp || tv === null) {
    throw new jwt.JsonWebTokenError("Invalid token payload.");
  }

  return { sub, email, jti, exp, tv };
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.trim()) return null;
  const match = header.trim().match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
