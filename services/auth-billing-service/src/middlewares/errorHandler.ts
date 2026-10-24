import type { NextFunction, Request, Response } from "express";
import { AppError } from "../types/index.js";
import { ValidationError } from "../utils/validation.js";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: "Route not found." });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
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
