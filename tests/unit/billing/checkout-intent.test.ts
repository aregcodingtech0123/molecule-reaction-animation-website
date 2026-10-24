/**
 * FINDING-13 (frontend half): `?variant_id=` deep links map to packs only through
 * build-time env (NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_*), never hard-coded ids.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureCheckoutIntentFromSearchParams, loginUrlForPackage, peekCheckoutIntent } from "@/lib/billing/checkout-intent";

const params = (q: string) => new URLSearchParams(q);

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllEnvs());

function configureVariants() {
  vi.stubEnv("NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_STARTER", "700001");
  vi.stubEnv("NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_PRO", "700002");
  vi.stubEnv("NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_ENTERPRISE", "700003");
}

describe("checkout intent from variant_id (FINDING-13)", () => {
  it("maps configured variant ids to packs and remembers the intent", () => {
    configureVariants();
    expect(captureCheckoutIntentFromSearchParams(params("variant_id=700003"))).toBe("enterprise");
    expect(peekCheckoutIntent()).toBe("enterprise");
  });

  it("ignores the formerly hard-coded production ids", () => {
    configureVariants();
    for (const id of ["2154652", "2154661", "2154665"]) {
      expect(captureCheckoutIntentFromSearchParams(params(`variant_id=${id}`))).toBeNull();
    }
    expect(peekCheckoutIntent()).toBeNull();
  });

  it("with no variant env configured, variant links are ignored (fail closed) but redirect_checkout still works", () => {
    expect(captureCheckoutIntentFromSearchParams(params("variant_id=2154661"))).toBeNull();
    expect(captureCheckoutIntentFromSearchParams(params("redirect_checkout=pro"))).toBe("pro");
  });

  it.each([["__proto__"], ["constructor"], ["toString"]])("variant_id=%s is not a pack", (id) => {
    configureVariants();
    expect(captureCheckoutIntentFromSearchParams(params(`variant_id=${id}`))).toBeNull();
    expect(peekCheckoutIntent()).toBeNull();
  });

  it("loginUrlForPackage adds variant_id only when that pack's variant is configured", () => {
    expect(loginUrlForPackage("pro", "signup")).toBe("/signup?redirect_checkout=pro");
    configureVariants();
    expect(loginUrlForPackage("pro", "signup")).toBe("/signup?redirect_checkout=pro&variant_id=700002");
  });
});
