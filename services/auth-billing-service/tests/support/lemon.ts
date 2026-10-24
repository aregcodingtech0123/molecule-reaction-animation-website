import { createHmac, randomInt } from "node:crypto";
import { TEST_ENV } from "../setup/env";

export const VARIANTS = {
  starter: Number(TEST_ENV.LEMONSQUEEZY_VARIANT_STARTER),
  pro: Number(TEST_ENV.LEMONSQUEEZY_VARIANT_PRO),
  enterprise: Number(TEST_ENV.LEMONSQUEEZY_VARIANT_ENTERPRISE),
} as const;

export const PRICES = { starter: 500, pro: 2000, enterprise: 5000 } as const;
export const CREDITS = { starter: 50, pro: 250, enterprise: 700 } as const;

export interface OrderOptions {
  orderId?: string;
  eventName?: string;
  customData?: Record<string, unknown> | undefined;
  email?: string;
  variantId?: number | null;
  total?: number;
  subtotal?: number;
  price?: number;
  status?: string;
  currency?: string;
  refunded?: boolean;
}

export function newOrderId(): string {
  return String(randomInt(10_000_000, 99_999_999));
}

/** A Lemon Squeezy `order_created` webhook body (shape per Lemon docs). */
export function orderCreatedEvent(opts: OrderOptions = {}) {
  const pkg = "starter";
  const orderId = opts.orderId ?? newOrderId();
  return {
    meta: {
      event_name: opts.eventName ?? "order_created",
      ...(opts.customData === undefined ? {} : { custom_data: opts.customData }),
    },
    data: {
      type: "orders",
      id: orderId,
      attributes: {
        store_id: Number(TEST_ENV.LEMONSQUEEZY_STORE_ID),
        customer_id: 1,
        identifier: `ident-${orderId}`,
        order_number: Number(orderId),
        status: opts.status ?? "paid",
        currency: opts.currency ?? "USD",
        total: opts.total ?? PRICES[pkg],
        subtotal: opts.subtotal ?? opts.total ?? PRICES[pkg],
        tax: 0,
        refunded: opts.refunded ?? false,
        user_email: opts.email ?? "nobody@example.test",
        first_order_item:
          opts.variantId === null
            ? undefined
            : {
                variant_id: opts.variantId ?? VARIANTS[pkg],
                product_name: "Credits",
                price: opts.price ?? opts.subtotal ?? opts.total ?? PRICES[pkg],
              },
      },
    },
  };
}

export function sign(raw: string | Buffer, secret: string = TEST_ENV.LEMONSQUEEZY_WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

/** Serialise once and sign the exact bytes that will be sent. */
export function signedBody(event: unknown, secret?: string) {
  const raw = JSON.stringify(event);
  return { raw, signature: sign(raw, secret) };
}
