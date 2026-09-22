export interface PurchaseReceiptParams {
    userEmail: string;
    userName: string;
    creditsAdded: number;
    orderId: string;
    amountPaid: number;
    /** Current balance after the purchase was applied. */
    newBalance: number;
    currency?: string;
}
/**
 * Sends a branded purchase receipt via Resend.
 * Safe to call fire-and-forget — logs and returns on failure; never throws to callers
 * that wrap it, but may throw if you await it (callers should catch).
 */
export declare function sendPurchaseReceiptEmail(userEmail: string, userName: string, creditsAdded: number, orderId: string, amountPaid: number, newBalance?: number, currency?: string): Promise<void>;
