function billingServiceBaseUrl(): string | null {
  const raw = process.env.BILLING_SERVICE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export async function fetchUserBalance(userId: string, bearerToken: string): Promise<number | null> {
  const base = billingServiceBaseUrl();
  if (!base) return null;

  const res = await fetch(`${base}/balance`, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearerToken}` },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { success?: boolean; data?: { balance?: number } };
  return typeof data.data?.balance === "number" ? data.data.balance : null;
}

export async function deductUserCredits(params: {
  bearerToken: string;
  amount: number;
  type: string;
  referenceId: string;
}): Promise<{ ok: boolean; newBalance?: number; status: number }> {
  const base = billingServiceBaseUrl();
  if (!base) {
    return { ok: false, status: 503 };
  }

  const res = await fetch(`${base}/deduct`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      type: params.type,
      referenceId: params.referenceId,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  const data = (await res.json()) as { data?: { newBalance?: number } };
  return {
    ok: true,
    status: res.status,
    newBalance: data.data?.newBalance,
  };
}
