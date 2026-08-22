import { type UserRow } from "../utils/profile.js";
declare function authResponse(user: UserRow, message: string): {
    message: string;
    token: string;
    user: import("../utils/profile.js").PublicUserProfile;
};
export type RegisterResult = {
    kind: "created";
    data: ReturnType<typeof authResponse>;
} | {
    kind: "ambiguous";
    message: string;
};
export declare function registerUser(emailInput: unknown, passwordInput: unknown, profileInput: {
    firstName: unknown;
    lastName: unknown;
    dateOfBirth: unknown;
}, signupIp?: string | null): Promise<RegisterResult>;
export declare function verifyEmailWithToken(rawTokenInput: unknown): Promise<{
    message: string;
    token: string;
    user: import("../utils/profile.js").PublicUserProfile;
}>;
export declare function resendVerificationEmail(emailInput: unknown): Promise<{
    message: string;
}>;
export declare function loginUser(emailInput: unknown, passwordInput: unknown): Promise<{
    message: string;
    token: string;
    user: import("../utils/profile.js").PublicUserProfile;
}>;
export declare function loginWithGoogle(idTokenInput: unknown, signupIp?: string | null): Promise<{
    message: string;
    token: string;
    user: import("../utils/profile.js").PublicUserProfile;
}>;
/**
 * Revoke the caller's current JWT (`jti`) until its natural `exp`.
 * Cookie clearing is performed by the Next.js BFF (`/api/auth/clear-cookie`).
 */
export declare function logoutCurrentToken(jti: string, expUnixSeconds: number): Promise<{
    message: string;
}>;
export declare function forgotPassword(emailInput: unknown): Promise<{
    message: string;
}>;
export declare function resetPassword(rawTokenInput: unknown, passwordInput: unknown): Promise<{
    message: string;
}>;
export declare function getUserVerificationStatus(userId: string): Promise<{
    userId: string;
    email: string;
    isVerified: boolean;
}>;
export {};
