import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env.js";
export function signAccessToken(params) {
    const jti = uuidv4().replace(/-/g, "");
    const expiresIn = env.jwtExpiresIn;
    const token = jwt.sign({
        sub: params.userId,
        email: params.email,
        role: params.role,
        jti,
    }, env.jwtSecret, {
        expiresIn,
        issuer: "moleculestudio-auth",
        audience: "moleculestudio-api",
        algorithm: "HS256",
    });
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return { token, jti, expiresAt };
}
export function verifyAccessToken(token) {
    const payload = jwt.verify(token, env.jwtSecret, {
        issuer: "moleculestudio-auth",
        audience: "moleculestudio-api",
        algorithms: ["HS256"],
    });
    if (!payload.sub || !payload.jti || !payload.email || !payload.role) {
        throw new jwt.JsonWebTokenError("Invalid token payload.");
    }
    return payload;
}
export function extractBearerToken(header) {
    if (!header?.trim())
        return null;
    const match = header.trim().match(/^Bearer\s+(.+)$/i);
    return match?.[1] ?? null;
}
//# sourceMappingURL=jwt.js.map