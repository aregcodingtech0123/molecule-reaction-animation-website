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
    readonly shopierApiKey: string;
    readonly shopierApiSecret: string;
    readonly shopierWebsiteIndex: string;
    /** Optional REST webhook token (Shopier-Signature). Classic callback uses API secret. */
    readonly shopierWebhookToken: string;
    readonly lemonSqueezyApiKey: string;
    readonly lemonSqueezyStoreId: string;
    readonly lemonSqueezyWebhookSecret: string;
    readonly lemonSqueezyVariantStarter: string;
    readonly lemonSqueezyVariantPro: string;
    readonly resendApiKey: string;
    readonly emailFrom: string;
};
export declare function assertEnv(): void;
export declare function lemonVariantForPackage(packageId: string): string;
