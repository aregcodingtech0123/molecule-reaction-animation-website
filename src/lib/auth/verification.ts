/**
 * Server-side check against auth-billing-service GET /api/auth/me.
 * Used by Next.js /api/chat to block unverified accounts before Gemini spend.
 */
export async function fetchEmailVerificationStatus(
  bearerToken: string,
): Promise<{ ok: true; isVerified: boolean } | { ok: false; status: number }> {
  const base = process.env.AUTH_SERVICE_URL?.trim().replace(/\/+$/, "");
  if (!base) {
    return { ok: false, status: 503 };
  }

  try {
    const res = await fetch(`${base}/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false, status: res.status };
    }

    const body = (await res.json()) as {
      success?: boolean;
      data?: { isVerified?: boolean };
    };

    return {
      ok: true,
      isVerified: Boolean(body.data?.isVerified),
    };
  } catch (err) {
    console.error("[auth] verification status check failed:", err);
    return { ok: false, status: 503 };
  }
}
