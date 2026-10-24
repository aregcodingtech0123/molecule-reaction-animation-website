import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { hasValidInternalKey } from "./requireInternalService.js";

export const CLIENT_IP_HEADER = "x-client-ip";

/**
 * Decide which IP the rate limiters (and signup_ip) see — FINDING-04.
 *
 *  - Requests from the Next.js BFF carry the internal service key and the end
 *    user's address in X-Client-IP; only then is that header honoured.
 *  - Every other request uses req.ip, which honours X-Forwarded-For only for
 *    TRUST_PROXY_HOPS proxy hops (default 0). A direct public caller therefore
 *    cannot pick its own rate-limit bucket by sending a forged header.
 */
export function resolveClientIp(req: Request, _res: Response, next: NextFunction): void {
  req.clientIp = req.ip ?? null;
  const supplied = req.headers[CLIENT_IP_HEADER];
  if (typeof supplied === "string") {
    const candidate = supplied.trim();
    if (isIP(candidate) && hasValidInternalKey(req)) {
      req.clientIp = candidate;
    }
  }
  next();
}
