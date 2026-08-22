import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
const TOKEN_BYTES = 32;
/** Generate a URL-safe raw token and its SHA-256 hex hash for storage. */
export function generateSecureToken() {
    const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
    return { rawToken, tokenHash: hashToken(rawToken) };
}
export function hashToken(rawToken) {
    return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
/** Constant-time compare of two hex digests. */
export function safeEqualHex(a, b) {
    try {
        const bufA = Buffer.from(a, "hex");
        const bufB = Buffer.from(b, "hex");
        if (bufA.length !== bufB.length || bufA.length === 0)
            return false;
        return timingSafeEqual(bufA, bufB);
    }
    catch {
        return false;
    }
}
export function hoursFromNow(hours) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
}
//# sourceMappingURL=secureToken.js.map