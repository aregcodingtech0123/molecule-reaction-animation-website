import { Router } from "express";
import * as billingController from "../controllers/billing.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireDatabase } from "../middlewares/requireDatabase.js";
import { requireInternalService } from "../middlewares/requireInternalService.js";
import { requireVerified } from "../middlewares/requireVerified.js";

/**
 * AI credit metering — callable ONLY by the Next.js BFF (FINDING-03).
 * The internal-key check runs first, before anything else, so a browser or a
 * public caller gets the same 404 as an unknown route. The BFF forwards the
 * user's JWT, so the user identity still comes from requireAuth.
 * (`POST /deduct` was retired: it let clients pick the ledger type and had no
 * DB-level idempotency — FINDING-07.)
 */
export const internalBillingRouter = Router();
const internalOnly = [requireInternalService, requireDatabase, requireAuth, requireVerified];
internalBillingRouter.post("/consume", ...internalOnly, billingController.consumeCredits);
internalBillingRouter.post("/capture", ...internalOnly, billingController.captureCredits);
internalBillingRouter.post("/refund", ...internalOnly, billingController.refundCredits);

const router = Router();

router.use(requireDatabase);

router.get("/balance", requireAuth, billingController.getBalance);
router.get("/history", requireAuth, billingController.getHistory);
router.get("/operation-costs", requireAuth, billingController.getOperationCosts);
router.post("/checkout", requireAuth, billingController.createCheckout);

export default router;
