import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db/prisma.js";
import { extractBearerToken, verifyAccessToken } from "../lib/jwt.js";
import type { AccessTokenPayload } from "../lib/jwt.js";
import { AppError } from "../types/index.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
    }
  }
}

/**
 * Validates Bearer JWT from the gateway-forwarded Authorization header.
 * Attaches decoded claims to `req.auth`.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
    }

    const payload = verifyAccessToken(token);

    const session = await prisma.sessionToken.findUnique({
      where: { jti: payload.jti },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AppError(401, "Session expired or revoked.", "SESSION_INVALID");
    }

    req.auth = payload;
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
