import { authFetch } from "@/lib/api/auth-interceptor";
import { safeJson } from "@/lib/api/safe-json";

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  priceUsd: number;
  description: string;
  highlight?: boolean;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "starter",
    name: "Starter Pack",
    credits: 50,
    priceUsd: 5,
    description: "50 credits for casual exploration and homework sessions.",
  },
  {
    id: "pro",
    name: "Pro Pack",
    credits: 250,
    priceUsd: 20,
    description: "250 credits for intensive lab and research workflows.",
  },
  {
    id: "enterprise",
    name: "Studio Pack",
    credits: 700,
    priceUsd: 50,
    description: "700 credits for teams and high-volume research.",
    highlight: true,
  },
];

export function getCreditPackage(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}

/**
 * Lemon Squeezy is the sole payment provider and settles in the store
 * currency (USD), so checkout is always a redirect to its hosted page.
 */
export interface CheckoutApiData {
  provider: "lemonsqueezy";
  currency: "USD";
  mode: "redirect";
  checkoutUrl: string;
  orderId: string;
}

export interface CheckoutResponse {
  success: boolean;
  data?: CheckoutApiData;
  error?: string;
  code?: string;
}

export async function createCheckoutSession(
  packageId: string,
  options?: { returnPath?: string },
): Promise<CheckoutApiData> {
  const res = await authFetch("/api/billing/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      packageId,
      ...(options?.returnPath ? { returnPath: options.returnPath } : {}),
    }),
  });

  const data = await safeJson<CheckoutResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(data.error ?? "Checkout could not be started.");
  }

  return data.data;
}
