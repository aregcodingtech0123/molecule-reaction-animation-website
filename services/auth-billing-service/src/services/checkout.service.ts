import type { PoolClient } from "../db/index.js";
import { pool, withTransaction } from "../db/index.js";
import type { PaymentProvider } from "../config/packages.js";
import {
  packageAmountMinor,
  regionToCurrency,
  regionToProvider,
  resolveBillingRegion,
  resolveCreditPackage,
  type BillingRegion,
  type CreditPackageConfig,
} from "../config/packages.js";
import { prepareShopierPaymentPayload } from "../lib/shopier.js";
import { createLemonSqueezyCheckoutUrl } from "../lib/lemonsqueezy.js";
import { AppError } from "../types/index.js";

export type CheckoutMode = "redirect" | "shopier_form";

export interface CheckoutResult {
  provider: PaymentProvider;
  currency: "TRY" | "USD";
  region: BillingRegion;
  mode: CheckoutMode;
  /** Present for Lemon Squeezy (and any redirect-based provider). */
  checkoutUrl?: string;
  /** Present for Shopier classic hosted form auto-submit. */
  shopierForm?: {
    action: string;
    fields: Record<string, string>;
  };
  orderId: string;
}

async function insertPendingOrder(
  client: PoolClient,
  params: {
    userId: string;
    packageId: string;
    provider: PaymentProvider;
    currency: "TRY" | "USD";
    amountMinor: number;
    credits: number;
  },
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO pending_checkout_orders
       (user_id, package_id, provider, currency, amount_minor, credits, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id::text`,
    [
      params.userId,
      params.packageId,
      params.provider,
      params.currency,
      params.amountMinor,
      params.credits,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new AppError(500, "Failed to create pending checkout order.", "CHECKOUT_CREATE_FAILED");
  }
  return id;
}

export async function createUnifiedCheckout(params: {
  userId: string;
  userEmail: string;
  packageId: unknown;
  regionOrCurrency: unknown;
  buyerName?: string;
}): Promise<CheckoutResult> {
  const pkg = resolveCreditPackage(params.packageId);
  const region = resolveBillingRegion(params.regionOrCurrency);
  const currency = regionToCurrency(region);
  const provider = regionToProvider(region);
  const amountMinor = packageAmountMinor(pkg, currency);

  if (provider === "shopier") {
    return createShopierCheckout({
      userId: params.userId,
      userEmail: params.userEmail,
      buyerName: params.buyerName ?? params.userEmail.split("@")[0] ?? "Customer",
      pkg,
      amountMinor,
      region,
    });
  }

  return createLemonCheckout({
    userId: params.userId,
    userEmail: params.userEmail,
    pkg,
    amountMinor,
    region,
  });
}

async function createShopierCheckout(params: {
  userId: string;
  userEmail: string;
  buyerName: string;
  pkg: CreditPackageConfig;
  amountMinor: number;
  region: BillingRegion;
}): Promise<CheckoutResult> {
  const orderId = await withTransaction(async (client) => {
    return insertPendingOrder(client, {
      userId: params.userId,
      packageId: params.pkg.id,
      provider: "shopier",
      currency: "TRY",
      amountMinor: params.amountMinor,
      credits: params.pkg.credits,
    });
  });

  const totalOrderValue = (params.amountMinor / 100).toFixed(2);
  const form = prepareShopierPaymentPayload({
    platformOrderId: orderId,
    productName: `${params.pkg.name} — ${params.pkg.credits} Credits`,
    totalOrderValue,
    buyerEmail: params.userEmail,
    buyerName: params.buyerName,
    buyerId: params.userId,
  });

  return {
    provider: "shopier",
    currency: "TRY",
    region: params.region,
    mode: "shopier_form",
    shopierForm: {
      action: form.action,
      fields: { ...form.fields },
    },
    orderId,
  };
}

async function createLemonCheckout(params: {
  userId: string;
  userEmail: string;
  pkg: CreditPackageConfig;
  amountMinor: number;
  region: BillingRegion;
}): Promise<CheckoutResult> {
  const orderId = await withTransaction(async (client) => {
    return insertPendingOrder(client, {
      userId: params.userId,
      packageId: params.pkg.id,
      provider: "lemonsqueezy",
      currency: "USD",
      amountMinor: params.amountMinor,
      credits: params.pkg.credits,
    });
  });

  const checkoutUrl = await createLemonSqueezyCheckoutUrl({
    userId: params.userId,
    userEmail: params.userEmail,
    packageId: params.pkg.id,
    productName: `${params.pkg.name} — ${params.pkg.credits} Credits`,
    pendingOrderId: orderId,
  });

  return {
    provider: "lemonsqueezy",
    currency: "USD",
    region: params.region,
    mode: "redirect",
    checkoutUrl,
    orderId,
  };
}

export interface FulfillPurchaseParams {
  userId: string;
  packageId: string;
  credits: number;
  provider: PaymentProvider;
  /** Shopier payment_id or Lemon Squeezy order id — stored as reference_id */
  paymentReference: string;
  /** Optional pending checkout row to mark completed */
  pendingOrderId?: string;
  expectedAmountMinor: number;
  actualAmountMinor: number;
  currency: string;
}

/**
 * Idempotent credit grant after a verified provider webhook.
 * Uses CREDIT_PURCHASE + unique (provider, reference_id).
 */
export async function fulfillVerifiedPurchase(
  params: FulfillPurchaseParams,
): Promise<{ processed: boolean; ledgerId: string | null; reason?: string }> {
  if (params.actualAmountMinor !== params.expectedAmountMinor) {
    console.error("[billing] Fraud alert: amount mismatch", {
      provider: params.provider,
      paymentReference: params.paymentReference,
      userId: params.userId,
      expected: params.expectedAmountMinor,
      actual: params.actualAmountMinor,
      currency: params.currency,
    });
    return { processed: false, ledgerId: null, reason: "amount_mismatch" };
  }

  return withTransaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id::text FROM credit_ledger_transactions
       WHERE provider = $1 AND reference_id = $2
       LIMIT 1`,
      [params.provider, params.paymentReference],
    );

    if ((existing.rowCount ?? 0) > 0) {
      return { processed: false, ledgerId: existing.rows[0]?.id ?? null, reason: "already_processed" };
    }

    await client.query(
      `INSERT INTO user_balances (user_id, balance) VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [params.userId],
    );

    const posted = await client.query<{ ledger_id: string }>(
      `SELECT post_credit_transaction($1, $2, 'CREDIT_PURCHASE'::credit_transaction_type, $3, $4) AS ledger_id`,
      [params.userId, params.credits, params.paymentReference, params.provider],
    );

    if (params.pendingOrderId) {
      await client.query(
        `UPDATE pending_checkout_orders
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [params.pendingOrderId],
      );
    }

    return {
      processed: true,
      ledgerId: posted.rows[0]?.ledger_id ?? null,
    };
  });
}

export async function getPendingOrderById(orderId: string) {
  const result = await pool.query<{
    id: string;
    user_id: string;
    package_id: string;
    provider: string;
    currency: string;
    amount_minor: number;
    credits: number;
    status: string;
  }>(
    `SELECT id::text, user_id::text, package_id, provider, currency, amount_minor, credits, status
     FROM pending_checkout_orders
     WHERE id = $1
     LIMIT 1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}
