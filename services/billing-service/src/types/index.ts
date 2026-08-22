export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
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
