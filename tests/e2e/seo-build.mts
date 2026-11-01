import { execFileSync } from "node:child_process";
import { repoRoot, webEnv } from "../../scripts/test/e2e-env.mjs";

/** Builds the production output into the isolated E2E dist dir (same env and network guard as the E2E stack). */
export default function globalSetup() {
  if (process.env.SEO_SKIP_BUILD === "1") return;
  execFileSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...webEnv(), NODE_ENV: "production", E2E_NEXT_MODE: "production" } as unknown as NodeJS.ProcessEnv,
  });
}
