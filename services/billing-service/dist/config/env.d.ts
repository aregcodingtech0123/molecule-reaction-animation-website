import { z } from "zod";
export declare const env: {
    readonly nodeEnv: string;
    readonly port: number;
    readonly databaseUrl: string;
    readonly database: import("./database.js").DatabaseEnvConfig;
    readonly internalApiKey: string;
    readonly stripeSecretKey: string;
    readonly stripeWebhookSecret: string;
    readonly corsOrigins: true | string[];
    readonly isProduction: boolean;
    readonly systemAccountId: "00000000-0000-0000-0000-000000000001";
};
export declare function assertEnv(): void;
export declare const deductSchema: z.ZodObject<{
    userId: z.ZodString;
    amount: z.ZodNumber;
    reason: z.ZodDefault<z.ZodString>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    amount: number;
    reason: string;
    idempotencyKey?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    userId: string;
    amount: number;
    reason?: string | undefined;
    idempotencyKey?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export declare const grantSchema: z.ZodObject<{
    userId: z.ZodString;
    amount: z.ZodNumber;
    reason: z.ZodString;
    eventId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    amount: number;
    reason: string;
    eventId?: string | undefined;
}, {
    userId: string;
    amount: number;
    reason: string;
    eventId?: string | undefined;
}>;
export type DeductInput = z.infer<typeof deductSchema>;
export type GrantInput = z.infer<typeof grantSchema>;
//# sourceMappingURL=env.d.ts.map