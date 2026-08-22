import { Router } from "express";
import * as billingController from "../controllers/billing.controller.js";
import { requireInternalAuth } from "../middleware/internal-auth.js";
import { validateBody } from "../middleware/validate.js";
import { grantSchema } from "../config/env.js";
const router = Router();
/** Called by auth-service after signup to sync signup bonus credits. */
router.post("/credits/grant", requireInternalAuth, validateBody(grantSchema), billingController.grantInternal);
export default router;
//# sourceMappingURL=internal.routes.js.map