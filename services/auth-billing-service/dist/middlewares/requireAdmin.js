import { pool } from "../db/index.js";
import { AppError } from "../types/index.js";
/** Requires an authenticated user with `is_admin = true`. */
export async function requireAdmin(req, _res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
        }
        const result = await pool.query(`SELECT is_admin FROM users WHERE id = $1 LIMIT 1`, [userId]);
        const row = result.rows[0];
        if (!row?.is_admin) {
            throw new AppError(403, "Admin access required.", "FORBIDDEN");
        }
        next();
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=requireAdmin.js.map