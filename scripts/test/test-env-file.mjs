/**
 * Loads the gitignored repo-root `.env.test`, but only an allowlist of
 * test-infrastructure keys. Application secrets are never taken from files in
 * tests — every suite defines them explicitly.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWED_KEYS = new Set(["TEST_DATABASE_URL", "E2E_WEB_PORT", "E2E_API_PORT"]);

export function loadTestEnvFile(file = path.join(repoRoot, ".env.test")) {
  if (!fs.existsSync(file)) return {};
  const loaded = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || !ALLOWED_KEYS.has(m[1])) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined && value) {
      process.env[m[1]] = value;
      loaded[m[1]] = value;
    }
  }
  return loaded;
}
