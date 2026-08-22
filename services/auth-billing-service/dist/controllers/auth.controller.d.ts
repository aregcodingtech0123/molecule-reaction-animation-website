import type { Request, Response, NextFunction } from "express";
export declare function register(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function login(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function google(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function resendVerification(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void>;
/** Authenticated session probe — used by Next.js /api/chat verification gate. */
export declare function me(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function logout(req: Request, res: Response, next: NextFunction): Promise<void>;
