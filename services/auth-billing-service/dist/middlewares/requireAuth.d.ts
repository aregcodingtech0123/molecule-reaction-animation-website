import type { NextFunction, Request, Response } from "express";
/**
 * Validates Bearer JWT signature/claims, then rejects blacklisted `jti` values.
 * Revocation check is a primary-key SELECT (plus optional in-process positive cache).
 */
export declare function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void>;
