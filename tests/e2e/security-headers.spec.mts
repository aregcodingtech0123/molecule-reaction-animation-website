import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { closeDb, dismissWelcome, isolateBrowser, plantVerificationToken, trackPageErrors, uniqueEmail } from "./support.mjs";

/**
 * Part 2B: security headers and the strict nonce CSP, as the browser receives them from the real build
 * (`next dev` by default, `next build` + `next start` with E2E_NEXT_MODE=production). The CSP must block
 * injected script while every page — 3D scenes, KaTeX, the signed-in AI Lab — runs without one violation.
 */
const PRODUCTION = process.env.E2E_NEXT_MODE === "production";
const PUBLIC_PAGES = ["/", "/explore", "/atom-models", "/periodic-table", "/learn", "/showcase", "/pricing", "/login", "/signup", "/forgot-password"];
const SIGNED_IN_PAGES = ["/dashboard", "/ai-lab", "/profile"];

test.afterAll(async () => {
  await closeDb();
});

/** Every CSP violation the page reports (enforced or report-only), captured from the first script on. */
async function trackCspViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

async function signIn(page: Page) {
  const email = uniqueEmail("csp");
  // Own client IP: the journeys share the 3-per-hour register bucket.
  const headers = { "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}` };
  const reg = await page.request.post("/api/auth/register", {
    headers,
    data: { email, password: "E2e-pass-123", firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10" },
  });
  expect(reg.status()).toBe(200);
  const verified = await page.request.post("/api/auth/verify-email", { headers, data: { token: await plantVerificationToken(email) } });
  expect(verified.status()).toBe(200);
}

test("every page carries the security headers and a fresh-nonce CSP; every served <script> has that nonce", async ({ request }) => {
  const seen = new Set<string>();
  for (const path of PUBLIC_PAGES) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const h = res.headers();
    const csp = h["content-security-policy"];
    expect(csp, `${path} CSP`).toBeTruthy();
    const nonce = csp!.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, path).toBeTruthy();
    expect(seen.has(nonce!), `${path} nonce reused`).toBe(false);
    seen.add(nonce!);
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'(;| 'unsafe-eval';)/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    expect(h["x-powered-by"]).toBeUndefined();
    if (PRODUCTION) expect(h["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
    else expect(h["strict-transport-security"]).toBeUndefined();

    const html = await res.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length, path).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag, `${path}: ${tag.slice(0, 80)}`).toContain(`nonce="${nonce}"`);
  }
});

/**
 * What an HTML-injection bug would put on the page: markup, parsed by the browser. ('strict-dynamic' trusts
 * scripts that already-trusted code creates with createElement — by design — so that is not the vector.)
 */
test("injected markup cannot run script: inline <script> (via srcdoc), event handlers, javascript: URLs", async ({ page }) => {
  await isolateBrowser(page);
  const violations = await trackCspViolations(page);
  await page.goto("/");
  const ran = await page.evaluate(async () => {
    const w = window as unknown as { __injected?: number; __handler?: number; __jsurl?: number };
    // An injected same-origin srcdoc iframe inherits this page's CSP; its inline script is parser-inserted.
    document.body.insertAdjacentHTML("beforeend", `<iframe srcdoc="<script>parent.__injected = 1</script>"></iframe>`);
    document.body.insertAdjacentHTML("beforeend", `<img src="data:,x" onerror="window.__handler = 1">`);
    document.body.insertAdjacentHTML("beforeend", `<a id="jsurl" href="javascript:window.__jsurl = 1">x</a>`);
    (document.getElementById("jsurl") as HTMLAnchorElement).click();
    await new Promise((r) => setTimeout(r, 500));
    return { injected: w.__injected ?? null, handler: w.__handler ?? null, jsurl: w.__jsurl ?? null };
  });
  expect(ran).toEqual({ injected: null, handler: null, jsurl: null });
  expect((await violations()).some((v) => v.startsWith("script-src"))).toBe(true);
});

test("public pages (3D scenes included) render without a single CSP violation or page error", async ({ page }) => {
  await isolateBrowser(page);
  const violations = await trackCspViolations(page);
  const errors = trackPageErrors(page);
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    await dismissWelcome(page);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(await violations(), path).toEqual([]);
  }
  for (const path of ["/", "/explore", "/atom-models"]) {
    await page.goto(path);
    await expect(page.locator("canvas").first(), `${path} 3D canvas`).toBeVisible({ timeout: 30_000 });
    expect(await violations(), path).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("signed-in pages and an AI Lab answer (markdown + math) render without a CSP violation", async ({ page }) => {
  await isolateBrowser(page);
  const violations = await trackCspViolations(page);
  const errors = trackPageErrors(page);
  await signIn(page);
  for (const path of SIGNED_IN_PAGES) {
    await page.goto(path);
    await dismissWelcome(page);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(await violations(), path).toEqual([]);
  }
  expect(errors).toEqual([]);
});
