import * as billingService from "../services/billing.service.js";
import { createUnifiedCheckout } from "../services/checkout.service.js";
import { handleLemonSqueezyWebhook, handleShopierCallback, handleShopierRestWebhook, } from "../services/webhook.service.js";
import { AppError } from "../types/index.js";
export async function getBalance(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const balance = await billingService.getBalanceForUser(userId);
        res.json({
            success: true,
            data: {
                userId,
                balance,
                hasCredits: balance > 0,
            },
        });
    }
    catch (err) {
        next(err);
    }
}
export async function getHistory(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const limit = Number(req.query.limit ?? 100);
        const transactions = await billingService.getLedgerHistoryForUser(userId, limit);
        res.json({
            success: true,
            data: { transactions },
        });
    }
    catch (err) {
        next(err);
    }
}
/**
 * POST /api/billing/checkout
 * Body: { packageId, region | currency }  — region: "TR" | "GLOBAL", currency: "TRY" | "USD"
 */
export async function createCheckout(req, res, next) {
    try {
        const userId = req.user?.sub;
        const userEmail = req.user?.email;
        if (!userId || !userEmail) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const body = req.body ?? {};
        const regionOrCurrency = body.region ?? body.currency ?? "GLOBAL";
        const checkout = await createUnifiedCheckout({
            userId,
            userEmail,
            packageId: body.packageId,
            regionOrCurrency,
            buyerName: typeof body.buyerName === "string" ? body.buyerName : undefined,
        });
        res.json({
            success: true,
            data: checkout,
        });
    }
    catch (err) {
        if (err instanceof Error && err.message === "INVALID_PACKAGE") {
            next(new AppError(400, "Invalid credit package.", "INVALID_PACKAGE"));
            return;
        }
        next(err);
    }
}
export async function deductCredits(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Unauthorized.", "UNAUTHORIZED");
        }
        const { amount, type, referenceId } = req.body ?? {};
        const result = await billingService.deductCreditsForUser(userId, Number(amount), String(type ?? ""), String(referenceId ?? ""));
        res.json({
            success: true,
            data: {
                newBalance: result.newBalance,
                ledgerId: result.ledgerId,
                alreadyProcessed: result.alreadyProcessed,
            },
        });
    }
    catch (err) {
        next(err);
    }
}
/** Classic Shopier notify/callback — application/x-www-form-urlencoded */
export async function shopierWebhook(req, res, next) {
    try {
        const contentType = String(req.headers["content-type"] ?? "");
        if (contentType.includes("application/json")) {
            const rawBody = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
            if (!rawBody?.length) {
                throw new AppError(400, "Webhook requires raw request body.", "INVALID_BODY");
            }
            const signature = (typeof req.headers["shopier-signature"] === "string"
                ? req.headers["shopier-signature"]
                : undefined) ??
                (typeof req.headers["x-shopier-signature"] === "string"
                    ? req.headers["x-shopier-signature"]
                    : undefined);
            const outcome = await handleShopierRestWebhook(rawBody, signature);
            res.status(200).json({ success: true, received: true, ...outcome });
            return;
        }
        const body = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
            ? req.body
            : {};
        if (!body.platform_order_id || !body.signature) {
            throw new AppError(400, "Missing Shopier callback fields.", "INVALID_SHOPIER_CALLBACK");
        }
        const outcome = await handleShopierCallback(body);
        res.status(200).json({ success: true, received: true, ...outcome });
    }
    catch (err) {
        next(err);
    }
}
/** Alias export for /api/billing/shopier-callback */
export const shopierCallback = shopierWebhook;
/** Lemon Squeezy — raw JSON + X-Signature HMAC */
export async function lemonSqueezyWebhook(req, res, next) {
    try {
        const rawBody = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
        if (!rawBody?.length) {
            throw new AppError(400, "Webhook requires raw request body.", "INVALID_BODY");
        }
        const signature = typeof req.headers["x-signature"] === "string" ? req.headers["x-signature"] : undefined;
        const outcome = await handleLemonSqueezyWebhook(rawBody, signature);
        res.json({ success: true, received: true, ...outcome });
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=billing.controller.js.map