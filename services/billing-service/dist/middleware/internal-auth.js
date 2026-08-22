import { env } from "../config/env.js";
import { AppError } from "../types/index.js";
function extractInternalKey(req) {
    const headerKey = req.headers["x-internal-api-key"];
    if (typeof headerKey === "string" && headerKey.trim()) {
        return headerKey.trim();
    }
    const auth = req.headers.authorization?.trim();
    if (auth?.match(/^Bearer\s+/i)) {
        return auth.replace(/^Bearer\s+/i, "").trim();
    }
    return null;
}
/** Protects deduct, balance, and internal grant endpoints from public abuse. */
export function requireInternalAuth(req, _res, next) {
    const key = extractInternalKey(req);
    if (!key || key !== env.internalApiKey) {
        next(new AppError(401, "Unauthorized internal request.", "UNAUTHORIZED"));
        return;
    }
    next();
}
//# sourceMappingURL=internal-auth.js.map