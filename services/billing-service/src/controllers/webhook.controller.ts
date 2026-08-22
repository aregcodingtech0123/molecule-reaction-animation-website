import type { Request, Response, NextFunction } from "express";
import { verifyStripeWebhook } from "../lib/stripe.js";
import { handleStripeWebhookEvent } from "../services/billing.service.js";
import { AppError } from "../types/index.js";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export async function stripeWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawBody = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
    if (!rawBody?.length) {
      throw new AppError(400, "Webhook requires raw request body.", "INVALID_BODY");
    }

    const signature = req.headers["stripe-signature"];
    const event = verifyStripeWebhook(rawBody, typeof signature === "string" ? signature : undefined);

    const outcome = await handleStripeWebhookEvent(event);

    res.json({ success: true, received: true, ...outcome });
  } catch (err) {
    next(err);
  }
}
