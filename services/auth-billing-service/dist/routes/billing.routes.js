import { Router } from "express";
import * as billingController from "../controllers/billing.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireDatabase } from "../middlewares/requireDatabase.js";
import { requireVerified } from "../middlewares/requireVerified.js";
const router = Router();
router.use(requireDatabase);
router.get("/balance", requireAuth, billingController.getBalance);
router.get("/history", requireAuth, billingController.getHistory);
router.get("/operation-costs", requireAuth, billingController.getOperationCosts);
router.post("/checkout", requireAuth, billingController.createCheckout);
/** AI credit spend — email must be verified. */
router.post("/deduct", requireAuth, requireVerified, billingController.deductCredits);
router.post("/consume", requireAuth, requireVerified, billingController.consumeCredits);
/** Compensating give-back when a charged AI operation fails. */
router.post("/refund", requireAuth, requireVerified, billingController.refundCredits);
export default router;
//# sourceMappingURL=billing.routes.js.map