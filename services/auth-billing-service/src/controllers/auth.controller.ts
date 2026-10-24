import type { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service.js";
import { AppError } from "../types/index.js";
import { extractBearerToken, verifyToken } from "../utils/jwt.js";
import jwt from "jsonwebtoken";

/** Trusted client IP (see middlewares/resolveClientIp.ts) — never a raw X-Forwarded-For value. */
function clientIp(req: Request): string | null {
  return req.clientIp ?? req.ip ?? null;
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, firstName, lastName, dateOfBirth } = req.body ?? {};
    const result = await authService.registerUser(
      email,
      password,
      { firstName, lastName, dateOfBirth },
      clientIp(req),
    );

    // Identical for new and existing emails (FINDING-09).
    res.status(200).json({ success: true, data: { message: result.message } });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body ?? {};
    const result = await authService.loginUser(email, password);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function google(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body ?? {};
    const idToken = body.idToken ?? body.credential;
    const result = await authService.loginWithGoogle(idToken, clientIp(req));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.body?.token ?? req.query?.token;
    const result = await authService.verifyEmailWithToken(token);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function resendVerification(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await authService.resendVerificationEmail(req.body?.email);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await authService.forgotPassword(req.body?.email);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token, password } = req.body ?? {};
    const result = await authService.resetPassword(token, password);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/** Authenticated session probe — used by Next.js /api/chat verification gate. */
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
    }
    const status = await authService.getUserVerificationStatus(userId);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = extractBearerToken(req.headers.authorization);
    if (!raw) {
      throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
    }

    let payload;
    try {
      payload = verifyToken(raw);
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
        throw new AppError(401, "Invalid or expired token.", "INVALID_TOKEN");
      }
      throw err;
    }

    const result = await authService.logoutCurrentToken(payload.jti, payload.exp);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
