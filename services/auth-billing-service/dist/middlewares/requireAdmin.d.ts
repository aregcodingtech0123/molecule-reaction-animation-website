import type { NextFunction, Request, Response } from "express";
/** Requires an authenticated user with `is_admin = true`. */
export declare function requireAdmin(req: Request, _res: Response, next: NextFunction): Promise<void>;
