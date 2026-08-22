import type { NextFunction, Request, Response } from "express";
/** Protects deduct, balance, and internal grant endpoints from public abuse. */
export declare function requireInternalAuth(req: Request, _res: Response, next: NextFunction): void;
//# sourceMappingURL=internal-auth.d.ts.map