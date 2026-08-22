export class AppError extends Error {
    statusCode;
    code;
    constructor(statusCode, message, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = "AppError";
    }
}
export function publicUser(user) {
    return {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.profile?.displayName ?? null,
        credits: user.profile?.credits ?? 0,
        createdAt: user.createdAt.toISOString(),
    };
}
//# sourceMappingURL=index.js.map