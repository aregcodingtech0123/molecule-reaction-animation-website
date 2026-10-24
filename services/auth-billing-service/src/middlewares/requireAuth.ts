import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { extractBearerToken, verifyToken } from "../utils/jwt.js";
import { isJtiRevoked } from "../services/tokenRevocation.service.js";
import { pool } from "../db/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { AppError } from "../types/index.js";

/**
 * Validates Bearer JWT signature/claims, then rejects blacklisted `jti` values.
 * Revocation check is a primary-key SELECT (plus optional in-process positive cache).
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
    }

    const payload = verifyToken(token);

    if (await isJtiRevoked(payload.jti)) {
      throw new AppError(401, "Token has been revoked.", "TOKEN_REVOKED");
    }

    // Session generation: a password reset or an account takeover by Google sign-in bumps
    // users.token_version and so revokes every older token. (A token for a user that no longer
    // exists is left to the route, which answers 404.)
    if (UUID_RE.test(payload.sub)) {
      const { rows } = await pool.query<{ token_version: number }>(
        `SELECT token_version FROM users WHERE id = $1`,
        [payload.sub],
      );
      if (rows[0] && rows[0].token_version !== payload.tv) {
        throw new AppError(401, "Token has been revoked.", "TOKEN_REVOKED");
      }
    }

    req.user = payload;
    req.userId = payload.sub;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      next(new AppError(401, "Invalid or expired token.", "INVALID_TOKEN"));
      return;
    }
    next(err);
  }
}
