import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export const INTERNAL_SERVICE_HEADER = "x-internal-service-key";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

type KeyCheck = "ok" | "service_secret_not_configured" | "missing_key" | "key_mismatch";

function checkInternalKey(req: Request): KeyCheck {
  const configured = env.internalServiceSecret;
  const provided = req.headers[INTERNAL_SERVICE_HEADER];
  const value = typeof provided === "string" ? provided : "";
  if (!configured) return "service_secret_not_configured";
  if (!value) return "missing_key";
  // Constant-time over SHA-256 digests (equal length regardless of input).
  return timingSafeEqual(digest(value), digest(configured)) ? "ok" : "key_mismatch";
}

/** True when the request carries the correct internal service key (the Next.js BFF). */
export function hasValidInternalKey(req: Request): boolean {
  return checkInternalKey(req) === "ok";
}

/**
 * Gate for endpoints only the Next.js BFF may call (AI credit metering).
 *
 * Express is publicly reachable (Lemon Squeezy webhooks), so these routes must
 * not be usable by browsers or the internet even with a valid user JWT. A
 * missing or wrong key gets the same 404 body as an unknown route, so the
 * endpoints are not advertised. The key is never logged.
 */
export function requireInternalService(req: Request, res: Response, next: NextFunction): void {
  const result = checkInternalKey(req);
  if (result !== "ok") {
    console.warn("[internal-auth] Rejected internal-only request", {
      method: req.method,
      path: req.originalUrl.split("?")[0],
      ip: req.ip ?? null,
      reason: result,
    });
    res.status(404).json({ success: false, error: "Route not found." });
    return;
  }
  next();
}
