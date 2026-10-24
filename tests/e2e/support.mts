import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";
import { API_ORIGIN, E2E_VARIANTS, E2E_WEBHOOK_SECRET, e2eDatabaseUrl } from "../../scripts/test/e2e-env.mjs";

export const CHECKOUT_HOST = "checkout.e2e.test";
export const GEMINI_REPLY = "E2E stub: benzene is C6H6, an aromatic ring.";

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: e2eDatabaseUrl(), max: 3 });
  return pool;
}
export async function closeDb() {
  await pool?.end();
  pool = null;
}

export const uniqueEmail = (tag: string) => `e2e.${tag}.${randomUUID().slice(0, 8)}@example.test`;

/**
 * The browser may only talk to the app itself. The Lemon checkout page is
 * replaced by a stub document; everything else external (Google GSI,
 * Wikipedia images…) is aborted.
 */
/** drei's preset CDN — the app must never need it (FINDING-31: maps are self-hosted under /hdri/). */
export const HDR_CDN = /raw\.githack\.com\/pmndrs\/drei-assets\/.*\.hdr$/;

export async function isolateBrowser(page: Page) {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === CHECKOUT_HOST) {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Lemon checkout (E2E stub)</h1>" });
    }
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return route.continue();
    return route.abort();
  });
}

/** Collect uncaught page exceptions (not resource load failures from blocked hosts). */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

/** First-time users get an onboarding dialog; dismiss it like a person would. */
export async function dismissWelcome(page: Page) {
  const close = page.getByRole("button", { name: "Close welcome dialog" });
  if (await close.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    if (await close.isVisible().catch(() => false)) await close.click({ force: true });
  }
}

/** The raw token only travels by email; plant a known one exactly as the service stores it (SHA-256). */
export async function plantVerificationToken(email: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  const { rows } = await db().query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  expect(rows, `user ${email} should exist`).toHaveLength(1);
  await db().query(`DELETE FROM verification_tokens WHERE user_id = $1`, [rows[0]!.id]);
  await db().query(
    `INSERT INTO verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')`,
    [rows[0]!.id, hash],
  );
  return raw;
}

export async function balanceVia(request: APIRequestContext): Promise<number | null> {
  const res = await request.get("/api/billing/balance");
  if (!res.ok()) return null;
  return (await res.json()).data.balance;
}

/** Deliver a correctly signed Lemon `order_created` straight to Express (as Lemon would). */
export async function deliverOrderCreated(
  request: APIRequestContext,
  custom: Record<string, string>,
  opts: { email: string; total: number; variantId: string },
) {
  const event = {
    meta: { event_name: "order_created", custom_data: custom },
    data: {
      type: "orders",
      id: String(Date.now()),
      attributes: {
        store_id: 22222,
        customer_id: 1,
        identifier: randomUUID(),
        order_number: 1,
        status: "paid",
        currency: "USD",
        total: opts.total,
        subtotal: opts.total,
        tax: 0,
        refunded: false,
        user_email: opts.email,
        first_order_item: { variant_id: Number(opts.variantId), product_name: "Credits", price: opts.total },
      },
    },
  };
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", E2E_WEBHOOK_SECRET).update(raw).digest("hex");
  return request.post(`${API_ORIGIN}/api/billing/webhooks/lemonsqueezy`, {
    headers: { "Content-Type": "application/json", "X-Signature": signature },
    data: raw,
  });
}

export { E2E_VARIANTS };
