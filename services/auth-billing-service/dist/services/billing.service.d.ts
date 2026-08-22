export interface LedgerHistoryRow {
    id: string;
    amount: number;
    transaction_type: string;
    reference_id: string | null;
    provider: string | null;
    created_at: string;
}
export declare function getBalanceForUser(userId: string): Promise<number>;
export declare function getLedgerHistoryForUser(userId: string, limit?: number): Promise<LedgerHistoryRow[]>;
export declare function deductCreditsForUser(userId: string, amount: number, transactionType: string, referenceId: string): Promise<{
    newBalance: number;
    ledgerId: string | null;
    alreadyProcessed: boolean;
}>;
