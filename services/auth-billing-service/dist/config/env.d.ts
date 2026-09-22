import "../config/loadEnv.js";
export declare const env: {
    readonly host: string;
    readonly port: number;
    readonly nodeEnv: string;
    readonly databaseUrl: string;
    readonly database: import("./database.js").DatabaseEnvConfig;
    readonly jwtSecret: string;
    readonly jwtExpiresIn: string;
    readonly bcryptRounds: number;
    readonly isProduction: boolean;
    readonly frontendUrl: string;
    readonly googleClientId: string;
    readonly lemonSqueezyApiKey: string;
    readonly lemonSqueezyStoreId: string;
    readonly lemonSqueezyWebhookSecret: string;
    readonly lemonSqueezyVariantStarter: string;
    readonly lemonSqueezyVariantPro: string;
    readonly lemonSqueezyVariantEnterprise: string;
    readonly resendApiKey: string;
    /** Preferred sender identity. Falls back to EMAIL_FROM for older configs. */
    readonly senderEmail: string;
    /** @deprecated Prefer `senderEmail` / SENDER_EMAIL */
    readonly emailFrom: string;
};
export declare function assertEnv(): void;
export declare function lemonVariantForPackage(packageId: string): string;
