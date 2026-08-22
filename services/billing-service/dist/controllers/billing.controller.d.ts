import type { Request, Response, NextFunction } from "express";
export declare function deduct(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function balance(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function grantInternal(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function health(_req: Request, res: Response): Promise<void>;
//# sourceMappingURL=billing.controller.d.ts.map