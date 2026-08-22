import * as authService from "../services/auth.service.js";
import { AppError } from "../types/index.js";
import { extractBearerToken, verifyToken } from "../utils/jwt.js";
import jwt from "jsonwebtoken";
function clientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0]?.trim() ?? null;
    }
    return req.ip ?? null;
}
export async function register(req, res, next) {
    try {
        const { email, password, firstName, lastName, dateOfBirth } = req.body ?? {};
        const result = await authService.registerUser(email, password, { firstName, lastName, dateOfBirth }, clientIp(req));
        if (result.kind === "ambiguous") {
            res.status(200).json({
                success: true,
                data: { message: result.message },
            });
            return;
        }
        res.status(201).json({ success: true, data: result.data });
    }
    catch (err) {
        next(err);
    }
}
export async function login(req, res, next) {
    try {
        const { email, password } = req.body ?? {};
        const result = await authService.loginUser(email, password);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function google(req, res, next) {
    try {
        const body = req.body ?? {};
        const idToken = body.idToken ?? body.credential;
        const result = await authService.loginWithGoogle(idToken, clientIp(req));
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function verifyEmail(req, res, next) {
    try {
        const token = req.body?.token ?? req.query?.token;
        const result = await authService.verifyEmailWithToken(token);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function resendVerification(req, res, next) {
    try {
        const result = await authService.resendVerificationEmail(req.body?.email);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function forgotPassword(req, res, next) {
    try {
        const result = await authService.forgotPassword(req.body?.email);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
export async function resetPassword(req, res, next) {
    try {
        const { token, password } = req.body ?? {};
        const result = await authService.resetPassword(token, password);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
/** Authenticated session probe — used by Next.js /api/chat verification gate. */
export async function me(req, res, next) {
    try {
        const userId = req.user?.sub;
        if (!userId) {
            throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
        }
        const status = await authService.getUserVerificationStatus(userId);
        res.json({ success: true, data: status });
    }
    catch (err) {
        next(err);
    }
}
export async function logout(req, res, next) {
    try {
        const raw = extractBearerToken(req.headers.authorization);
        if (!raw) {
            throw new AppError(401, "Authentication required.", "UNAUTHORIZED");
        }
        let payload;
        try {
            payload = verifyToken(raw);
        }
        catch (err) {
            if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
                throw new AppError(401, "Invalid or expired token.", "INVALID_TOKEN");
            }
            throw err;
        }
        const result = await authService.logoutCurrentToken(payload.jti, payload.exp);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=auth.controller.js.map