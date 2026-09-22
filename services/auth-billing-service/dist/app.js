import express from "express";
import helmet from "helmet";
import authRoutes from "./routes/auth.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import usersRoutes from "./routes/users.routes.js";
import { lemonSqueezyWebhook } from "./controllers/billing.controller.js";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import { isDatabaseReady, getDatabaseError } from "./db/index.js";
function captureRawBody(req, _res, buf) {
    if (buf?.length) {
        req.rawBody = buf;
    }
}
/** Allow browser calls from the Next.js app when using NEXT_PUBLIC_BILLING_SERVICE_URL. */
function developmentCors(req, res, next) {
    if (env.isProduction) {
        next();
        return;
    }
    const origin = req.headers.origin;
    const allowedOrigins = new Set([env.frontendUrl, "http://localhost:3000", "http://127.0.0.1:3000"]);
    if (origin && allowedOrigins.has(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
}
export function createApp() {
    const app = express();
    app.set("trust proxy", 1);
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'"],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    }));
    app.use(developmentCors);
    app.get("/health", (_req, res) => {
        const dbReady = isDatabaseReady();
        res.status(dbReady ? 200 : 503).json({
            success: dbReady,
            service: "auth-billing-service",
            status: dbReady ? "ok" : "degraded",
            database: dbReady ? "connected" : "unavailable",
            ...(process.env.NODE_ENV === "development" && !dbReady
                ? { databaseError: getDatabaseError() }
                : {}),
        });
    });
    // ── Provider webhook (raw body BEFORE express.json, for HMAC verification) ─
    app.post("/api/billing/webhooks/lemonsqueezy", express.raw({ type: "application/json", limit: "256kb", verify: captureRawBody }), lemonSqueezyWebhook);
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authRoutes);
    app.use("/api/billing", billingRoutes);
    app.use("/api/users", usersRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map