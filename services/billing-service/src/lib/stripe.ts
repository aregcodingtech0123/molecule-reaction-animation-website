import Stripe from "stripe";
import { env } from "../config/env.js";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    if (!env.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured.");
    }
    stripeClient = new Stripe(env.stripeSecretKey);
  }
  return stripeClient;
}

/**
 * Cryptographically verifies the Stripe webhook signature against the raw body.
 * Must receive the unparsed request buffer — not JSON-parsed body.
 */
export function verifyStripeWebhook(rawBody: Buffer, signatureHeader: string | undefined): Stripe.Event {
  if (!env.stripeWebhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
  if (!signatureHeader) {
    throw new Error("Missing Stripe-Signature header.");
  }

  return getStripe().webhooks.constructEvent(rawBody, signatureHeader, env.stripeWebhookSecret);
}

export function extractCreditPackFromSession(session: Stripe.Checkout.Session): {
  userId: string;
  creditAmount: number;
} {
  const userId = session.metadata?.userId ?? session.client_reference_id;
  if (!userId) {
    throw new Error("Checkout session missing userId (metadata.userId or client_reference_id).");
  }

  const rawCredits =
    session.metadata?.creditAmount ??
    session.metadata?.credits ??
    session.metadata?.credit_pack;

  const creditAmount = Number(rawCredits);
  if (!Number.isInteger(creditAmount) || creditAmount <= 0) {
    throw new Error("Checkout session missing valid creditAmount in metadata.");
  }

  return { userId, creditAmount };
}
