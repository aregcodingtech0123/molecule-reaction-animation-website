import type { NextFunction, Request, Response } from "express";
import type { AccessTokenPayload } from "../lib/jwt.js";
declare global {
    namespace Express {
        interface Request {
            auth?: AccessTokenPayload;
        }
    }
}
/**
 * Validates Bearer JWT from the gateway-forwarded Authorization header.
 * Attaches decoded claims to `req.auth`.
 */
export declare function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map