import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export const INTERNAL_SERVICE_HEADER = "x-internal-service-key";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Gate for endpoints only the Next.js BFF may call (AI credit metering).
 *
 * Express is publicly reachable (Lemon Squeezy webhooks), so these routes must
 * not be usable by browsers or the internet even with a valid user JWT. A
 * missing or wrong key gets the same 404 body as an unknown route, so the
 * endpoints are not advertised. Comparison is constant-time over SHA-256
 * digests (equal length regardless of input). The key is never logged.
 */
export function requireInternalService(req: Request, res: Response, next: NextFunction): void {
  const configured = env.internalServiceSecret;
  const provided = req.headers[INTERNAL_SERVICE_HEADER];
  const value = typeof provided === "string" ? provided : "";

  let reason: string | null = null;
  if (!configured) reason = "service_secret_not_configured";
  else if (!value) reason = "missing_key";
  else if (!timingSafeEqual(digest(value), digest(configured))) reason = "key_mismatch";

  if (reason) {
    console.warn("[internal-auth] Rejected internal-only request", {
      method: req.method,
      path: req.originalUrl.split("?")[0],
      ip: req.ip ?? null,
      reason,
    });
    res.status(404).json({ success: false, error: "Route not found." });
    return;
  }

  next();
}
