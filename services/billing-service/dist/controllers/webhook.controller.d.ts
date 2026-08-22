import type { Request, Response, NextFunction } from "express";
declare global {
    namespace Express {
        interface Request {
            rawBody?: Buffer;
        }
    }
}
export declare function stripeWebhook(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=webhook.controller.d.ts.map