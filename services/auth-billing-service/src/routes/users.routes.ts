import { Router } from "express";
import * as usersController from "../controllers/users.controller.js";
import { exportRateLimiter } from "../lib/rateLimiters.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireDatabase } from "../middlewares/requireDatabase.js";

const router = Router();

router.use(requireDatabase);
router.use(requireAuth);

router.get("/profile", usersController.getProfile);
router.put("/profile", usersController.updateProfile);
// POST (not GET): the re-authentication secret travels in the body, never in a URL.
router.post("/export", exportRateLimiter, usersController.exportData);

export default router;
