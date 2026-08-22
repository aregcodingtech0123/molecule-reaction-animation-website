import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
const SIGNUP_REASON = "signup_bonus";
/**
 * Awards signup credits inside the auth DB and records an outbox event
 * for the billing microservice to reconcile.
 */
export async function awardSignupCredits(tx, userId, amount = env.signupCreditAmount) {
    await tx.profile.update({
        where: { userId },
        data: { credits: { increment: amount } },
    });
    await tx.creditEvent.create({
        data: {
            userId,
            amount,
            reason: SIGNUP_REASON,
            status: "PENDING",
            payload: { source: "auth-service", type: "signup_bonus" },
        },
    });
}
/** Best-effort async dispatch to billing service (non-blocking after register). */
export async function dispatchPendingCreditEvents(userId) {
    if (!env.billingServiceUrl)
        return;
    const events = await prisma.creditEvent.findMany({
        where: { userId, status: "PENDING", reason: SIGNUP_REASON },
    });
    for (const event of events) {
        try {
            const res = await fetch(`${env.billingServiceUrl}/internal/credits/grant`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Internal-Service": "auth-service",
                    "X-Internal-Api-Key": env.internalApiKey,
                },
                body: JSON.stringify({
                    userId: event.userId,
                    amount: event.amount,
                    reason: event.reason,
                    eventId: event.id,
                }),
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok)
                throw new Error(`Billing responded ${res.status}`);
            await prisma.creditEvent.update({
                where: { id: event.id },
                data: { status: "DISPATCHED", dispatchedAt: new Date() },
            });
        }
        catch {
            await prisma.creditEvent.update({
                where: { id: event.id },
                data: { status: "FAILED" },
            });
        }
    }
}
//# sourceMappingURL=credits.js.map