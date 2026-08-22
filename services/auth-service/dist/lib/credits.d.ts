import type { Prisma } from "@prisma/client";
/**
 * Awards signup credits inside the auth DB and records an outbox event
 * for the billing microservice to reconcile.
 */
export declare function awardSignupCredits(tx: Prisma.TransactionClient, userId: string, amount?: number): Promise<void>;
/** Best-effort async dispatch to billing service (non-blocking after register). */
export declare function dispatchPendingCreditEvents(userId: string): Promise<void>;
//# sourceMappingURL=credits.d.ts.map