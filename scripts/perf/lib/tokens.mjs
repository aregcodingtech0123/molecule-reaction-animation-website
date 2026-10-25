/**
 * Session tokens for seeded users, with exactly the claims the service's signToken() issues
 * (services/auth-billing-service/src/utils/jwt.ts). The runner checks one against GET /api/auth/me
 * before measuring, so a drift in the claim set fails loudly instead of measuring 401s.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { serviceRoot } from "../config.mjs";

const jwt = createRequire(path.join(serviceRoot, "package.json"))("jsonwebtoken");

export function mintSession(secret, user, expiresIn = "2h") {
  return jwt.sign({ sub: user.id, email: user.email, tv: user.token_version }, secret, {
    expiresIn,
    issuer: "moleculestudio-auth-billing",
    audience: "moleculestudio-api",
    algorithm: "HS256",
    jwtid: randomUUID(),
  });
}
