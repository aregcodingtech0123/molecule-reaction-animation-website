import type { NextFunction, Request, Response } from "express";
export declare function getProfile(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function updateProfile(req: Request, res: Response, next: NextFunction): Promise<void>;
