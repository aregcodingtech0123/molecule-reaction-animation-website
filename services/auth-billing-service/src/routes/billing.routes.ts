import { Router } from "express";
import * as billingController from "../controllers/billing.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireDatabase } from "../middlewares/requireDatabase.js";
import { requireInternalService } from "../middlewares/requireInternalService.js";
import { requireSettlementCapability } from "../middlewares/requireSettlementCapability.js";
import { requireVerified } from "../middlewares/requireVerified.js";

/**
 * AI credit metering — callable ONLY by the Next.js BFF (FINDING-03).
 * The internal-key check runs first, before anything else, so a browser or a
 * public caller gets the same 404 as an unknown route.
 * (`POST /deduct` was retired: it let clients pick the ledger type and had no
 * DB-level idempotency — FINDING-07.)
 *
 * /consume: the BFF forwards the user's JWT, so the user identity comes from requireAuth.
 *
 * /capture and /refund have one path (Phase 2C step 7.4, C6): a reservation-bound capability in the body. The user and the
 * reference come from its signed claims, and no session is involved. A missing capability and an invalid one get the same
 * uniform 403; there is no fall-through to a session route. The internal-key check still runs first, so a caller without
 * the key gets the 404 whatever the body holds. (The legacy session routes were removed in C6.)
 */
export const internalBillingRouter = Router();
const internalOnly = [requireInternalService, requireDatabase, requireAuth, requireVerified];
internalBillingRouter.post("/consume", ...internalOnly, billingController.consumeCredits);
internalBillingRouter.post("/capture", requireInternalService, requireSettlementCapability("capture", { required: true }), requireDatabase, billingController.captureCredits);
internalBillingRouter.post("/refund", requireInternalService, requireSettlementCapability("refund", { required: true }), requireDatabase, billingController.refundCredits);
// Delivery tracking (Phase 2C step 5.2.2). Internal key AND a delivery_ack capability; no legacy session path, so a missing
// capability is a 403 here (required), never a fall-through. The Next.js gateway lists this path as internal-only.
internalBillingRouter.post("/delivery-attempt", requireInternalService, requireSettlementCapability("delivery_ack", { required: true }), requireDatabase, billingController.acknowledgeDelivery);

const router = Router();

router.use(requireDatabase);

router.get("/balance", requireAuth, billingController.getBalance);
router.get("/history", requireAuth, billingController.getHistory);
router.get("/operation-costs", requireAuth, billingController.getOperationCosts);
router.post("/checkout", requireAuth, billingController.createCheckout);

export default router;
