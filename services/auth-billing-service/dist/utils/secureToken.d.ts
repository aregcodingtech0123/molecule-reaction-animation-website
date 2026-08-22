/** Generate a URL-safe raw token and its SHA-256 hex hash for storage. */
export declare function generateSecureToken(): {
    rawToken: string;
    tokenHash: string;
};
export declare function hashToken(rawToken: string): string;
/** Constant-time compare of two hex digests. */
export declare function safeEqualHex(a: string, b: string): boolean;
export declare function hoursFromNow(hours: number): Date;
