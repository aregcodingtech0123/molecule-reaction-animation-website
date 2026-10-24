import { expect, test } from "@playwright/test";
import {
  CHECKOUT_HOST,
  E2E_VARIANTS,
  GEMINI_REPLY,
  balanceVia,
  closeDb,
  db,
  deliverOrderCreated,
  dismissWelcome,
  isolateBrowser,
  plantVerificationToken,
  trackPageErrors,
  uniqueEmail,
} from "./support.mjs";

test.afterAll(async () => {
  await closeDb();
});

test("register → verify → dashboard → checkout → signed webhook → credits → AI Lab → logout @mobile", async ({ page, context }, info) => {
  const pageErrors = trackPageErrors(page);
  await isolateBrowser(page);
  const email = uniqueEmail(info.project.name);
  const password = "E2e-pass-123";

  // ── Register through the real sign-up dialog ────────────────────────────────
  await page.goto("/signup");
  const dialog = page.getByRole("dialog", { name: /create your account/i });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("Jane").fill("Ada");
  await dialog.getByPlaceholder("Doe").fill("Lovelace");
  await dialog.locator('input[type="date"]').fill("1990-12-10");
  await dialog.locator('input[type="email"]').fill(email);
  await dialog.locator('input[type="password"]').fill(password);
  await dialog.getByRole("button", { name: "Create Account" }).click();
  await expect(dialog).toBeHidden();

  // Session lives only in an httpOnly cookie — never in web storage.
  const session = (await context.cookies()).find((c) => c.name === "session_token");
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Strict", secure: false, path: "/" });
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(storage).not.toContain(session!.value);
  expect(await balanceVia(page.request)).toBe(0);

  // ── Verify email (token planted the way the mailer would deliver it) ─────────
  const raw = await plantVerificationToken(email);
  await page.goto(`/verify-email?token=${encodeURIComponent(raw)}`);
  await expect(page.getByText("Email verified").first()).toBeVisible();
  await expect.poll(() => balanceVia(page.request)).toBe(10);

  // ── Dashboard shows the signup bonus ─────────────────────────────────────────
  await page.goto("/dashboard");
  await dismissWelcome(page);
  const ledger = page.getByRole("table");
  await expect(ledger).toContainText("Signup Bonus");
  await expect(ledger).toContainText("+10");

  // ── Start checkout; stop at the Lemon redirect ───────────────────────────────
  await page.goto("/pricing");
  await dismissWelcome(page);
  await page.getByRole("article").filter({ hasText: "Starter Pack" }).getByRole("button", { name: "Buy Now" }).click();
  await page.waitForURL((u) => u.hostname === CHECKOUT_HOST);
  const checkout = new URL(page.url());
  expect(checkout.searchParams.get("package_id")).toBe("starter");
  expect(checkout.searchParams.get("variant_id")).toBe(E2E_VARIANTS.starter);
  const userId = checkout.searchParams.get("user_id")!;
  const pendingOrderId = checkout.searchParams.get("pending_order_id")!;
  const pending = await db().query(`SELECT status, user_id::text FROM pending_checkout_orders WHERE id = $1`, [pendingOrderId]);
  expect(pending.rows[0]).toEqual({ status: "pending", user_id: userId });

  // ── Lemon delivers the signed order_created webhook to Express ───────────────
  const hook = await deliverOrderCreated(
    page.request,
    { user_id: userId, package_id: "starter", pending_order_id: pendingOrderId },
    { email, total: 500, variantId: E2E_VARIANTS.starter },
  );
  expect(hook.status()).toBe(200);
  expect(await hook.json()).toEqual({ received: true });

  // ── Lemon sends the buyer back to the redirect_url our server built ──────────
  const redirectUrl = checkout.searchParams.get("redirect_url")!;
  expect(redirectUrl).toBe("http://localhost:3100/pricing?payment=success&credits=50");
  await page.goto(redirectUrl);
  await dismissWelcome(page);
  await expect.poll(() => balanceVia(page.request), { timeout: 30_000 }).toBe(60);
  await expect(page.getByText("Current balance: 60")).toBeVisible();

  // ── The dashboard ledger shows the purchase ──────────────────────────────────
  await page.goto("/dashboard");
  await dismissWelcome(page);
  await expect(page.getByRole("table")).toContainText("Credit Purchase");
  await expect(page.getByRole("table")).toContainText("+50");
  const completed = await db().query(`SELECT status FROM pending_checkout_orders WHERE id = $1`, [pendingOrderId]);
  expect(completed.rows[0].status).toBe("completed");

  // ── Use the AI Lab: one turn costs one credit ────────────────────────────────
  await page.goto("/ai-lab");
  await dismissWelcome(page);
  const input = page.getByPlaceholder(/Ask about a molecule/i).first();
  await input.fill("What is benzene?");
  await page.getByRole("button", { name: "Send message" }).first().click();
  await expect(page.getByText(GEMINI_REPLY).first()).toBeVisible();
  await expect.poll(() => balanceVia(page.request)).toBe(59);
  const usage = await db().query(
    `SELECT amount FROM credit_ledger_transactions WHERE user_id = $1 AND transaction_type = 'CREDIT_CONSUMPTION'`,
    [userId],
  );
  expect(usage.rows).toEqual([{ amount: -1 }]);

  // ── Logout clears the session and re-gates protected pages ───────────────────
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Logout" }).first().click();
  await expect.poll(async () => (await context.cookies()).some((c) => c.name === "session_token")).toBe(false);
  expect(await balanceVia(page.request)).toBeNull();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  expect(pageErrors).toEqual([]);
});
