import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

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
  app.use(express.json({ limit: "32kb" }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 30 : 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests.", code: "RATE_LIMITED" },
  });

  app.get("/health", (_req, res) => {
    res.json({ success: true, service: "auth-service", status: "ok" });
  });

  /** Routes match gateway forwarding: /api/auth/register → {AUTH_SERVICE_URL}/auth/register */
  app.use("/auth", authLimiter, authRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
