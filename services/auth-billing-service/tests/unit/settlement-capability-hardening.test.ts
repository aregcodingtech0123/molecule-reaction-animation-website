/**
 * Phase 2C step 4: capability cases settlement-capability.test.ts does not reach. Tokens are signed here with node:crypto,
 * independently of the module. Every key is a fixed, test-only constant.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SettlementKeys } from "../../src/config/settlementSecret.js";
import {
  SETTLEMENT_AUDIENCE,
  SETTLEMENT_EXPIRY_GRACE_SECONDS,
  mintSettlementCapability,
  verifySettlementCapability,
  type SettlementBinding,
} from "../../src/utils/settlementCapability.js";

const KEY = "test-only-settlement-key-A-0123456789abcdefghij";
const OLD_KEY = "test-only-settlement-key-B-9876543210zyxwvutsrq";
const KEYS: SettlementKeys = { current: KEY };

const USER = "3f2b8c1e-5a4d-4e7b-9c10-2d6f8a7b1c3e";
const REF = "4b9e0a52-7c1d-4f3a-8e26-b5d1c0a97f48";
const CREATED = 1_800_000_000;
const EXPIRES = 1_800_000_600;

const BINDING: SettlementBinding = { userId: USER, referenceId: REF, amount: 1, operationType: "AI_CHAT_QUERY", createdAtSeconds: CREATED, reservationExpiresAtSeconds: EXPIRES };
const CLAIMS_JSON = JSON.stringify({ pur: "capture", aud: SETTLEMENT_AUDIENCE, sub: USER, ref: REF, amt: 1, op: "AI_CHAT_QUERY", iat: CREATED, rexp: EXPIRES, exp: EXPIRES + SETTLEMENT_EXPIRY_GRACE_SECONDS });

function signBytes(payload: Buffer, key = KEY) {
  const input = `msc1.${payload.toString("base64url")}`;
  return `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
}
const sign = (json: string, key = KEY) => signBytes(Buffer.from(json, "utf8"), key);
const verify = (token: unknown, keys: SettlementKeys = KEYS, now = CREATED + 1) => verifySettlementCapability(token, { purpose: "capture", referenceId: REF }, keys, now);

describe("strict claims against a correctly signed payload", () => {
  it("the control: the same construction, without the change, verifies", () => {
    expect(verify(sign(CLAIMS_JSON))).toMatchObject({ ok: true });
  });

  it.each([
    ["__proto__", `${CLAIMS_JSON.slice(0, -1)},"__proto__":{"amt":1000}}`],
    ["constructor", `${CLAIMS_JSON.slice(0, -1)},"constructor":{"prototype":{"amt":1000}}}`],
  ])("an extra %s claim is refused, not merged", (_label, json) => {
    expect(verify(sign(json))).toEqual({ ok: false, reason: "invalid_claims" });
  });

  it("a claim set whose only claims arrive through __proto__ is refused", () => {
    expect(verify(sign(`{"__proto__":${CLAIMS_JSON}}`))).toEqual({ ok: false, reason: "invalid_claims" });
  });

  it("bytes that are not UTF-8 are refused without throwing", () => {
    const token = signBytes(Buffer.from([0xff, 0xfe, 0x80, 0x00, 0xc3, 0x28]));
    expect(() => verify(token)).not.toThrow();
    expect(verify(token)).toEqual({ ok: false, reason: "invalid_claims" });
  });

  it("a failed verification never carries claims", () => {
    for (const token of [sign(`${CLAIMS_JSON.slice(0, -1)},"x":1}`), mintSettlementCapability("refund", BINDING, KEYS), "junk"]) {
      const result = verify(token);
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("claims");
    }
  });
});

describe("the previous key gets no wider powers than the current one", () => {
  const rotated: SettlementKeys = { current: KEY, previous: OLD_KEY };
  const old = (purpose: "capture" | "refund" = "capture", binding = BINDING) => mintSettlementCapability(purpose, binding, { current: OLD_KEY });

  it("purpose, reference and expiry are still enforced for a token signed with it", () => {
    expect(verify(old(), rotated)).toMatchObject({ ok: true });
    expect(verify(old("refund"), rotated)).toEqual({ ok: false, reason: "wrong_purpose" });
    expect(verifySettlementCapability(old(), { purpose: "capture", referenceId: `${REF}-2` }, rotated, CREATED + 1)).toEqual({ ok: false, reason: "reference_mismatch" });
    expect(verify(old(), rotated, EXPIRES + SETTLEMENT_EXPIRY_GRACE_SECONDS + 1)).toEqual({ ok: false, reason: "expired" });
  });

  it("strict claims are still enforced for a payload signed with it", () => {
    expect(verify(sign(`${CLAIMS_JSON.slice(0, -1)},"x":1}`, OLD_KEY), rotated)).toEqual({ ok: false, reason: "invalid_claims" });
  });

  it.each([[123], [null], [{}], [["a-key"]]])("a previous key that is not a string (%j) is ignored, and verifies nothing", (previous) => {
    const keys = { current: KEY, previous } as unknown as SettlementKeys;
    expect(verify(mintSettlementCapability("capture", BINDING, KEYS), keys)).toMatchObject({ ok: true });
    expect(verify(sign(CLAIMS_JSON, String(previous)), keys)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a previous key cannot stand in for a missing current key", () => {
    expect(() => verify(old(), { current: "", previous: OLD_KEY })).toThrow(/not configured/);
  });
});
