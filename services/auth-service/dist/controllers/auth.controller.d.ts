import type { Request, Response, NextFunction } from "express";
export declare function register(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function login(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function me(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function health(_req: Request, res: Response): Promise<void>;
//# sourceMappingURL=auth.controller.d.ts.map