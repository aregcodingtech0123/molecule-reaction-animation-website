import { getDatabaseError, getDatabaseErrorCode, isDatabaseReady, verifyDatabaseConnection, } from "../db/index.js";
/** Return 503 when PostgreSQL is unreachable; retries probe in dev with full error logs. */
export function requireDatabase(_req, res, next) {
    if (isDatabaseReady()) {
        next();
        return;
    }
    void verifyDatabaseConnection()
        .then((ok) => {
        if (ok) {
            next();
            return;
        }
        if (process.env.NODE_ENV !== "production") {
            console.error("[db] Request blocked — database unavailable.", getDatabaseErrorCode() ? `code=${getDatabaseErrorCode()}` : "", getDatabaseError() ?? "");
        }
        res.status(503).json({
            success: false,
            error: "Database is temporarily unavailable.",
            code: "DATABASE_UNAVAILABLE",
            ...(process.env.NODE_ENV === "development"
                ? {
                    details: getDatabaseError(),
                    pgCode: getDatabaseErrorCode(),
                }
                : {}),
        });
    })
        .catch((err) => {
        console.error("❌ FULL DB ERROR [requireDatabase middleware]:", err);
        res.status(503).json({
            success: false,
            error: "Database is temporarily unavailable.",
            code: "DATABASE_UNAVAILABLE",
        });
    });
}
//# sourceMappingURL=requireDatabase.js.map