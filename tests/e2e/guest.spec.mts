import { expect, test } from "@playwright/test";
import { HDR_CDN, isolateBrowser, trackPageErrors } from "./support.mjs";

test.beforeEach(async ({ page }) => {
  await isolateBrowser(page);
});

test.describe("guest journeys", () => {
  for (const path of ["/", "/explore", "/periodic-table", "/atom-models", "/pricing"]) {
    test(`${path} is reachable without login and throws no uncaught errors`, async ({ page }) => {
      const errors = trackPageErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : path}`));
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(errors).toEqual([]);
    });
  }

  // FINDING-31 (High): drei <Environment preset> downloads its HDR from a third-party CDN at
  // runtime. When that host is unreachable (outage, offline, CSP, corporate proxy) every 3D page
  // throws an uncaught "Could not load potsdamer_platz_1k.hdr"; the AI Lab page crashes entirely.
  for (const path of ["/", "/explore", "/atom-models"]) {
    test(`${path} renders without uncaught errors when the HDR CDN is unreachable (FINDING-31)`, async ({ page }) => {
      test.fail(true, "FINDING-31: environment map fetched from a third-party CDN with no fallback");
      await page.route(HDR_CDN, (route) => route.abort()); // later routes take precedence
      const errors = trackPageErrors(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(errors).toEqual([]);
    });
  }

  test("periodic table: selecting an element opens its detail panel", async ({ page }) => {
    await page.goto("/periodic-table");
    await page.getByRole("button", { name: "Oxygen, atomic number 8" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Oxygen" })).toBeVisible();
    await expect(page.getByText("Atomic #8")).toBeVisible();
  });

  test("atom models: timeline navigation switches the model and renders a canvas", async ({ page }) => {
    await page.goto("/atom-models");
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByRole("button", { name: /Bohr/ }).first().click();
    await expect(page.getByText(/Niels Bohr/).first()).toBeVisible();
  });

  test("pricing CTA for a guest routes to sign-up with the pack remembered", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("article").filter({ hasText: "Pro Pack" }).getByRole("button", { name: "Get Started" }).click();
    await expect(page).toHaveURL(/\/signup\?redirect_checkout=pro/);
    await expect(page.getByRole("dialog", { name: /create your account/i })).toBeVisible();
  });

  for (const path of ["/dashboard", "/ai-lab", "/profile"]) {
    test(`${path} redirects a guest to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test("a forged session cookie is rejected and cleared by the middleware", async ({ page, context }) => {
    await context.addCookies([{ name: "session_token", value: "forged.jwt.value", url: "http://localhost:3100" }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some((c) => c.name === "session_token")).toBe(false);
  });

  test("the legacy /api/ai/* proxy is gone (404)", async ({ request }) => {
    for (const path of ["/api/ai/generate", "/api/ai/anything/else"]) {
      expect((await request.post(path, { data: {} })).status()).toBe(404);
    }
  });

  test("/api/chat rejects guests with 401 before any work", async ({ request }) => {
    const res = await request.post("/api/chat", { data: { messages: [{ role: "user", content: "hi" }] } });
    expect(res.status()).toBe(401);
  });

  test("set-cookie refuses cross-origin requests", async ({ request }) => {
    const res = await request.post("/api/auth/set-cookie", { headers: { Origin: "https://evil.example" }, data: { token: "x" } });
    expect(res.status()).toBe(403);
  });
});
