/**
 * O-3 (Step 7.5): the server's environment and the database's authoritative policy (migration 022: `ledger_policy`,
 * `credit_packages`) must say the same thing about the Lemon store, the three variants, the prices, the credit amounts and test
 * mode. When they differ, purchases must not be credited. Pure: it compares two values it is given and opens nothing.
 *
 * Not wired into startup or the consumer yet: it needs migration 022's tables, which no database has. It is meant for the S5 step
 * (the owner fills the policy tables) and for the consumer's readiness check once C2-purchase is enabled. Problems are fixed codes
 * with the package id at most; never a store id, variant id or any other configured value.
 */
import { CREDIT_PACKAGES } from "./packages.js";

export interface PolicyEnvironment {
  production: boolean;
  storeId: string;
  variants: Readonly<Record<"starter" | "pro" | "enterprise", string>>;
  allowTestMode: boolean;
}

export interface LedgerPolicyRow {
  lemon_store_id: string | null;
  allow_test_mode: boolean;
}

export interface CreditPackageRow {
  package_id: string;
  credits: number;
  price_usd_cents: number;
  lemon_variant_id: string | null;
  active: boolean;
}

export function ledgerPolicyConsistencyProblems(
  environment: PolicyEnvironment,
  policy: LedgerPolicyRow | null,
  packages: readonly CreditPackageRow[],
): string[] {
  const problems: string[] = [];
  if (!policy) return ["policy_row_missing"];

  if (policy.lemon_store_id === null) problems.push("policy_store_id_not_set");
  else if (policy.lemon_store_id !== environment.storeId) problems.push("store_id_differs_from_environment");

  // Production is test mode OFF (O-3), in the database as in the environment; elsewhere the two must agree.
  if (environment.production && (policy.allow_test_mode || environment.allowTestMode)) problems.push("test_mode_enabled_in_production");
  else if (policy.allow_test_mode !== environment.allowTestMode) problems.push("test_mode_differs_from_environment");

  const seen = new Set<string>();
  for (const [id, pkg] of Object.entries(CREDIT_PACKAGES)) {
    const row = packages.find((p) => p.package_id === id);
    if (!row) {
      problems.push(`package_missing:${id}`);
      continue;
    }
    if (!row.active) problems.push(`package_inactive:${id}`);
    if (row.lemon_variant_id === null) problems.push(`package_variant_not_set:${id}`);
    else if (row.lemon_variant_id !== environment.variants[id as keyof PolicyEnvironment["variants"]]) problems.push(`package_variant_differs_from_environment:${id}`);
    if (row.credits !== pkg.credits) problems.push(`package_credits_differ_from_code:${id}`);
    if (row.price_usd_cents !== pkg.priceUsdCents) problems.push(`package_price_differs_from_code:${id}`);
    seen.add(id);
  }
  // An active row the code does not know could credit an amount nobody reviewed.
  for (const row of packages) {
    if (!seen.has(row.package_id) && row.active) problems.push(`package_unknown_but_active:${row.package_id}`);
  }
  return problems;
}
