import type { LedgerTransactionType, Prisma } from "@prisma/client";
import { type BalanceResult, type LedgerMutationResult } from "../types/index.js";
interface PostLedgerParams {
    userId: string;
    amount: number;
    type: LedgerTransactionType;
    idempotencyKey?: string;
    externalRef?: string;
    description?: string;
    metadata?: Prisma.InputJsonValue;
}
/**
 * Credits a user wallet inside a balanced double-entry transaction.
 * User CREDIT + platform DEBIT (liability issued).
 */
export declare function creditUserLedger(params: PostLedgerParams): Promise<LedgerMutationResult>;
/**
 * Atomically debits credits — uses conditional update to prevent race conditions
 * and double-spending when concurrent AI requests hit the same wallet.
 */
export declare function debitUserLedger(params: PostLedgerParams): Promise<LedgerMutationResult>;
export declare function getUserBalance(userId: string): Promise<BalanceResult>;
export {};
//# sourceMappingURL=ledger.service.d.ts.map