export declare function normalizeEmail(email: unknown): string;
export declare function validatePassword(password: unknown): string;
export declare function validateGoogleIdToken(token: unknown): string;
export declare class ValidationError extends Error {
    constructor(message: string);
}
