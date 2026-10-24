import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN, WEB_ORIGIN, WEB_PORT, apiEnv, repoRoot, webEnv } from "./scripts/test/e2e-env.mjs";

/**
 * E2E against a dedicated local stack (Next :3100, Express :4100, guarded
 * moleculestudio_e2e_test DB). Lemon Squeezy and Gemini are stubbed inside the
 * servers by scripts/test/e2e-preload.mjs; the browser's external requests are
 * blocked per test. Servers are always started fresh (env changes need restarts).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
    navigationTimeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      // Recreate the guarded E2E database, then boot Express with the stub preload.
      command: "node ../../scripts/test/prepare-test-db.mjs && npx tsx src/index.ts",
      cwd: `${repoRoot}/services/auth-billing-service`,
      url: `${API_ORIGIN}/health`,
      env: apiEnv(),
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx next dev --port ${WEB_PORT}`,
      cwd: repoRoot,
      url: `${WEB_ORIGIN}/`,
      env: webEnv(),
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
