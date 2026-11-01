import { defineConfig } from "@playwright/test";

/**
 * SEO checks on the production build WITHOUT the database or Express (tests/e2e/seo.spec.mts starts its own
 * `next start` processes): `npm run test:seo`. The full E2E run (`E2E_NEXT_MODE=production npm run test:e2e`)
 * includes the same spec.
 */
process.env.E2E_NEXT_MODE = "production";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /seo\.spec\.mts$/,
  globalSetup: "./tests/e2e/seo-build.mts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
});
