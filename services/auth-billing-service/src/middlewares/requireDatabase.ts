import type { Request, Response, NextFunction } from "express";
import { logDbError } from "../db/diagnostics.js";
import {
  getDatabaseError,
  getDatabaseErrorCode,
  isDatabaseReady,
  verifyDatabaseConnection,
} from "../db/index.js";

/** Return 503 when PostgreSQL is unreachable; retries the probe, which logs what went wrong. */
export function requireDatabase(_req: Request, res: Response, next: NextFunction): void {
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
        console.error(
          "[db] Request blocked — database unavailable.",
          getDatabaseErrorCode() ? `code=${getDatabaseErrorCode()}` : "",
        );
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
      logDbError("requireDatabase middleware", err);
      res.status(503).json({
        success: false,
        error: "Database is temporarily unavailable.",
        code: "DATABASE_UNAVAILABLE",
      });
    });
}
