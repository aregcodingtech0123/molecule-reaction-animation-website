import type { NextFunction, Request, Response } from "express";
import { AppError } from "../types/index.js";
import { ValidationError } from "../utils/validation.js";
import { DATABASE_RETRY_AFTER_SECONDS, isDatabaseUnavailableError } from "../db/unavailable.js";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: "Route not found." });
}

/**
 * body-parser rejects requests before any route runs and tags the error with
 * `type` and a 4xx `status`. They are client errors, not 500s (FINDING-12).
 */
const BODY_PARSER_ERRORS: Record<string, { status: number; error: string; code: string }> = {
  "entity.parse.failed": { status: 400, error: "Malformed JSON body.", code: "INVALID_JSON" },
  "entity.too.large": { status: 413, error: "Request body too large.", code: "PAYLOAD_TOO_LARGE" },
  "encoding.unsupported": { status: 415, error: "Unsupported content encoding.", code: "UNSUPPORTED_MEDIA_TYPE" },
  "charset.unsupported": { status: 415, error: "Unsupported charset.", code: "UNSUPPORTED_MEDIA_TYPE" },
  "request.aborted": { status: 400, error: "Request aborted.", code: "BAD_REQUEST" },
  "request.size.invalid": { status: 400, error: "Request size did not match Content-Length.", code: "BAD_REQUEST" },
};

/** zlib decoder error codes: gzip/deflate (Z_*), brotli (ERR__ERROR_*), zstd (ZSTD_error_*). */
const ZLIB_ERROR_CODE = /^(Z_[A-Z_]+|ERR__ERROR_[A-Z0-9_]+|ZSTD_error_\w+)$/;

function bodyParserError(err: unknown) {
  if (!err || typeof err !== "object") return null;
  const e = err as { type?: unknown; status?: unknown; expose?: unknown; code?: unknown };
  if (typeof e.type === "string" && Object.hasOwn(BODY_PARSER_ERRORS, e.type)) return BODY_PARSER_ERRORS[e.type]!;
  // A compressed body that does not decode (bad gzip/deflate/br/zstd stream) reaches us as the
  // zlib error wrapped by body-parser: status 400, exposed, no `type`. It is a client error, not a
  // 500 with a stack in the logs (SEC-09). The zlib message is not echoed.
  if (e.expose === true && e.status === 400 && typeof e.code === "string" && ZLIB_ERROR_CODE.test(e.code)) {
    return { status: 400, error: "Request body could not be decoded.", code: "INVALID_CONTENT_ENCODING" };
  }
  return null;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const parserError = bodyParserError(err);
  if (parserError) {
    res.status(parserError.status).json({ success: false, error: parserError.error, code: parserError.code });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      ...err.details,
    });
    return;
  }

  if (err instanceof ValidationError) {
    res.status(400).json({
      success: false,
      error: err.message,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  if (
    err instanceof Error &&
    (err.message.includes("Lemon") || err.message.includes("LEMONSQUEEZY"))
  ) {
    console.error("[auth-billing-service] Payment provider error:", {
      message: err.message,
      requestId: req.headers["x-request-id"] ?? null,
    });
    res.status(400).json({
      success: false,
      error: "PAYMENT_ERROR",
      message: "A payment error occurred. Please try again.",
    });
    return;
  }

  // The database could not serve the request (unreachable, or every pool connection busy): a temporary
  // condition, answered like requireDatabase does, plus Retry-After (PERF-29). Was a 500 INTERNAL_ERROR.
  if (isDatabaseUnavailableError(err)) {
    const e = err as { message?: string; code?: string };
    console.warn("[db] Request failed: database unavailable", { code: e.code ?? null, message: e.message ?? null, path: req.path });
    res.setHeader("Retry-After", String(DATABASE_RETRY_AFTER_SECONDS));
    res.status(503).json({
      success: false,
      error: "Database is temporarily unavailable.",
      code: "DATABASE_UNAVAILABLE",
    });
    return;
  }

  if (err && typeof err === "object" && "code" in err) {
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === "P0001") {
      res.status(402).json({
        success: false,
        error: "Insufficient credits.",
        code: "INSUFFICIENT_CREDITS",
      });
      return;
    }
    if (pgErr.code === "23505") {
      // Registration handles its own duplicate e-mail case; anything reaching here is a genuine
      // conflict and must never look like a success (FINDING-20).
      console.warn("[auth-billing-service] Unhandled unique violation", { constraint: pgErr.constraint ?? null });
      res.status(409).json({ success: false, error: "Conflict.", code: "CONFLICT" });
      return;
    }
  }

  console.error("[auth-billing-service]", err);
  res.status(500).json({
    success: false,
    error: "Internal server error.",
    code: "INTERNAL_ERROR",
  });
}
