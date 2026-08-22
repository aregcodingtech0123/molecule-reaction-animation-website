import type { Request, Response, NextFunction } from "express";
/** Return 503 when PostgreSQL is unreachable; retries probe in dev with full error logs. */
export declare function requireDatabase(_req: Request, res: Response, next: NextFunction): void;
