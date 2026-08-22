export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code?: string | undefined;
    constructor(statusCode: number, message: string, code?: string | undefined);
}
export interface BalanceResult {
    userId: string;
    balance: number;
    hasCredits: boolean;
}
export interface LedgerMutationResult {
    userId: string;
    balance: number;
    transactionId: string;
    idempotentReplay: boolean;
}
//# sourceMappingURL=index.d.ts.map