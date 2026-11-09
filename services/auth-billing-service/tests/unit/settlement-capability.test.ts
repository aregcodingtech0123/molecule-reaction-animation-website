/**
 * Settlement capabilities (Phase 2C step 1). Pure unit tests: no database, no network, no environment.
 * Test tokens are signed here with node:crypto directly, independently of the module, so these tests check the
 * documented format (`msc1.<base64url payload>.<base64url HMAC-SHA256>`) and not just the module against itself.
 * Every key is a fixed, test-only constant.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SettlementKeys } from "../../src/config/settlementSecret.js";
import {
  MAX_SETTLEMENT_TOKEN_LENGTH,
  SETTLEMENT_AUDIENCE,
  SETTLEMENT_EXPIRY_GRACE_SECONDS,
  SETTLEMENT_MAC_ENCODED_LENGTH,
  SettlementCapabilityConfigError,
  SettlementCapabilityInputError,
  matchesHoldRow,
  mintSettlementCapability,
  verifySettlementCapability,
  type SettlementBinding,
  type SettlementClaims,
  type SettlementHoldRow,
  type SettlementPurpose,
} from "../../src/utils/settlementCapability.js";

const KEY = "test-only-settlement-key-A-0123456789abcdefghij";
const OLD_KEY = "test-only-settlement-key-B-9876543210zyxwvutsrq";
const OTHER_KEY = "test-only-settlement-key-C-qwertyuiopasdfghjklz";
const KEYS: SettlementKeys = { current: KEY };

const USER = "3f2b8c1e-5a4d-4e7b-9c10-2d6f8a7b1c3e";
const OTHER_USER = "9a1c7d20-6b3e-4f58-8d41-0e2f5a7c9b13";
const REF = "4b9e0a52-7c1d-4f3a-8e26-b5d1c0a97f48";
const CREATED = 1_800_000_000;
const EXPIRES = 1_800_000_600;
const GRACE = SETTLEMENT_EXPIRY_GRACE_SECONDS;

const BINDING: SettlementBinding = {
  userId: USER,
  referenceId: REF,
  amount: 1,
  operationType: "AI_CHAT_QUERY",
  createdAtSeconds: CREATED,
  reservationExpiresAtSeconds: EXPIRES,
};
const ROW: SettlementHoldRow = {
  userId: USER,
  referenceId: REF,
  amount: 1,
  operationType: "AI_CHAT_QUERY",
  createdAtSeconds: CREATED,
  expiresAtSeconds: EXPIRES,
};

// ── Independent token helpers (the format as documented, not the module's own code) ──────────────────────
const b64 = (data: string | Buffer) => Buffer.from(data).toString("base64url");
const hmac = (key: string, input: string) => createHmac("sha256", key).update(input).digest("base64url");

function validClaims(purpose: SettlementPurpose = "capture"): SettlementClaims {
  return { pur: purpose, aud: SETTLEMENT_AUDIENCE, sub: USER, ref: REF, amt: 1, op: "AI_CHAT_QUERY", iat: CREATED, rexp: EXPIRES, exp: EXPIRES + GRACE };
}
/** A correctly signed token around any payload text. */
function signPayload(payload: string, key = KEY, prefix = "msc1") {
  const input = `${prefix}.${b64(payload)}`;
  return `${input}.${hmac(key, input)}`;
}
const signClaims = (claims: object, key = KEY) => signPayload(JSON.stringify(claims), key);
/** The claims without one of them. */
function omit(claims: SettlementClaims, name: keyof SettlementClaims): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...claims };
  delete copy[name];
  return copy;
}
const parts = (token: string) => token.split(".") as [string, string, string];
const claimsOf = (token: string) => JSON.parse(Buffer.from(parts(token)[1], "base64url").toString("utf8")) as Record<string, unknown>;

const capture = () => mintSettlementCapability("capture", BINDING, KEYS);
const refund = () => mintSettlementCapability("refund", BINDING, KEYS);
const verifyCapture = (token: unknown, now = CREATED + 10, keys: SettlementKeys = KEYS) =>
  verifySettlementCapability(token, { purpose: "capture", referenceId: REF }, keys, now);

describe("mint → verify round trip", () => {
  it.each<SettlementPurpose>(["capture", "refund"])("a %s capability verifies for its own purpose and reference", (purpose) => {
    const token = mintSettlementCapability(purpose, BINDING, KEYS);
    const result = verifySettlementCapability(token, { purpose, referenceId: REF }, KEYS, CREATED + 10);
    expect(result).toEqual({ ok: true, claims: validClaims(purpose) });
  });

  it("has the documented shape: msc1.<payload>.<43-char MAC>, base64url only, no padding", () => {
    const token = capture();
    const [prefix, payload, mac] = parts(token);
    expect(prefix).toBe("msc1");
    expect(token).toMatch(/^msc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(mac).toHaveLength(SETTLEMENT_MAC_ENCODED_LENGTH);
    expect(token).not.toMatch(/[=+/]/);
    expect(mac).toBe(hmac(KEY, `msc1.${payload}`));
  });

  it("binds exactly the nine claims, with the capability expiry = reservation expiry + 60 s", () => {
    expect(claimsOf(capture())).toEqual(validClaims("capture"));
    expect(claimsOf(capture()).exp).toBe(EXPIRES + 60);
  });

  it("is deterministic, and the two purposes produce different tokens", () => {
    expect(capture()).toBe(capture());
    expect(capture()).not.toBe(refund());
  });

  it("different reservations, users, amounts or keys produce different tokens", () => {
    const base = capture();
    expect(mintSettlementCapability("capture", { ...BINDING, referenceId: `${REF}-2` }, KEYS)).not.toBe(base);
    expect(mintSettlementCapability("capture", { ...BINDING, userId: OTHER_USER }, KEYS)).not.toBe(base);
    expect(mintSettlementCapability("capture", { ...BINDING, amount: 2 }, KEYS)).not.toBe(base);
    expect(mintSettlementCapability("capture", BINDING, { current: OTHER_KEY })).not.toBe(base);
  });

  it("a long unicode reference still produces a token inside the size bound that verifies", () => {
    const reference = "é".repeat(100) + "漢".repeat(100) + "😀".repeat(27); // 255 UTF-16 units
    expect(reference.length).toBe(254);
    const token = mintSettlementCapability("capture", { ...BINDING, referenceId: reference }, KEYS);
    expect(token.length).toBeLessThanOrEqual(MAX_SETTLEMENT_TOKEN_LENGTH);
    expect(verifySettlementCapability(token, { purpose: "capture", referenceId: reference }, KEYS, CREATED + 1)).toMatchObject({ ok: true });
  });
});

describe("altered payloads are rejected (the original MAC no longer matches)", () => {
  const ALTERED: Array<[string, unknown]> = [
    ["pur", "refund"],
    ["aud", "someone-else"],
    ["sub", OTHER_USER],
    ["ref", "other-reference"],
    ["amt", 1000],
    ["op", "ARCH_RENDER_HD"],
    ["iat", CREATED - 1],
    ["rexp", EXPIRES + 3600],
    ["exp", EXPIRES + GRACE + 3600],
  ];

  it.each(ALTERED)("claim %s changed → bad_signature", (claim, value) => {
    const [prefix, , mac] = parts(capture());
    const tampered = `${prefix}.${b64(JSON.stringify({ ...validClaims("capture"), [claim]: value }))}.${mac}`;
    expect(verifyCapture(tampered)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a claim removed or added without re-signing → bad_signature", () => {
    const [prefix, , mac] = parts(capture());
    const withoutExp = omit(validClaims("capture"), "exp");
    expect(verifyCapture(`${prefix}.${b64(JSON.stringify(withoutExp))}.${mac}`)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCapture(`${prefix}.${b64(JSON.stringify({ ...validClaims("capture"), extra: 1 }))}.${mac}`)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a capture token cannot be turned into a refund token by editing it", () => {
    const [prefix, , mac] = parts(capture());
    const asRefund = `${prefix}.${b64(JSON.stringify(validClaims("refund")))}.${mac}`;
    expect(verifySettlementCapability(asRefund, { purpose: "refund", referenceId: REF }, KEYS, CREATED)).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("invalid signatures", () => {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  it("a changed character anywhere in the MAC → bad_signature", () => {
    const [prefix, payload, mac] = parts(capture());
    for (let i = 0; i < mac.length; i += 7) {
      const swapped = mac[i] === "A" ? "B" : "A";
      const forged = `${prefix}.${payload}.${mac.slice(0, i)}${swapped}${mac.slice(i + 1)}`;
      expect(verifyCapture(forged), `position ${i}`).toEqual({ ok: false, reason: "bad_signature" });
    }
  });

  it("signed with a different key → bad_signature", () => {
    expect(verifyCapture(signClaims(validClaims("capture"), OTHER_KEY))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("the signature of a different payload → bad_signature", () => {
    const [prefix, payload] = parts(capture());
    const [, , otherMac] = parts(refund());
    expect(verifyCapture(`${prefix}.${payload}.${otherMac}`)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a MAC over the payload alone (not 'msc1.<payload>') → bad_signature", () => {
    const [prefix, payload] = parts(capture());
    expect(verifyCapture(`${prefix}.${payload}.${hmac(KEY, payload)}`)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a signature of the wrong length is refused as malformed before any comparison, and never throws", () => {
    const [prefix, payload, mac] = parts(capture());
    for (const wrong of [mac.slice(0, -1), `${mac}A`, mac.slice(0, 10), "A", `${mac}${mac}`]) {
      expect(() => verifyCapture(`${prefix}.${payload}.${wrong}`)).not.toThrow();
      expect(verifyCapture(`${prefix}.${payload}.${wrong}`)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("a non-canonical spelling of the right MAC (spare low bits of the last character) is NOT accepted", () => {
    const [prefix, payload, mac] = parts(capture());
    const idx = ALPHABET.indexOf(mac.at(-1)!);
    const variant = mac.slice(0, -1) + ALPHABET[idx - (idx % 4) + ((idx % 4) + 1) % 4];
    expect(variant).not.toBe(mac);
    // Precondition: both spellings decode to the same 32 bytes, so a decode-then-compare would have accepted it.
    expect(Buffer.from(variant, "base64url").equals(Buffer.from(mac, "base64url"))).toBe(true);
    expect(verifyCapture(`${prefix}.${payload}.${variant}`)).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("malformed tokens are refused without throwing", () => {
  const [, payload, mac] = parts(capture());
  const MALFORMED: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["a number", 12345],
    ["an object", { token: "x" }],
    ["an array", ["msc1", payload, mac]],
    ["a boolean", true],
    ["empty string", ""],
    ["prefix only", "msc1"],
    ["empty payload and MAC", "msc1.."],
    ["one dot only", "msc1.abc"],
    ["two parts", `msc1.${payload}`],
    ["four parts", `msc1.${payload}.${mac}.extra`],
    ["a trailing dot", `msc1.${payload}.${mac}.`],
    ["wrong version prefix", `msc2.${payload}.${mac}`],
    ["upper-case prefix", `MSC1.${payload}.${mac}`],
    ["no prefix", `${payload}.${mac}.x`],
    ["leading space", ` msc1.${payload}.${mac}`],
    ["trailing space", `msc1.${payload}.${mac} `],
    ["trailing newline", `msc1.${payload}.${mac}\n`],
    ["empty payload", `msc1..${mac}`],
    ["empty MAC", `msc1.${payload}.`],
    ["padding in the payload", `msc1.${payload}=.${mac}`],
    ["standard-base64 characters in the payload", `msc1.${payload.slice(0, 8)}+/${payload.slice(10)}.${mac}`],
    ["a non-ASCII payload", `msc1.${payload.slice(0, 8)}é${payload.slice(9)}.${mac}`],
    ["a non-ASCII MAC", `msc1.${payload}.${mac.slice(0, 42)}é`],
    ["a MAC with an invalid character", `msc1.${payload}.${mac.slice(0, 42)}!`],
    ["an embedded NUL", `msc1.${payload}\0.${mac}`],
  ];

  it.each(MALFORMED)("%s → malformed", (_label, token) => {
    expect(() => verifyCapture(token)).not.toThrow();
    expect(verifyCapture(token)).toEqual({ ok: false, reason: "malformed" });
  });

  it("the size bound: 4097 characters is malformed; exactly 4096 well-shaped characters reaches the MAC check", () => {
    const shaped = (length: number) => `msc1.${"A".repeat(length - 4 - 1 - 1 - SETTLEMENT_MAC_ENCODED_LENGTH)}.${"B".repeat(SETTLEMENT_MAC_ENCODED_LENGTH)}`;
    expect(shaped(MAX_SETTLEMENT_TOKEN_LENGTH).length).toBe(MAX_SETTLEMENT_TOKEN_LENGTH);
    expect(verifyCapture(shaped(MAX_SETTLEMENT_TOKEN_LENGTH))).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCapture(shaped(MAX_SETTLEMENT_TOKEN_LENGTH + 1))).toEqual({ ok: false, reason: "malformed" });
  });

  it("a correctly signed token over the size bound is still refused, before the MAC is computed", () => {
    const huge = signClaims({ ...validClaims("capture"), padding: "x".repeat(MAX_SETTLEMENT_TOKEN_LENGTH) });
    expect(huge.length).toBeGreaterThan(MAX_SETTLEMENT_TOKEN_LENGTH);
    expect(verifyCapture(huge)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("a correctly signed token with an invalid payload → invalid_claims (strict claim validation)", () => {
  const base = validClaims("capture");
  const without = (name: keyof SettlementClaims) => omit(base, name);

  const BAD: Array<[string, string]> = [
    ["not JSON", "this is not json"],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
    ["a JSON number", "123"],
    ["a JSON string", '"msc1"'],
    ["an empty object", "{}"],
    ["a truncated object", JSON.stringify(base).slice(0, -3)],
    ...(["pur", "aud", "sub", "ref", "amt", "op", "iat", "rexp", "exp"] as const).map((name): [string, string] => [`missing ${name}`, JSON.stringify(without(name))]),
    ["an extra claim", JSON.stringify({ ...base, role: "admin" })],
    ["a duplicate-looking extra claim", JSON.stringify({ ...base, ref2: REF })],
    ["pur not a known purpose", JSON.stringify({ ...base, pur: "deduct" })],
    ["pur upper-case", JSON.stringify({ ...base, pur: "CAPTURE" })],
    ["pur not a string", JSON.stringify({ ...base, pur: 1 })],
    ["aud not a string", JSON.stringify({ ...base, aud: 7 })],
    ["sub not a UUID", JSON.stringify({ ...base, sub: "not-a-uuid" })],
    ["sub not a string", JSON.stringify({ ...base, sub: 42 })],
    ["ref empty", JSON.stringify({ ...base, ref: "" })],
    ["ref padded with a space", JSON.stringify({ ...base, ref: ` ${REF}` })],
    ["ref longer than 255", JSON.stringify({ ...base, ref: "r".repeat(256) })],
    ["ref not a string", JSON.stringify({ ...base, ref: 5 })],
    ["amt zero", JSON.stringify({ ...base, amt: 0 })],
    ["amt negative", JSON.stringify({ ...base, amt: -1 })],
    ["amt fractional", JSON.stringify({ ...base, amt: 1.5 })],
    ["amt a string", JSON.stringify({ ...base, amt: "1" })],
    ["amt beyond the safe integers", '{"pur":"capture","aud":"' + SETTLEMENT_AUDIENCE + '","sub":"' + USER + '","ref":"' + REF + '","amt":9007199254740993,"op":"AI_CHAT_QUERY","iat":1800000000,"rexp":1800000600,"exp":1800000660}'],
    ["op empty", JSON.stringify({ ...base, op: "" })],
    ["op longer than 32", JSON.stringify({ ...base, op: "O".repeat(33) })],
    ["op not a string", JSON.stringify({ ...base, op: 3 })],
    ["iat negative", JSON.stringify({ ...base, iat: -1 })],
    ["iat fractional", JSON.stringify({ ...base, iat: 1.5 })],
    ["iat a string", JSON.stringify({ ...base, iat: "1800000000" })],
    ["rexp before iat", JSON.stringify({ ...base, rexp: CREATED - 1, exp: CREATED - 1 + GRACE })],
    ["rexp a string", JSON.stringify({ ...base, rexp: "1800000600" })],
    ["exp not rexp + 60 (too early)", JSON.stringify({ ...base, exp: EXPIRES + GRACE - 1 })],
    ["exp not rexp + 60 (too late)", JSON.stringify({ ...base, exp: EXPIRES + GRACE + 1 })],
    ["exp null", JSON.stringify({ ...base, exp: null })],
  ];

  it.each(BAD)("%s", (_label, payload) => {
    expect(verifyCapture(signPayload(payload))).toEqual({ ok: false, reason: "invalid_claims" });
  });
});

describe("audience, purpose and reference", () => {
  it("a validly signed token for another audience → wrong_audience", () => {
    expect(verifyCapture(signClaims({ ...validClaims("capture"), aud: "auth-billing-service/other" }))).toEqual({ ok: false, reason: "wrong_audience" });
  });

  it("a capture token presented for a refund → wrong_purpose, and the reverse", () => {
    expect(verifySettlementCapability(capture(), { purpose: "refund", referenceId: REF }, KEYS, CREATED)).toEqual({ ok: false, reason: "wrong_purpose" });
    expect(verifySettlementCapability(refund(), { purpose: "capture", referenceId: REF }, KEYS, CREATED)).toEqual({ ok: false, reason: "wrong_purpose" });
  });

  it("a request for another reference → reference_mismatch", () => {
    expect(verifySettlementCapability(capture(), { purpose: "capture", referenceId: `${REF}-other` }, KEYS, CREATED)).toEqual({ ok: false, reason: "reference_mismatch" });
  });

  it.each([undefined, null, 42, "", ` ${REF}`, `${REF} `, {}])("an unusable or untrimmed requested reference (%j) never matches", (reference) => {
    expect(verifySettlementCapability(capture(), { purpose: "capture", referenceId: reference }, KEYS, CREATED)).toEqual({ ok: false, reason: "reference_mismatch" });
  });

  it("checks run in a fixed order: audience, then purpose, then reference, then expiry", () => {
    const wrongAudience = signClaims({ ...validClaims("refund"), aud: "x" });
    expect(verifySettlementCapability(wrongAudience, { purpose: "capture", referenceId: "nope" }, KEYS, EXPIRES + 10_000)).toEqual({ ok: false, reason: "wrong_audience" });
    expect(verifySettlementCapability(refund(), { purpose: "capture", referenceId: "nope" }, KEYS, EXPIRES + 10_000)).toEqual({ ok: false, reason: "wrong_purpose" });
    expect(verifySettlementCapability(capture(), { purpose: "capture", referenceId: "nope" }, KEYS, EXPIRES + 10_000)).toEqual({ ok: false, reason: "reference_mismatch" });
    expect(verifySettlementCapability(capture(), { purpose: "capture", referenceId: REF }, KEYS, EXPIRES + 10_000)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("expiry", () => {
  it.each([
    ["the second it was issued", CREATED, true],
    ["mid-reservation", CREATED + 300, true],
    ["the reservation's own expiry", EXPIRES, true],
    ["one second after the reservation expiry (inside the grace)", EXPIRES + 1, true],
    ["the last second of the grace (exp)", EXPIRES + GRACE, true],
    ["one second past exp", EXPIRES + GRACE + 1, false],
    ["an hour past exp", EXPIRES + 3600, false],
  ])("at %s → %s", (_label, now, valid) => {
    const result = verifyCapture(capture(), now);
    if (valid) expect(result).toMatchObject({ ok: true });
    else expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("expiry is checked after the signature: an expired forgery is bad_signature, not expired", () => {
    const [prefix, payload] = parts(capture());
    expect(verifyCapture(`${prefix}.${payload}.${"A".repeat(SETTLEMENT_MAC_ENCODED_LENGTH)}`, EXPIRES + 10_000)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("the default clock is the real time: a token expired years ago is refused without passing a time", () => {
    const old = mintSettlementCapability("capture", { ...BINDING, createdAtSeconds: 1000, reservationExpiresAtSeconds: 1600 }, KEYS);
    expect(verifySettlementCapability(old, { purpose: "capture", referenceId: REF }, KEYS)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("keys: missing, empty, blank and rotation", () => {
  const NO_KEYS: Array<[string, unknown]> = [
    ["an empty current key", { current: "" }],
    ["a whitespace-only current key", { current: "   \t " }],
    ["a missing current key", {}],
    ["a non-string current key", { current: 12345 }],
    ["undefined keys", undefined],
    ["null keys", null],
  ];

  it.each(NO_KEYS)("%s → mint throws a configuration error", (_label, keys) => {
    expect(() => mintSettlementCapability("capture", BINDING, keys as SettlementKeys)).toThrow(SettlementCapabilityConfigError);
  });

  it.each(NO_KEYS)("%s → verify throws a configuration error (it is a deployment problem, not a bad token)", (_label, keys) => {
    // Called directly: the verifyCapture helper would replace `undefined` keys with its default.
    expect(() => verifySettlementCapability(capture(), { purpose: "capture", referenceId: REF }, keys as SettlementKeys, CREATED)).toThrow(
      SettlementCapabilityConfigError,
    );
  });

  it("an empty current key never signs, and a token signed with an empty key is never accepted", () => {
    const forged = signClaims(validClaims("capture"), "");
    expect(verifyCapture(forged)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each<[string, SettlementKeys]>([
    ["previous = empty string", { current: KEY, previous: "" }],
    ["previous = whitespace", { current: KEY, previous: "   " }],
    ["previous undefined", { current: KEY, previous: undefined }],
    ["previous absent", { current: KEY }],
  ])("a blank previous key never verifies an empty-key forgery (%s)", (_label, keys) => {
    expect(verifyCapture(signClaims(validClaims("capture"), ""), CREATED, keys)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCapture(signClaims(validClaims("capture"), "   "), CREATED, keys)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rotation: a token minted under the old key verifies while it is the previous key, and not once it is removed", () => {
    const oldToken = mintSettlementCapability("capture", BINDING, { current: OLD_KEY });
    expect(verifyCapture(oldToken, CREATED, { current: KEY, previous: OLD_KEY })).toMatchObject({ ok: true });
    expect(verifyCapture(oldToken, CREATED, { current: KEY })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCapture(oldToken, CREATED, { current: KEY, previous: "   " })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rotation: new tokens are always signed with the current key, never the previous one", () => {
    const token = mintSettlementCapability("capture", BINDING, { current: KEY, previous: OLD_KEY });
    expect(token).toBe(capture());
    expect(verifyCapture(token, CREATED, { current: OLD_KEY })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a previous key equal to the current one is harmless", () => {
    expect(verifyCapture(capture(), CREATED, { current: KEY, previous: KEY })).toMatchObject({ ok: true });
  });

  it("keys are trimmed the same way when minting and verifying", () => {
    const token = mintSettlementCapability("capture", BINDING, { current: `  ${KEY}\n` });
    expect(token).toBe(capture());
    expect(verifyCapture(token, CREATED, { current: ` ${KEY} ` })).toMatchObject({ ok: true });
  });

  it("an unrelated key never verifies", () => {
    expect(verifyCapture(capture(), CREATED, { current: OTHER_KEY })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCapture(capture(), CREATED, { current: OTHER_KEY, previous: OLD_KEY })).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("mint refuses unusable input", () => {
  it("an unknown purpose", () => {
    expect(() => mintSettlementCapability("deduct" as SettlementPurpose, BINDING, KEYS)).toThrow(SettlementCapabilityInputError);
  });

  it.each<[string, Partial<SettlementBinding>]>([
    ["userId", { userId: "not-a-uuid" }],
    ["userId", { userId: "" }],
    ["referenceId", { referenceId: "" }],
    ["referenceId", { referenceId: " padded " }],
    ["referenceId", { referenceId: "r".repeat(256) }],
    ["amount", { amount: 0 }],
    ["amount", { amount: -1 }],
    ["amount", { amount: 1.5 }],
    ["amount", { amount: Number.NaN }],
    ["amount", { amount: Number.MAX_SAFE_INTEGER + 2 }],
    ["amount", { amount: "1" as unknown as number }],
    ["operationType", { operationType: "" }],
    ["operationType", { operationType: "O".repeat(33) }],
    ["createdAtSeconds", { createdAtSeconds: -1 }],
    ["createdAtSeconds", { createdAtSeconds: 1.5 }],
    ["createdAtSeconds", { createdAtSeconds: "1800000000" as unknown as number }],
    ["reservationExpiresAtSeconds", { reservationExpiresAtSeconds: CREATED - 1 }],
    ["reservationExpiresAtSeconds", { reservationExpiresAtSeconds: Number.POSITIVE_INFINITY }],
  ])("a bad %s throws and names that field only", (field, override) => {
    try {
      mintSettlementCapability("capture", { ...BINDING, ...override }, KEYS);
      expect.unreachable("mint accepted an invalid binding");
    } catch (err) {
      expect(err).toBeInstanceOf(SettlementCapabilityInputError);
      expect((err as SettlementCapabilityInputError).field).toBe(field);
    }
  });

  it("a configuration error is reported before an input error", () => {
    expect(() => mintSettlementCapability("capture", { ...BINDING, amount: 0 }, { current: "" })).toThrow(SettlementCapabilityConfigError);
  });
});

describe("matchesHoldRow: the token must be for exactly this row (the row stays authoritative)", () => {
  const claims = () => {
    const result = verifyCapture(capture());
    if (!result.ok) throw new Error("fixture token must verify");
    return result.claims;
  };

  it("an identical row matches", () => {
    expect(matchesHoldRow(claims(), ROW)).toEqual({ ok: true });
  });

  it.each<[string, Partial<SettlementHoldRow>, string]>([
    ["another user's row (wrong user)", { userId: OTHER_USER }, "sub"],
    ["another reservation's row (wrong reference)", { referenceId: `${REF}-2` }, "ref"],
    ["a different reserved amount", { amount: 2 }, "amt"],
    ["a different operation", { operationType: "ARCH_RENDER_HD" }, "op"],
    ["a different creation time (another row, or a replaced one)", { createdAtSeconds: CREATED + 1 }, "iat"],
    ["a different reservation expiry", { expiresAtSeconds: EXPIRES + 1 }, "rexp"],
  ])("%s → mismatch on %s", (_label, override, field) => {
    expect(matchesHoldRow(claims(), { ...ROW, ...override })).toEqual({ ok: false, field });
  });

  it.each([
    ["a numeric string amount from a database driver", { amount: "1" }],
    ["a numeric string creation time", { createdAtSeconds: "1800000000" }],
    ["a numeric string expiry", { expiresAtSeconds: "1800000600" }],
    ["a null amount", { amount: null }],
    ["a missing user", { userId: undefined }],
  ])("%s fails closed", (_label, override) => {
    expect(matchesHoldRow(claims(), { ...ROW, ...override } as unknown as SettlementHoldRow)).toMatchObject({ ok: false });
  });

  it("does not look at the row's status or remaining time: it is only a binding check", () => {
    // The row type has no status field at all; callers must read status/expiry from the database row under lock.
    expect(Object.keys(ROW).sort()).toEqual(["amount", "createdAtSeconds", "expiresAtSeconds", "operationType", "referenceId", "userId"]);
    expect(matchesHoldRow(claims(), ROW)).toEqual({ ok: true });
  });
});

describe("no secret, token or payload leaks through errors or results", () => {
  it("failure results carry only a reason string", () => {
    const token = capture();
    for (const result of [verifyCapture(`${token}x`), verifyCapture(signClaims(validClaims("capture"), OTHER_KEY)), verifyCapture(undefined)]) {
      const text = JSON.stringify(result);
      expect(Object.keys(result)).toEqual(["ok", "reason"]);
      for (const secret of [KEY, OLD_KEY, OTHER_KEY, token, parts(token)[1], parts(token)[2], REF, USER]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it("thrown errors name a field or a problem, never a value", () => {
    const secretish = "very-secret-reference-value";
    const errors: Error[] = [];
    for (const attempt of [
      () => mintSettlementCapability("capture", { ...BINDING, referenceId: ` ${secretish} ` }, KEYS),
      () => mintSettlementCapability("capture", { ...BINDING, amount: -7 }, KEYS),
      () => mintSettlementCapability("capture", BINDING, { current: "", previous: OLD_KEY }),
      () => verifySettlementCapability(capture(), { purpose: "capture", referenceId: REF }, { current: "", previous: OLD_KEY }, CREATED),
    ]) {
      try {
        attempt();
      } catch (err) {
        errors.push(err as Error);
      }
    }
    expect(errors).toHaveLength(4);
    for (const err of errors) {
      expect(err.message).not.toContain(secretish);
      expect(err.message).not.toContain("-7");
      for (const key of [KEY, OLD_KEY]) expect(err.message).not.toContain(key);
      expect(err.stack ?? "").not.toContain(OLD_KEY);
    }
  });
});
