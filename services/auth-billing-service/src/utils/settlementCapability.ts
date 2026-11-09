/**
 * Reservation-bound settlement capabilities (Phase 2C). Minted by the reserve operation; verified on /capture and /refund.
 *
 * A capability is a short-lived token the billing service signs when it reserves credits. Presenting it (together with
 * the internal service key) later authorises exactly one operation on exactly one reservation, without a live user
 * session. Tokens are issued per purpose: `capture` and `refund` for every reservation, and `delivery_ack` only for a
 * reservation whose BFF opted in to delivery tracking. A token for one purpose can never authorise another.
 *
 * `delivery_ack` authorises recording that the BFF reached the point of returning a settled answer. It moves no credit and
 * changes no settlement state.
 *
 *   msc1.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>
 *   MAC input = the exact ASCII bytes "msc1.<base64url payload>" (never re-serialised)
 *
 * What a valid token proves — and what it does not:
 *  - It proves the billing service signed these claims. It does NOT prove the reservation exists, is still `held`,
 *    has not expired, or has this amount. The database row is authoritative for all of that. `matchesHoldRow` checks
 *    that the row the caller loaded is the one the token was minted for; the caller must still read the status,
 *    expiry and amount from the row under the usual locks. `exp` is only a defence-in-depth bound.
 *
 * Pure: reads no environment, logs nothing, touches no database. No token, payload or key ever appears in an error
 * message or in a verification result.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SettlementKeys } from "../config/settlementSecret.js";

export type SettlementPurpose = "capture" | "refund" | "delivery_ack";

export const SETTLEMENT_TOKEN_PREFIX = "msc1";
export const SETTLEMENT_AUDIENCE = "auth-billing-service/settlement";
/** Seconds a capability stays valid after the reservation's own expiry, so a late retry gets the accurate business answer. */
export const SETTLEMENT_EXPIRY_GRACE_SECONDS = 60;
/** Upper bound for a whole token. Checked before anything is decoded or hashed. */
export const MAX_SETTLEMENT_TOKEN_LENGTH = 4096;
/** A SHA-256 MAC is 32 bytes = 43 base64url characters without padding. */
export const SETTLEMENT_MAC_ENCODED_LENGTH = 43;
export const MAX_SETTLEMENT_REFERENCE_LENGTH = 255;
export const MAX_SETTLEMENT_OPERATION_LENGTH = 32;

const PURPOSES: readonly SettlementPurpose[] = ["capture", "refund", "delivery_ack"];
const CLAIM_NAMES = ["pur", "aud", "sub", "ref", "amt", "op", "iat", "rexp", "exp"] as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SettlementClaims {
  pur: SettlementPurpose;
  aud: string;
  /** User ID. */
  sub: string;
  /** Reference ID: both the reservation ID and the turn ID (the hold's primary key is `(user_id, reference_id)`). */
  ref: string;
  /** Reserved credits. */
  amt: number;
  /** Operation type. */
  op: string;
  /** Floor of the reservation's `created_at`, in epoch seconds. Pins the exact row. */
  iat: number;
  /** Floor of the reservation's `expires_at`, in epoch seconds. */
  rexp: number;
  /** Capability expiry: `rexp` plus the grace. */
  exp: number;
}

/** What the signer must know about the reservation. Values come from the hold row, never from a caller's request. */
export interface SettlementBinding {
  userId: string;
  referenceId: string;
  amount: number;
  operationType: string;
  createdAtSeconds: number;
  reservationExpiresAtSeconds: number;
}

/** The hold row fields a verified token is compared against. */
export interface SettlementHoldRow {
  userId: string;
  referenceId: string;
  amount: number;
  operationType: string;
  createdAtSeconds: number;
  expiresAtSeconds: number;
}

export type SettlementVerifyFailure =
  | "malformed"
  | "bad_signature"
  | "invalid_claims"
  | "wrong_audience"
  | "wrong_purpose"
  | "reference_mismatch"
  | "expired";

export type SettlementVerifyResult = { ok: true; claims: SettlementClaims } | { ok: false; reason: SettlementVerifyFailure };

export type SettlementRowMismatch = "sub" | "ref" | "amt" | "op" | "iat" | "rexp";

/** The signing key is missing or empty. A deployment problem, never a bad token. The message names no value. */
export class SettlementCapabilityConfigError extends Error {
  constructor() {
    super("The settlement capability secret is not configured.");
    this.name = "SettlementCapabilityConfigError";
  }
}

/** A value passed to `mintSettlementCapability` is unusable. Names the field only, never its value. */
export class SettlementCapabilityInputError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`Invalid settlement capability input: ${field}.`);
    this.name = "SettlementCapabilityInputError";
    this.field = field;
  }
}

/**
 * The keys that may sign or verify, current first. A blank previous key is dropped here, so it can never verify
 * anything (Node accepts an empty HMAC key, which would otherwise let anyone forge a token).
 */
function activeKeys(keys: SettlementKeys | undefined): string[] {
  const current = typeof keys?.current === "string" ? keys.current.trim() : "";
  if (!current) throw new SettlementCapabilityConfigError();
  const previous = typeof keys?.previous === "string" ? keys.previous.trim() : "";
  return previous ? [current, previous] : [current];
}

function sign(key: string, signingInput: string): string {
  return createHmac("sha256", key).update(signingInput, "utf8").digest("base64url");
}

const isSafeCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function validBinding(binding: SettlementBinding): string | null {
  if (typeof binding?.userId !== "string" || !UUID.test(binding.userId)) return "userId";
  const ref = binding.referenceId;
  if (typeof ref !== "string" || ref.length < 1 || ref.length > MAX_SETTLEMENT_REFERENCE_LENGTH || ref !== ref.trim()) return "referenceId";
  if (typeof binding.amount !== "number" || !Number.isSafeInteger(binding.amount) || binding.amount < 1) return "amount";
  const op = binding.operationType;
  if (typeof op !== "string" || op.length < 1 || op.length > MAX_SETTLEMENT_OPERATION_LENGTH) return "operationType";
  if (!isSafeCount(binding.createdAtSeconds)) return "createdAtSeconds";
  if (!isSafeCount(binding.reservationExpiresAtSeconds) || binding.reservationExpiresAtSeconds < binding.createdAtSeconds) {
    return "reservationExpiresAtSeconds";
  }
  return null;
}

/**
 * Sign a capability for one purpose on one reservation. Deterministic: the same inputs give the same token (replay is
 * harmless because the hold has a single final state, so no nonce is needed).
 *
 * @throws SettlementCapabilityConfigError when the current key is missing or empty
 * @throws SettlementCapabilityInputError when the purpose or a binding field is unusable
 */
export function mintSettlementCapability(purpose: SettlementPurpose, binding: SettlementBinding, keys: SettlementKeys): string {
  const [key] = activeKeys(keys);
  if (!PURPOSES.includes(purpose)) throw new SettlementCapabilityInputError("purpose");
  const badField = validBinding(binding);
  if (badField) throw new SettlementCapabilityInputError(badField);

  const claims: SettlementClaims = {
    pur: purpose,
    aud: SETTLEMENT_AUDIENCE,
    sub: binding.userId,
    ref: binding.referenceId,
    amt: binding.amount,
    op: binding.operationType,
    iat: binding.createdAtSeconds,
    rexp: binding.reservationExpiresAtSeconds,
    exp: binding.reservationExpiresAtSeconds + SETTLEMENT_EXPIRY_GRACE_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signingInput = `${SETTLEMENT_TOKEN_PREFIX}.${payload}`;
  const token = `${signingInput}.${sign(key!, signingInput)}`;
  if (token.length > MAX_SETTLEMENT_TOKEN_LENGTH) throw new SettlementCapabilityInputError("referenceId");
  return token;
}

function parseClaims(json: string): SettlementClaims | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  // Exactly the nine claims: no more, no fewer.
  const keys = Object.keys(obj);
  if (keys.length !== CLAIM_NAMES.length || !CLAIM_NAMES.every((name) => Object.hasOwn(obj, name))) return null;

  const { pur, aud, sub, ref, amt, op, iat, rexp, exp } = obj;
  if (pur !== "capture" && pur !== "refund" && pur !== "delivery_ack") return null;
  if (typeof aud !== "string") return null;
  if (typeof sub !== "string" || !UUID.test(sub)) return null;
  if (typeof ref !== "string" || ref.length < 1 || ref.length > MAX_SETTLEMENT_REFERENCE_LENGTH || ref !== ref.trim()) return null;
  if (typeof amt !== "number" || !Number.isSafeInteger(amt) || amt < 1) return null;
  if (typeof op !== "string" || op.length < 1 || op.length > MAX_SETTLEMENT_OPERATION_LENGTH) return null;
  if (!isSafeCount(iat) || !isSafeCount(rexp) || !isSafeCount(exp)) return null;
  if (rexp < iat || exp !== rexp + SETTLEMENT_EXPIRY_GRACE_SECONDS) return null;
  return { pur, aud, sub, ref, amt, op, iat, rexp, exp };
}

/**
 * Check a presented capability. Never throws for a bad token; the failure reason is for server-side logs only and
 * must not be shown to the caller (it would be an oracle).
 *
 * Order, cheapest and safest first: key present, size cap, shape and characters, MAC length, MAC compare (every
 * configured key, no early exit), and only then JSON parsing, strict claim validation, audience, purpose, reference
 * and expiry.
 *
 * @param expected  the route's purpose and the request's (trimmed) referenceId
 * @param nowSeconds epoch seconds; injectable for tests
 * @throws SettlementCapabilityConfigError when the current key is missing or empty
 */
export function verifySettlementCapability(
  token: unknown,
  expected: { purpose: SettlementPurpose; referenceId: unknown },
  keys: SettlementKeys,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SettlementVerifyResult {
  const candidateKeys = activeKeys(keys);
  const fail = (reason: SettlementVerifyFailure): SettlementVerifyResult => ({ ok: false, reason });

  if (typeof token !== "string" || token.length === 0 || token.length > MAX_SETTLEMENT_TOKEN_LENGTH) return fail("malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== SETTLEMENT_TOKEN_PREFIX) return fail("malformed");
  const payloadPart = parts[1]!;
  const macPart = parts[2]!;
  if (payloadPart.length === 0 || !BASE64URL.test(payloadPart)) return fail("malformed");
  // The exact length is required BEFORE the constant-time compare: timingSafeEqual throws on unequal lengths.
  if (macPart.length !== SETTLEMENT_MAC_ENCODED_LENGTH || !BASE64URL.test(macPart)) return fail("malformed");

  const signingInput = `${SETTLEMENT_TOKEN_PREFIX}.${payloadPart}`;
  const presented = Buffer.from(macPart, "utf8");
  let authentic = false;
  for (const key of candidateKeys) {
    // Compared as the encoded strings, so the 4 base64url spellings of one MAC (spare low bits) are not all accepted.
    const wanted = Buffer.from(sign(key, signingInput), "utf8");
    if (wanted.length === presented.length && timingSafeEqual(wanted, presented)) authentic = true;
  }
  if (!authentic) return fail("bad_signature");

  const claims = parseClaims(Buffer.from(payloadPart, "base64url").toString("utf8"));
  if (!claims) return fail("invalid_claims");
  if (claims.aud !== SETTLEMENT_AUDIENCE) return fail("wrong_audience");
  if (claims.pur !== expected.purpose) return fail("wrong_purpose");
  if (typeof expected.referenceId !== "string" || claims.ref !== expected.referenceId) return fail("reference_mismatch");
  if (nowSeconds > claims.exp) return fail("expired");
  return { ok: true, claims };
}

/**
 * Is the loaded hold row the reservation this token was minted for? Strict equality on every bound field; a value of
 * the wrong type (e.g. a numeric string from the database driver) is a mismatch, so it fails closed.
 *
 * This is a binding check only. It does not look at the row's status, remaining time or whether it was settled;
 * those are read from the row itself.
 */
export function matchesHoldRow(
  claims: SettlementClaims,
  row: SettlementHoldRow,
): { ok: true } | { ok: false; field: SettlementRowMismatch } {
  if (claims.sub !== row.userId) return { ok: false, field: "sub" };
  if (claims.ref !== row.referenceId) return { ok: false, field: "ref" };
  if (claims.amt !== row.amount) return { ok: false, field: "amt" };
  if (claims.op !== row.operationType) return { ok: false, field: "op" };
  if (claims.iat !== row.createdAtSeconds) return { ok: false, field: "iat" };
  if (claims.rexp !== row.expiresAtSeconds) return { ok: false, field: "rexp" };
  return { ok: true };
}
