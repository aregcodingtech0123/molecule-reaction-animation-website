import type { Request } from "express";
import type { LoginInput, RegisterInput } from "../config/env.js";
export declare function registerUser(input: RegisterInput, req: Request): Promise<{
    token: string;
    expiresAt: string;
    user: {
        id: string;
        email: string;
        role: string;
        displayName: string | null;
        credits: number;
        createdAt: string;
    };
}>;
export declare function loginUser(input: LoginInput, req: Request): Promise<{
    token: string;
    expiresAt: string;
    user: {
        id: string;
        email: string;
        role: string;
        displayName: string | null;
        credits: number;
        createdAt: string;
    };
}>;
export declare function getCurrentUser(userId: string): Promise<{
    id: string;
    email: string;
    role: string;
    displayName: string | null;
    credits: number;
    createdAt: string;
}>;
//# sourceMappingURL=auth.service.d.ts.map