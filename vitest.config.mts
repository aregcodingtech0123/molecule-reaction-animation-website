import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const serviceTests = path.join(root, "services/auth-billing-service/tests");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${path.join(root, "src")}/` },
      // The BFF suite boots the real Express service in-process; its loadEnv must
      // never read services/auth-billing-service/.env (real secrets).
      { find: /^dotenv\/config$/, replacement: path.join(serviceTests, "stubs/dotenv-config.ts") },
      { find: /^dotenv$/, replacement: path.join(serviceTests, "stubs/dotenv.ts") },
    ],
  },
  test: {
    restoreMocks: true,
    unstubEnvs: true,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**/*.{ts,tsx}",
        "src/app/api/**/*.ts",
        "src/proxy.ts",
        "src/context/**/*.tsx",
        "src/hooks/**/*.ts",
        "src/components/{auth,billing,periodic-table,atom-models,layout,ai}/**/*.tsx",
      ],
      exclude: ["src/lib/**/content/**", "src/lib/molecules/structures/**", "src/lib/reactions/animation/definitions/**"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup/network.ts", "tests/setup/dom.ts", "tests/setup/owner-env.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "api",
          environment: "node",
          include: ["tests/api/**/*.test.ts"],
          env: { TEST_DB_NAME: "moleculestudio_bff_test" },
          setupFiles: [path.join(serviceTests, "setup/env.ts"), "tests/setup/network.ts", "tests/setup/bff-env.ts", "tests/setup/owner-env.ts"],
          globalSetup: [path.join(serviceTests, "setup/global-db.ts")],
        },
      },
    ],
  },
});
