import type { NextFunction, Request, Response } from "express";
/**
 * Requires an authenticated user with `is_verified = true`.
 * Use after `requireAuth` on AI / premium routes.
 */
export declare function requireVerified(req: Request, _res: Response, next: NextFunction): Promise<void>;
