import { expect, test, type Page } from "@playwright/test";
import { closeDb, dismissWelcome, isolateBrowser, plantVerificationToken, trackPageErrors, uniqueEmail } from "./support.mjs";

/**
 * FINDING-31: 3D environment maps are self-hosted, and a map that fails to load
 * never takes a page down — including the paid AI Lab.
 */
const LOCAL_HDR = /\/hdri\/[^/]+\.hdr(\?.*)?$/;

test.afterAll(async () => {
  await closeDb();
});

test.beforeEach(async ({ page }) => {
  await isolateBrowser(page);
});

/** Every .hdr the page asks for, and the status it got. */
function trackHdrRequests(page: Page) {
  const seen: Array<{ url: string; status: number | null }> = [];
  page.on("requestfinished", async (req) => {
    if (req.url().includes(".hdr")) seen.push({ url: req.url(), status: (await req.response())?.status() ?? null });
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes(".hdr")) seen.push({ url: req.url(), status: null });
  });
  return seen;
}

async function signIn(page: Page) {
  const email = uniqueEmail("scene");
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "E2e-pass-123", firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10" },
  });
  expect(reg.status()).toBe(200);
  const raw = await plantVerificationToken(email);
  const verified = await page.request.post("/api/auth/verify-email", { data: { token: raw } });
  expect(verified.status()).toBe(200);
}

test.describe("3D environment maps (FINDING-31)", () => {
  for (const path of ["/", "/explore", "/atom-models"]) {
    test(`${path} loads its environment map from this site only`, async ({ page }) => {
      const hdr = trackHdrRequests(page);
      const errors = trackPageErrors(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect.poll(() => hdr.length).toBeGreaterThan(0);
      expect(hdr.every((r) => new URL(r.url).origin === new URL(page.url()).origin && LOCAL_HDR.test(r.url))).toBe(true);
      expect(hdr.every((r) => r.status === 200)).toBe(true);
      expect(errors).toEqual([]);
    });

    test(`${path} still renders its 3D scene when the environment map cannot be loaded`, async ({ page }) => {
      await page.route(LOCAL_HDR, (route) => route.abort());
      const errors = trackPageErrors(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(page.locator("canvas").first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("the AI Lab stays usable when the environment map cannot be loaded", async ({ page }) => {
    await signIn(page);
    await page.route(LOCAL_HDR, (route) => route.abort());
    const errors = trackPageErrors(page);
    await page.goto("/ai-lab");
    await dismissWelcome(page);
    await expect(page.getByPlaceholder(/Ask about a molecule/i).first()).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.getByText(/couldn.t load|application error/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
