import { Router } from "express";
import * as usersController from "../controllers/users.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireDatabase } from "../middlewares/requireDatabase.js";

const router = Router();

router.use(requireDatabase);
router.use(requireAuth);

router.get("/profile", usersController.getProfile);
router.put("/profile", usersController.updateProfile);

export default router;
