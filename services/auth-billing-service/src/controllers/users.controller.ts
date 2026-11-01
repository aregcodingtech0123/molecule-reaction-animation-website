import type { NextFunction, Request, Response } from "express";
import * as exportService from "../services/export.service.js";
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

/** POST /api/users/export: the signed-in user's own data as JSON, after re-entering the password or a fresh Google sign-in. */
export async function exportData(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
    }

    const body = req.body ?? {};
    await exportService.reauthenticate(userId, { password: body.password, idToken: body.idToken });
    const data = await exportService.buildExport(userId);

    res.set("Cache-Control", "no-store");
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

