import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireDatabase } from "../middlewares/requireDatabase.js";
import { emailActionRateLimiter, googleRateLimiter, loginRateLimiter, registerRateLimiter, tokenActionRateLimiter, } from "../lib/rateLimiters.js";
const router = Router();
router.use(requireDatabase);
router.post("/register", registerRateLimiter, authController.register);
router.post("/login", loginRateLimiter, authController.login);
router.post("/google", googleRateLimiter, authController.google);
router.post("/verify-email", tokenActionRateLimiter, authController.verifyEmail);
router.post("/resend-verification", emailActionRateLimiter, authController.resendVerification);
router.post("/forgot-password", emailActionRateLimiter, authController.forgotPassword);
router.post("/reset-password", tokenActionRateLimiter, authController.resetPassword);
router.get("/me", requireAuth, authController.me);
router.post("/logout", authController.logout);
export default router;
//# sourceMappingURL=auth.routes.js.map