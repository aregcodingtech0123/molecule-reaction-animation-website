import type { NextFunction, Request, Response } from "express";
import * as usersService from "../services/users.service.js";
import { AppError } from "../types/index.js";
import { validateProfileUpdateInput } from "../utils/profile.js";

export async function getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
    }

    const profile = await usersService.getProfileByUserId(userId);
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
    }

    const body = req.body ?? {};
    const updates = validateProfileUpdateInput({
      firstName: body.firstName,
      lastName: body.lastName,
      dateOfBirth: body.dateOfBirth,
    });

    const profile = await usersService.updateProfileByUserId(userId, updates);
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
}
