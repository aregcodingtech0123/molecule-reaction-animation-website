import { z } from "zod";
export declare const env: {
    readonly nodeEnv: string;
    readonly port: number;
    readonly databaseUrl: string;
    readonly database: import("./database.js").DatabaseEnvConfig;
    readonly jwtSecret: string;
    readonly jwtExpiresIn: string;
    readonly bcryptRounds: number;
    readonly billingServiceUrl: string;
    readonly internalApiKey: string;
    readonly signupCreditAmount: number;
    readonly corsOrigins: true | string[];
    readonly isProduction: boolean;
};
export declare function assertEnv(): void;
export declare const registerSchema: z.ZodObject<{
    email: z.ZodEffects<z.ZodString, string, string>;
    password: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    password: string;
    email: string;
    displayName?: string | undefined;
}, {
    password: string;
    email: string;
    displayName?: string | undefined;
}>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodEffects<z.ZodString, string, string>;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    password: string;
    email: string;
}, {
    password: string;
    email: string;
}>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
//# sourceMappingURL=env.d.ts.map