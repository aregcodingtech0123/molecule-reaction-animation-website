import type { Request, Response, NextFunction } from "express";
import { debitUserLedger, getUserBalance } from "../services/ledger.service.js";
import { grantCreditsFromAuth } from "../services/billing.service.js";

export async function deduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, amount, reason, idempotencyKey, metadata } = req.body;

    const result = await debitUserLedger({
      userId,
      amount,
      type: "DEDUCTION",
      idempotencyKey,
      description: reason,
      metadata,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function balance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.params.userId;
    const userId = Array.isArray(raw) ? raw[0] : raw;
    const result = await getUserBalance(userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function grantInternal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, amount, reason, eventId } = req.body;
    const result = await grantCreditsFromAuth({ userId, amount, reason, eventId });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function health(_req: Request, res: Response): Promise<void> {
  res.json({ success: true, service: "billing-service", status: "ok" });
}
