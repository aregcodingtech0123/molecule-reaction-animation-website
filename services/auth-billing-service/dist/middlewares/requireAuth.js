import jwt from "jsonwebtoken";
import { extractBearerToken, verifyToken } from "../utils/jwt.js";
import { isJtiRevoked } from "../services/tokenRevocation.service.js";
import { AppError } from "../types/index.js";
/**
 * Validates Bearer JWT signature/claims, then rejects blacklisted `jti` values.
 * Revocation check is a primary-key SELECT (plus optional in-process positive cache).
 */
export async function requireAuth(req, _res, next) {
    try {
        const token = extractBearerToken(req.headers.authorization);
        if (!token) {
            throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
        }
        const payload = verifyToken(token);
        if (await isJtiRevoked(payload.jti)) {
            throw new AppError(401, "Token has been revoked.", "TOKEN_REVOKED");
        }
        req.user = payload;
        req.userId = payload.sub;
        next();
    }
    catch (err) {
        if (err instanceof AppError) {
            next(err);
            return;
        }
        if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
            next(new AppError(401, "Invalid or expired token.", "INVALID_TOKEN"));
            return;
        }
        next(err);
    }
}
//# sourceMappingURL=requireAuth.js.map