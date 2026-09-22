import { AppError } from "../types/index.js";
import { ValidationError } from "../utils/validation.js";
export function notFoundHandler(_req, res) {
    res.status(404).json({ success: false, error: "Route not found." });
}
export function errorHandler(err, req, res, _next) {
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
    if (err instanceof Error &&
        (err.message.includes("Lemon") || err.message.includes("LEMONSQUEEZY"))) {
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
        const pgErr = err;
        if (pgErr.code === "P0001") {
            res.status(402).json({
                success: false,
                error: "Insufficient credits.",
                code: "INSUFFICIENT_CREDITS",
            });
            return;
        }
        if (pgErr.code === "23505") {
            res.status(200).json({
                success: true,
                data: {
                    message: "If this email address is new, your account has been created.",
                },
            });
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
//# sourceMappingURL=errorHandler.js.map