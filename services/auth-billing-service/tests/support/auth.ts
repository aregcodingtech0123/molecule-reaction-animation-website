import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { signToken } from "../../src/utils/jwt.js";
import { TEST_ENV } from "../setup/env";

export function tokenFor(user: { id: string; email: string }): string {
  return signToken({ sub: user.id, email: user.email });
}

export function bearer(user: { id: string; email: string }): string {
  return `Bearer ${tokenFor(user)}`;
}

/** Hand-rolled JWTs for negative cases. Defaults match what the service issues. */
export function craftToken(
  claims: Record<string, unknown> = {},
  opts: { secret?: string; algorithm?: jwt.Algorithm; issuer?: string; audience?: string; expiresIn?: number; jwtid?: string | null } = {},
): string {
  const payload: Record<string, unknown> = { sub: randomUUID(), email: "crafted@example.test", ...claims };
  const signOpts: jwt.SignOptions = {
    algorithm: opts.algorithm ?? "HS256",
    issuer: opts.issuer ?? "moleculestudio-auth-billing",
    audience: opts.audience ?? "moleculestudio-api",
  };
  if (opts.expiresIn !== undefined) signOpts.expiresIn = opts.expiresIn;
  else signOpts.expiresIn = 3600;
  if (opts.jwtid !== null) signOpts.jwtid = opts.jwtid ?? randomUUID();
  return jwt.sign(payload, opts.secret ?? TEST_ENV.JWT_SECRET, signOpts);
}

/** `alg: none` token with the right claims — must never be accepted. */
export function unsignedToken(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    iss: "moleculestudio-auth-billing",
    aud: "moleculestudio-api",
    jti: randomUUID(),
    iat: now,
    exp: now + 3600,
    ...claims,
  })}.`;
}

/** Unique client IP per call so per-IP rate limiters never couple tests (app trusts 1 proxy hop). */
let ipCounter = 1;
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}
