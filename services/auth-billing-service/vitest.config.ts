import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const dotenvStub = path.join(root, "tests/stubs/dotenv.ts");
const dotenvConfigStub = path.join(root, "tests/stubs/dotenv-config.ts");

export default defineConfig({
  resolve: {
    // The service loads services/auth-billing-service/.env at import time.
    // Tests must never read real secrets, so dotenv is replaced with a no-op
    // and tests/setup/env.ts defines every variable explicitly.
    alias: [
      { find: /^dotenv\/config$/, replacement: dotenvConfigStub },
      { find: /^dotenv$/, replacement: dotenvStub },
    ],
  },
  test: {
    environment: "node",
    setupFiles: ["tests/setup/env.ts", "tests/setup/network.ts"],
    restoreMocks: true,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/db/diagnostics.ts", "src/types/**"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "api",
          include: ["tests/api/**/*.test.ts"],
          env: { TEST_DB_NAME: "moleculestudio_api_test" },
          globalSetup: ["tests/setup/global-db.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          env: { TEST_DB_NAME: "moleculestudio_db_test" },
          globalSetup: ["tests/setup/global-db.ts"],
        },
      },
    ],
  },
});
