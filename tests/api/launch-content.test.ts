/** D6: the launch check fails while any trust-page placeholder remains, and passes once every value is real. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkLaunchContent } from "../../scripts/check-launch-content.mjs";
import { PLACEHOLDER_PREFIX, SITE_OWNER, type SiteOwner } from "@/lib/legal/site-owner";

const root = path.resolve(__dirname, "../..");
const FILLED = Object.fromEntries(Object.keys(SITE_OWNER).map((k) => [k, `real value for ${k}`])) as unknown as SiteOwner;

describe("check:launch-content", () => {
  it("today: fails, naming every placeholder field of SITE_OWNER", () => {
    const { problems } = checkLaunchContent();
    expect(problems).toHaveLength(Object.keys(SITE_OWNER).length);
    for (const field of Object.keys(SITE_OWNER)) expect(problems.join("\n")).toContain(`SITE_OWNER.${field}`);
  });

  it("one placeholder (or an empty value) is enough to fail; none passes", () => {
    expect(checkLaunchContent(FILLED).problems).toEqual([]);
    expect(checkLaunchContent({ ...FILLED, contactEmail: `${PLACEHOLDER_PREFIX} email` }).problems).toEqual([
      "trust pages: SITE_OWNER.contactEmail is still a placeholder (src/lib/legal/site-owner.ts)",
    ]);
    expect(checkLaunchContent({ ...FILLED, refundPolicy: "  " }).problems).toHaveLength(1);
  });

  it("the npm script exits 1 today and prints field names, not values", () => {
    const res = spawnSync(process.execPath, ["services/auth-billing-service/node_modules/tsx/dist/cli.mjs", "scripts/check-launch-content.mts"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(res.status, res.stderr).toBe(1);
    expect(res.stderr).toMatch(/placeholder\(s\) — the trust pages are drafts; not ready for launch/);
    expect(res.stderr).toContain("SITE_OWNER.legalName");
    expect(res.stderr).not.toContain(PLACEHOLDER_PREFIX);
  });
});
