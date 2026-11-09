/**
 * The delivery_ack purpose in the capability module (Phase 2C step 5.2.2 Part B). Pure: no database, no environment.
 * A token for one purpose must never authorise another, in any direction.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  mintSettlementCapability,
  SettlementCapabilityInputError,
  verifySettlementCapability,
  type SettlementBinding,
  type SettlementPurpose,
} from "../../src/utils/settlementCapability.js";

const KEYS = { current: "test-only-unit-key-for-delivery-ack-1a2b3c4d5e6f" };
const REF = "6a1f7c2e-1111-4b4b-9c9c-0000000000aa";
const CREATED = 1_800_000_000;
const EXPIRES = CREATED + 600;
const BINDING: SettlementBinding = {
  userId: "11111111-2222-4333-8444-555555555555",
  referenceId: REF,
  amount: 1,
  operationType: "AI_CHAT_QUERY",
  createdAtSeconds: CREATED,
  reservationExpiresAtSeconds: EXPIRES,
};
const PURPOSES: SettlementPurpose[] = ["capture", "refund", "delivery_ack"];
const mint = (purpose: SettlementPurpose) => mintSettlementCapability(purpose, BINDING, KEYS);
const verify = (token: string, purpose: SettlementPurpose, ref: unknown = REF, now = CREATED + 5) => verifySettlementCapability(token, { purpose, referenceId: ref }, KEYS, now);

describe("delivery_ack is a purpose of its own", () => {
  it("a delivery_ack token verifies for delivery_ack, with its purpose in the claims and the same audience and expiry as the others", () => {
    const result = verify(mint("delivery_ack"), "delivery_ack");
    expect(result).toMatchObject({ ok: true, claims: { pur: "delivery_ack", aud: "auth-billing-service/settlement", sub: BINDING.userId, ref: REF, amt: 1, op: "AI_CHAT_QUERY", iat: CREATED, rexp: EXPIRES, exp: EXPIRES + 60 } });
  });

  it.each(PURPOSES.flatMap((minted) => PURPOSES.filter((wanted) => wanted !== minted).map((wanted) => [minted, wanted] as const)))(
    "a %s token presented as %s → wrong_purpose",
    (minted, wanted) => {
      expect(verify(mint(minted), wanted)).toEqual({ ok: false, reason: "wrong_purpose" });
    },
  );

  it("the three tokens for one reservation are three different strings", () => {
    expect(new Set(PURPOSES.map(mint)).size).toBe(3);
  });

  it("minting is deterministic per purpose (a replay is the same token, so harmless)", () => {
    expect(mint("delivery_ack")).toBe(mint("delivery_ack"));
  });

  it("changing the purpose inside a signed token invalidates it", () => {
    const [prefix, payload, mac] = mint("capture").split(".") as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const forged = `${prefix}.${Buffer.from(JSON.stringify({ ...claims, pur: "delivery_ack" })).toString("base64url")}.${mac}`;
    expect(verify(forged, "delivery_ack")).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a delivery_ack token is bound to its reference, and expires like the others", () => {
    const token = mint("delivery_ack");
    expect(verify(token, "delivery_ack", "another-reference")).toEqual({ ok: false, reason: "reference_mismatch" });
    expect(verify(token, "delivery_ack", REF, EXPIRES + 61)).toEqual({ ok: false, reason: "expired" });
    expect(verify(token, "delivery_ack", REF, EXPIRES + 60)).toMatchObject({ ok: true });
  });

  it("a token signed with another key does not verify", () => {
    const foreign = mintSettlementCapability("delivery_ack", BINDING, { current: "test-only-a-different-key-for-delivery-ack-77" });
    expect(verify(foreign, "delivery_ack")).toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each(["deduct", "delivery", "DELIVERY_ACK", "delivery-ack", "", "ack", "capture ", "*"])("an unknown purpose '%s' still cannot be minted", (purpose) => {
    expect(() => mintSettlementCapability(purpose as SettlementPurpose, BINDING, KEYS)).toThrow(SettlementCapabilityInputError);
  });

  it("a validly signed token whose purpose is outside the three is refused as invalid claims", () => {
    const [prefix, payload] = mint("capture").split(".") as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    // Signed with the real key, so only the claim validation can refuse it.
    const body = Buffer.from(JSON.stringify({ ...claims, pur: "delivery" })).toString("base64url");
    const mac = createHmac("sha256", KEYS.current).update(`${prefix}.${body}`, "utf8").digest("base64url");
    expect(verify(`${prefix}.${body}.${mac}`, "delivery_ack")).toEqual({ ok: false, reason: "invalid_claims" });
  });
});
