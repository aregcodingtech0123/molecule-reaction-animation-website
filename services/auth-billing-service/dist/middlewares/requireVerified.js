import { pool } from "../db/index.js";
import { AppError } from "../types/index.js";
/**
 * Requires an authenticated user with `is_verified = true`.
 * Use after `requireAuth` on AI / premium routes.
 */
export async function requireVerified(req, _res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
        }
        const result = await pool.query(`SELECT is_verified FROM users WHERE id = $1 LIMIT 1`, [userId]);
        if (!result.rows[0]?.is_verified) {
            throw new AppError(403, "Email verification required before using AI features.", "EMAIL_NOT_VERIFIED");
        }
        next();
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=requireVerified.js.map