/**
 * SEO-18 / R12: the environment maps are cached for a year (`immutable`), so each file name must carry the first
 * 8 hex digits of its own sha256 - change the file, the name changes, no visitor keeps a stale map.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { ENVIRONMENT_FILES } from "@/components/canvas/SceneEnvironment";

const dir = path.resolve(__dirname, "../../../public/hdri");

describe("environment map assets", () => {
  it("every file in public/hdri is named <base>.<first 8 hex of sha256>.hdr", () => {
    const files = fs.readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const hash = createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex").slice(0, 8);
      expect(file, file).toMatch(new RegExp(`^[a-z0-9_]+\\.${hash}\\.hdr$`));
    }
  });

  it("the scene points at files that exist", () => {
    for (const url of Object.values(ENVIRONMENT_FILES)) {
      expect(fs.existsSync(path.join(dir, path.basename(url))), url).toBe(true);
    }
  });

  it("/hdri/* is served with a one-year immutable Cache-Control; pages keep their own (no-store) policy", async () => {
    const rules = await nextConfig.headers!();
    const hdri = rules.find((r) => r.source === "/hdri/:path*");
    expect(hdri?.headers).toEqual([{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
    // No page-wide rule sets Cache-Control (the per-request nonce CSP needs uncached HTML).
    for (const rule of rules.filter((r) => r.source === "/(.*)")) {
      expect(rule.headers.some((h) => h.key.toLowerCase() === "cache-control")).toBe(false);
    }
  });
});
