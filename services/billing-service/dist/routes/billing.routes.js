import { Router } from "express";
import * as billingController from "../controllers/billing.controller.js";
import { requireInternalAuth } from "../middleware/internal-auth.js";
import { validateBody } from "../middleware/validate.js";
import { deductSchema } from "../config/env.js";
const router = Router();
router.get("/health", billingController.health);
router.post("/deduct", requireInternalAuth, validateBody(deductSchema), billingController.deduct);
router.get("/balance/:userId", requireInternalAuth, billingController.balance);
export default router;
//# sourceMappingURL=billing.routes.js.map