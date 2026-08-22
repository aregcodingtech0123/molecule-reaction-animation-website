import { debitUserLedger, getUserBalance } from "../services/ledger.service.js";
import { grantCreditsFromAuth } from "../services/billing.service.js";
export async function deduct(req, res, next) {
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
    }
    catch (err) {
        next(err);
    }
}
export async function balance(req, res, next) {
    try {
        const raw = req.params.userId;
        const userId = Array.isArray(raw) ? raw[0] : raw;
        const result = await getUserBalance(userId);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function grantInternal(req, res, next) {
    try {
        const { userId, amount, reason, eventId } = req.body;
        const result = await grantCreditsFromAuth({ userId, amount, reason, eventId });
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function health(_req, res) {
    res.json({ success: true, service: "billing-service", status: "ok" });
}
//# sourceMappingURL=billing.controller.js.map