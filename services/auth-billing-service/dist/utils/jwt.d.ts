import type { JwtPayload } from "../types/index.js";
export interface SignTokenInput {
    sub: string;
    email: string;
}
export declare function signToken(payload: SignTokenInput): string;
export declare function verifyToken(token: string): JwtPayload;
export declare function extractBearerToken(header: string | undefined): string | null;
