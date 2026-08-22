import type { UserRole } from "@prisma/client";
export interface AccessTokenPayload {
    sub: string;
    email: string;
    role: UserRole;
    jti: string;
}
export interface SignedToken {
    token: string;
    jti: string;
    expiresAt: Date;
}
export declare function signAccessToken(params: {
    userId: string;
    email: string;
    role: UserRole;
}): SignedToken;
export declare function verifyAccessToken(token: string): AccessTokenPayload;
export declare function extractBearerToken(header: string | undefined): string | null;
//# sourceMappingURL=jwt.d.ts.map