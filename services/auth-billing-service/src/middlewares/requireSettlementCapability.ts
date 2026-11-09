import type { NextFunction, Request, Response } from "express";
import { resolveSettlementKeys } from "../config/settlementSecret.js";
import { settlementNotAuthorized } from "../services/aiCredits.service.js";
import { SettlementCapabilityConfigError, verifySettlementCapability, type SettlementPurpose } from "../utils/settlementCapability.js";

/** The JSON body field carrying the capability. The body, not a header, so it stays out of access logs. */
export const SETTLEMENT_CAPABILITY_FIELD = "settlementCapability";

/**
 * Authorises one capture or refund by a reservation-bound capability instead of the user's live session (Phase 2C).
 * Runs after requireInternalService, which stays mandatory: neither the key nor the capability is enough alone.
 *
 *  - No capability field in the body: not this path. Continues with the route's legacy session chain (until step 6).
 *    A route with no legacy path passes `{ required: true }`: then a missing capability is the same uniform 403, never a
 *    fall-through to another route or a 404.
 *  - A capability field that is present but invalid in any way: the uniform 403. NEVER falls back to the session.
 *  - Valid: sets req.settlement, and the user and reference come from the signed claims from here on.
 *
 * Passing here proves only that the service signed these claims. The hold row, read under the lock, decides everything
 * else (see aiCredits.service.ts). A throw here is reported as the same 403 rather than a 500, because the BFF would
 * retry a 500 and a configuration problem does not heal between attempts.
 *
 * The reason goes to the log only, never to the caller. The token and the caller-supplied reference are never logged.
 */
export function requireSettlementCapability(purpose: SettlementPurpose, options: { required?: boolean } = {}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const body: unknown = req.body;
    if (body === null || typeof body !== "object" || !Object.hasOwn(body, SETTLEMENT_CAPABILITY_FIELD)) {
      if (options.required) {
        console.error("[settlement] SETTLEMENT_AUTH_REJECTED", { purpose, reason: "capability_missing", path: req.originalUrl.split("?")[0] });
        next(settlementNotAuthorized());
        return;
      }
      next("route");
      return;
    }

    const { [SETTLEMENT_CAPABILITY_FIELD]: token, referenceId } = body as Record<string, unknown>;
    let reason: string;
    try {
      const result = verifySettlementCapability(
        token,
        { purpose, referenceId: typeof referenceId === "string" ? referenceId.trim() : referenceId },
        resolveSettlementKeys(),
      );
      if (result.ok) {
        req.settlement = result.claims;
        next();
        return;
      }
      reason = result.reason;
    } catch (err) {
      reason = err instanceof SettlementCapabilityConfigError ? "secret_not_configured" : "verification_error";
    }

    console.error("[settlement] SETTLEMENT_AUTH_REJECTED", { purpose, reason, path: req.originalUrl.split("?")[0] });
    next(settlementNotAuthorized());
  };
}
