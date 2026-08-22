import { authFetch } from "@/lib/api/auth-interceptor";

export type BillingRegion = "TR" | "GLOBAL";

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  priceUsd: number;
  priceTry: number;
  description: string;
  highlight?: boolean;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "starter",
    name: "Starter Pack",
    credits: 100,
    priceUsd: 5,
    priceTry: 199,
    description: "100 credits for casual exploration and homework sessions.",
  },
  {
    id: "pro",
    name: "Pro Pack",
    credits: 500,
    priceUsd: 20,
    priceTry: 749,
    description: "500 credits — best value for intensive lab and research workflows.",
    highlight: true,
  },
];

export function getCreditPackage(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}

export function detectDefaultBillingRegion(): BillingRegion {
  if (typeof navigator === "undefined") return "GLOBAL";
  const lang = navigator.language?.toLowerCase() ?? "";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  if (lang.startsWith("tr") || tz === "Europe/Istanbul") return "TR";
  return "GLOBAL";
}

export interface CheckoutApiData {
  provider: "shopier" | "lemonsqueezy";
  currency: "TRY" | "USD";
  region: BillingRegion;
  mode: "redirect" | "shopier_form";
  checkoutUrl?: string;
  shopierForm?: {
    action: string;
    fields: Record<string, string>;
  };
  orderId: string;
}

export interface CheckoutResponse {
  success: boolean;
  data?: CheckoutApiData;
  error?: string;
  code?: string;
}

/** Auto-submit a classic Shopier payment form in the browser. */
export function submitShopierForm(form: { action: string; fields: Record<string, string> }): void {
  const el = document.createElement("form");
  el.method = "POST";
  el.action = form.action;
  el.style.display = "none";

  for (const [name, value] of Object.entries(form.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    el.appendChild(input);
  }

  document.body.appendChild(el);
  el.submit();
}

export async function createCheckoutSession(
  packageId: string,
  region: BillingRegion,
): Promise<CheckoutApiData> {
  const res = await authFetch("/api/billing/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ packageId, region }),
  });

  const data = (await res.json()) as CheckoutResponse;
  if (!res.ok || !data.success || !data.data) {
    throw new Error(data.error ?? "Checkout could not be started.");
  }

  return data.data;
}
