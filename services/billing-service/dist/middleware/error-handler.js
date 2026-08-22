import { ZodError } from "zod";
import { AppError } from "../types/index.js";
export function notFoundHandler(_req, res) {
    res.status(404).json({ success: false, error: "Route not found." });
}
export function errorHandler(err, _req, res, _next) {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            success: false,
            error: err.message,
            code: err.code,
        });
        return;
    }
    if (err instanceof ZodError) {
        res.status(400).json({
            success: false,
            error: "Validation failed.",
            code: "VALIDATION_ERROR",
            details: err.flatten().fieldErrors,
        });
        return;
    }
    if (err instanceof Error && err.message.includes("Stripe")) {
        res.status(400).json({
            success: false,
            error: err.message,
            code: "STRIPE_ERROR",
        });
        return;
    }
    console.error("[billing-service]", err);
    res.status(500).json({
        success: false,
        error: "Internal server error.",
        code: "INTERNAL_ERROR",
    });
}
//# sourceMappingURL=error-handler.js.map