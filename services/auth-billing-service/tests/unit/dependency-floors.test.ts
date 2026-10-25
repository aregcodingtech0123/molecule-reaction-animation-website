/**
 * SEC-02: minimum patched versions of Express's request-handling dependencies. The service is
 * publicly reachable (Lemon webhook), so a lockfile regression below these versions must fail CI.
 *   body-parser ≥ 2.4.0   GHSA-27r3-jxmh-p828 (uncaught exception from compressed bodies → process crash)
 *   proxy-addr  ≥ 2.0.8   GHSA-jqcg-44mw-7w3h (IPv4-mapped IPv6 trust subnets)
 *   qs          ≥ 6.16.0  GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function installed(name: string): string {
  return (require(`${name}/package.json`) as { version: string }).version;
}

function atLeast(version: string, floor: string): boolean {
  const a = version.split(/[.+-]/).slice(0, 3).map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return true;
}

describe("patched dependency floors (SEC-02)", () => {
  it.each([
    ["body-parser", "2.4.0"],
    ["proxy-addr", "2.0.8"],
    ["qs", "6.16.0"],
  ])("%s is at least %s", (name, floor) => {
    const version = installed(name);
    expect(atLeast(version, floor), `${name}@${version} < ${floor}`).toBe(true);
  });

  it("the version comparison itself is correct", () => {
    expect(atLeast("2.4.0", "2.4.0")).toBe(true);
    expect(atLeast("2.3.9", "2.4.0")).toBe(false);
    expect(atLeast("2.10.0", "2.4.0")).toBe(true);
    expect(atLeast("3.0.0-beta.1", "2.4.0")).toBe(true);
  });
});
