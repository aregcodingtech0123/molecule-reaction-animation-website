import type { NextFunction, Request, Response } from "express";
export declare function notFoundHandler(_req: Request, res: Response): void;
export declare function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void;
