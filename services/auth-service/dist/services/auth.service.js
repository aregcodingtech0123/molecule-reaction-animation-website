import { prisma } from "../db/prisma.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { signAccessToken } from "../lib/jwt.js";
import { awardSignupCredits, dispatchPendingCreditEvents } from "../lib/credits.js";
import { AppError, publicUser } from "../types/index.js";
function clientMeta(req) {
    return {
        userAgent: req.headers["user-agent"]?.slice(0, 512) ?? null,
        ipAddress: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
            req.ip ??
            null,
    };
}
export async function registerUser(input, req) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
        throw new AppError(409, "An account with this email already exists.", "EMAIL_TAKEN");
    }
    const passwordHash = await hashPassword(input.password);
    const displayName = input.displayName ?? input.email.split("@")[0];
    const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
            data: {
                email: input.email,
                passwordHash,
                profile: {
                    create: {
                        displayName,
                        credits: 0,
                    },
                },
            },
            include: { profile: true },
        });
        await awardSignupCredits(tx, created.id);
        return created;
    });
    const { token, jti, expiresAt } = signAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
    });
    const meta = clientMeta(req);
    await prisma.sessionToken.create({
        data: {
            userId: user.id,
            jti,
            expiresAt,
            userAgent: meta.userAgent,
            ipAddress: meta.ipAddress,
        },
    });
    void dispatchPendingCreditEvents(user.id);
    const refreshed = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { profile: true },
    });
    return {
        token,
        expiresAt: expiresAt.toISOString(),
        user: publicUser(refreshed),
    };
}
export async function loginUser(input, req) {
    const user = await prisma.user.findUnique({
        where: { email: input.email },
        include: { profile: true },
    });
    if (!user) {
        throw new AppError(401, "Invalid email or password.", "INVALID_CREDENTIALS");
    }
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
        throw new AppError(401, "Invalid email or password.", "INVALID_CREDENTIALS");
    }
    const { token, jti, expiresAt } = signAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
    });
    const meta = clientMeta(req);
    await prisma.sessionToken.create({
        data: {
            userId: user.id,
            jti,
            expiresAt,
            userAgent: meta.userAgent,
            ipAddress: meta.ipAddress,
        },
    });
    return {
        token,
        expiresAt: expiresAt.toISOString(),
        user: publicUser(user),
    };
}
export async function getCurrentUser(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
    });
    if (!user) {
        throw new AppError(404, "User not found.", "USER_NOT_FOUND");
    }
    return publicUser(user);
}
//# sourceMappingURL=auth.service.js.map