import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";
import { AppError } from "../types/index.js";
let client = null;
function getGoogleClient() {
    if (!env.googleClientId) {
        throw new AppError(503, "Google sign-in is not configured.", "GOOGLE_AUTH_DISABLED");
    }
    client ??= new OAuth2Client(env.googleClientId);
    return client;
}
/** Verify a Google ID token from the frontend Sign-In flow. */
export async function verifyGoogleIdToken(idToken) {
    let ticket;
    try {
        ticket = await getGoogleClient().verifyIdToken({
            idToken,
            audience: env.googleClientId,
        });
    }
    catch {
        throw new AppError(401, "Invalid Google ID token.", "GOOGLE_TOKEN_INVALID");
    }
    const payload = ticket.getPayload();
    if (!payload?.email) {
        throw new AppError(401, "Google token did not include an email address.", "GOOGLE_TOKEN_INVALID");
    }
    if (!payload.email_verified) {
        throw new AppError(401, "Google account email is not verified.", "GOOGLE_EMAIL_UNVERIFIED");
    }
    if (!payload.sub) {
        throw new AppError(401, "Google token is missing a subject identifier.", "GOOGLE_TOKEN_INVALID");
    }
    return {
        email: payload.email.trim().toLowerCase(),
        googleSub: payload.sub,
        emailVerified: Boolean(payload.email_verified),
    };
}
//# sourceMappingURL=google.js.map