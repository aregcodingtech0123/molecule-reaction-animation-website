import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import type { UserRole } from "@prisma/client";
import { env } from "../config/env.js";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  jti: string;
}

export interface SignedToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

export function signAccessToken(params: {
  userId: string;
  email: string;
  role: UserRole;
}): SignedToken {
  const jti = uuidv4().replace(/-/g, "");
  const expiresIn = env.jwtExpiresIn as jwt.SignOptions["expiresIn"];

  const token = jwt.sign(
    {
      sub: params.userId,
      email: params.email,
      role: params.role,
      jti,
    } satisfies AccessTokenPayload,
    env.jwtSecret,
    {
      expiresIn,
      issuer: "moleculestudio-auth",
      audience: "moleculestudio-api",
      algorithm: "HS256",
    },
  );

  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  return { token, jti, expiresAt };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret, {
    issuer: "moleculestudio-auth",
    audience: "moleculestudio-api",
    algorithms: ["HS256"],
  }) as AccessTokenPayload;

  if (!payload.sub || !payload.jti || !payload.email || !payload.role) {
    throw new jwt.JsonWebTokenError("Invalid token payload.");
  }

  return payload;
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.trim()) return null;
  const match = header.trim().match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
