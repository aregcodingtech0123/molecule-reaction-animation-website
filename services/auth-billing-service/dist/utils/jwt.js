import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
export function signToken(payload) {
    const jti = randomUUID();
    return jwt.sign({
        sub: payload.sub,
        email: payload.email,
    }, env.jwtSecret, {
        expiresIn: env.jwtExpiresIn,
        issuer: "moleculestudio-auth-billing",
        audience: "moleculestudio-api",
        algorithm: "HS256",
        jwtid: jti,
    });
}
export function verifyToken(token) {
    const decoded = jwt.verify(token, env.jwtSecret, {
        issuer: "moleculestudio-auth-billing",
        audience: "moleculestudio-api",
        algorithms: ["HS256"],
    });
    const sub = typeof decoded.sub === "string" ? decoded.sub : null;
    const email = typeof decoded.email === "string" ? decoded.email : null;
    const jti = typeof decoded.jti === "string"
        ? decoded.jti
        : typeof decoded.jwtid === "string"
            ? decoded.jwtid
            : null;
    const exp = typeof decoded.exp === "number" ? decoded.exp : null;
    if (!sub || !email || !jti || !exp) {
        throw new jwt.JsonWebTokenError("Invalid token payload.");
    }
    return { sub, email, jti, exp };
}
export function extractBearerToken(header) {
    if (!header?.trim())
        return null;
    const match = header.trim().match(/^Bearer\s+(.+)$/i);
    return match?.[1] ?? null;
}
//# sourceMappingURL=jwt.js.map