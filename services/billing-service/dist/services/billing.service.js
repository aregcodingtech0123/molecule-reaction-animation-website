import { prisma } from "../db/prisma.js";
import { extractCreditPackFromSession } from "../lib/stripe.js";
import { creditUserLedger } from "./ledger.service.js";
import { AppError } from "../types/index.js";
export async function handleStripeWebhookEvent(event) {
    const existing = await prisma.stripeWebhookEvent.findUnique({
        where: { stripeEventId: event.id },
    });
    if (existing) {
        return { processed: false, reason: "already_processed" };
    }
    if (event.type !== "checkout.session.completed") {
        await prisma.stripeWebhookEvent.create({
            data: { stripeEventId: event.id, type: event.type },
        });
        return { processed: false, reason: "ignored_event_type" };
    }
    const session = event.data.object;
    if (session.payment_status !== "paid") {
        throw new AppError(400, "Checkout session is not paid.", "SESSION_NOT_PAID");
    }
    const { userId, creditAmount } = extractCreditPackFromSession(session);
    const result = await creditUserLedger({
        userId,
        amount: creditAmount,
        type: "PURCHASE",
        idempotencyKey: `stripe_session_${session.id}`,
        externalRef: session.id,
        description: `Stripe purchase — ${creditAmount} credits`,
        metadata: {
            stripeEventId: event.id,
            stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
            paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
        },
    });
    await prisma.stripeWebhookEvent.create({
        data: { stripeEventId: event.id, type: event.type },
    });
    return { processed: true, result };
}
export async function grantCreditsFromAuth(params) {
    return creditUserLedger({
        userId: params.userId,
        amount: params.amount,
        type: "GRANT",
        idempotencyKey: params.eventId ? `auth_grant_${params.eventId}` : undefined,
        externalRef: params.eventId,
        description: params.reason,
        metadata: { source: "auth-service", reason: params.reason },
    });
}
//# sourceMappingURL=billing.service.js.map