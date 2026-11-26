import { describe, expect, it } from "vitest";
import {
  ledgerPolicyConsistencyProblems,
  type CreditPackageRow,
  type LedgerPolicyRow,
  type PolicyEnvironment,
} from "../../src/config/ledgerPolicyConsistency.js";

const environment: PolicyEnvironment = {
  production: true,
  storeId: "100",
  variants: { starter: "11", pro: "12", enterprise: "13" },
  allowTestMode: false,
};
const policy: LedgerPolicyRow = { lemon_store_id: "100", allow_test_mode: false };
const packages = (): CreditPackageRow[] => [
  { package_id: "starter", credits: 50, price_usd_cents: 500, lemon_variant_id: "11", active: true },
  { package_id: "pro", credits: 250, price_usd_cents: 2000, lemon_variant_id: "12", active: true },
  { package_id: "enterprise", credits: 700, price_usd_cents: 5000, lemon_variant_id: "13", active: true },
];
const withPackage = (id: string, change: Partial<CreditPackageRow>) => packages().map((p) => (p.package_id === id ? { ...p, ...change } : p));

describe("environment and ledger policy consistency (O-3)", () => {
  it("equal values: no problem", () => {
    expect(ledgerPolicyConsistencyProblems(environment, policy, packages())).toEqual([]);
  });

  it.each<[string, LedgerPolicyRow | null, CreditPackageRow[], string]>([
    ["no policy row", null, packages(), "policy_row_missing"],
    ["store id not set", { ...policy, lemon_store_id: null }, packages(), "policy_store_id_not_set"],
    ["another store id", { ...policy, lemon_store_id: "999" }, packages(), "store_id_differs_from_environment"],
    ["test mode on in the database, production", { ...policy, allow_test_mode: true }, packages(), "test_mode_enabled_in_production"],
    ["a package row missing", policy, packages().slice(1), "package_missing:starter"],
    ["a package inactive", policy, withPackage("pro", { active: false }), "package_inactive:pro"],
    ["a variant not set", policy, withPackage("pro", { lemon_variant_id: null }), "package_variant_not_set:pro"],
    ["a variant that differs", policy, withPackage("enterprise", { lemon_variant_id: "99" }), "package_variant_differs_from_environment:enterprise"],
    ["credits that differ from the code", policy, withPackage("starter", { credits: 5000 }), "package_credits_differ_from_code:starter"],
    ["a price that differs from the code", policy, withPackage("starter", { price_usd_cents: 1 }), "package_price_differs_from_code:starter"],
    ["an active package the code does not know", policy, [...packages(), { package_id: "gold", credits: 99999, price_usd_cents: 1, lemon_variant_id: "77", active: true }], "package_unknown_but_active:gold"],
  ])("%s → %s", (_label, p, rows, problem) => {
    expect(ledgerPolicyConsistencyProblems(environment, p, rows)).toContain(problem);
  });

  it("test mode in the environment is refused in production even when the database says off", () => {
    expect(ledgerPolicyConsistencyProblems({ ...environment, allowTestMode: true }, policy, packages())).toContain("test_mode_enabled_in_production");
  });

  it("outside production the two flags must agree", () => {
    const dev = { ...environment, production: false };
    expect(ledgerPolicyConsistencyProblems({ ...dev, allowTestMode: true }, { ...policy, allow_test_mode: true }, packages())).toEqual([]);
    expect(ledgerPolicyConsistencyProblems(dev, { ...policy, allow_test_mode: true }, packages())).toContain("test_mode_differs_from_environment");
  });

  it("an inactive unknown package is harmless", () => {
    const rows = [...packages(), { package_id: "old", credits: 1, price_usd_cents: 1, lemon_variant_id: null, active: false }];
    expect(ledgerPolicyConsistencyProblems(environment, policy, rows)).toEqual([]);
  });

  it("a problem never carries a configured value", () => {
    const text = ledgerPolicyConsistencyProblems(environment, { ...policy, lemon_store_id: "SECRETSTORE" }, withPackage("pro", { lemon_variant_id: "SECRETVARIANT" })).join(" ");
    expect(text).not.toMatch(/SECRETSTORE|SECRETVARIANT/);
  });
});
