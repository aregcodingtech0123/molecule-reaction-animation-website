export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code?: string | undefined;
    constructor(statusCode: number, message: string, code?: string | undefined);
}
export declare function publicUser(user: {
    id: string;
    email: string;
    role: string;
    createdAt: Date;
    profile: {
        displayName: string;
        credits: number;
    } | null;
}): {
    id: string;
    email: string;
    role: string;
    displayName: string | null;
    credits: number;
    createdAt: string;
};
export type SafeUser = ReturnType<typeof publicUser>;
//# sourceMappingURL=index.d.ts.map