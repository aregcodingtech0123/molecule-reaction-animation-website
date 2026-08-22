import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import billingRoutes from "./routes/billing.routes.js";
import internalRoutes from "./routes/internal.routes.js";
import { stripeWebhook } from "./controllers/webhook.controller.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

/** Capture raw body for Stripe signature verification. */
function captureRawBody(req: Request, res: Response, buf: Buffer): void {
  if (buf?.length) {
    req.rawBody = buf;
  }
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ success: true, service: "billing-service", status: "ok" });
  });

  /**
   * Stripe webhook MUST use raw body — register before express.json().
   * Gateway: POST /api/billing/webhook → {BILLING_SERVICE_URL}/webhook
   */
  app.post(
    "/billing/webhook",
    express.raw({ type: "application/json", limit: "256kb", verify: captureRawBody }),
    stripeWebhook,
  );

  app.use(express.json({ limit: "32kb" }));

  const billingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 120 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests.", code: "RATE_LIMITED" },
  });

  app.use("/billing", billingLimiter, billingRoutes);
  app.use("/internal", internalRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
