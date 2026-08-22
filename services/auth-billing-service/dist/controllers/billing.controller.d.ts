import type { Request, Response, NextFunction } from "express";
export declare function getBalance(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function getHistory(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * POST /api/billing/checkout
 * Body: { packageId, region | currency }  — region: "TR" | "GLOBAL", currency: "TRY" | "USD"
 */
export declare function createCheckout(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function deductCredits(req: Request, res: Response, next: NextFunction): Promise<void>;
/** Classic Shopier notify/callback — application/x-www-form-urlencoded */
export declare function shopierWebhook(req: Request, res: Response, next: NextFunction): Promise<void>;
/** Alias export for /api/billing/shopier-callback */
export declare const shopierCallback: typeof shopierWebhook;
/** Lemon Squeezy — raw JSON + X-Signature HMAC */
export declare function lemonSqueezyWebhook(req: Request, res: Response, next: NextFunction): Promise<void>;
