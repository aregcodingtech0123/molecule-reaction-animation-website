import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAiOperationType, costForOperation, AI_OPERATION_COSTS } from "../../src/config/aiOperations.js";
import { resolveCreditPackage, CREDIT_PACKAGES } from "../../src/config/packages.js";
import { env, lemonVariantForPackage } from "../../src/config/env.js";
import { isDatabaseUnavailableError } from "../../src/db/unavailable.js";
import {
  packageIdForLemonVariant,
  parseLemonSqueezyEvent,
  readCustomDataString,
  verifyLemonSqueezySignature,
} from "../../src/lib/lemonsqueezy.js";
import { errorHandler, notFoundHandler } from "../../src/middlewares/errorHandler.js";
import { AppError } from "../../src/types/index.js";
import { extractBearerToken, signToken, verifyToken } from "../../src/utils/jwt.js";
import { generateSecureToken, hashToken, hoursFromNow, safeEqualHex } from "../../src/utils/secureToken.js";
import { normalizeEmail, validateGoogleIdToken, validatePassword, ValidationError } from "../../src/utils/validation.js";
import {
  toPublicUserProfile,
  validateDateOfBirth,
  validateProfileInput,
  validateProfileUpdateInput,
} from "../../src/utils/profile.js";
import { TEST_ENV } from "../setup/env";

afterEach(() => {
  vi.useRealTimers();
});

describe("credit packages & AI operation prices", () => {
  it("matches the published price list (starter $5/50, pro $20/250, enterprise $50/700)", () => {
    expect(Object.values(CREDIT_PACKAGES).map((p) => [p.id, p.priceUsdCents, p.credits])).toEqual([
      ["starter", 500, 50],
      ["pro", 2000, 250],
      ["enterprise", 5000, 700],
    ]);
  });

  it("resolveCreditPackage accepts only the three ids", () => {
    expect(resolveCreditPackage("pro").credits).toBe(250);
    for (const bad of [undefined, null, 1, "", "Pro", "free"]) {
      expect(() => resolveCreditPackage(bad)).toThrow("INVALID_PACKAGE");
    }
  });

  it("resolveCreditPackage rejects inherited object keys (FINDING-16)", () => {
    expect(() => resolveCreditPackage("__proto__")).toThrow("INVALID_PACKAGE");
    for (const key of ["constructor", "toString", "hasOwnProperty", "valueOf", "__defineGetter__"]) {
      expect(() => resolveCreditPackage(key)).toThrow("INVALID_PACKAGE");
    }
  });

  it("isAiOperationType only accepts own keys (prototype keys rejected)", () => {
    expect(Object.keys(AI_OPERATION_COSTS).every(isAiOperationType)).toBe(true);
    for (const bad of ["toString", "__proto__", "constructor", "", 1, null]) expect(isAiOperationType(bad)).toBe(false);
    expect(costForOperation("ARCH_RENDER_HD")).toBe(10);
  });

  it("lemonVariantForPackage maps packs to the env variants", () => {
    expect(["starter", "pro", "enterprise", "x"].map(lemonVariantForPackage)).toEqual(["900001", "900002", "900003", ""]);
  });
});

describe("Lemon Squeezy helpers", () => {
  const body = Buffer.from('{"meta":{"event_name":"order_created"}}');
  const good = createHmac("sha256", TEST_ENV.LEMONSQUEEZY_WEBHOOK_SECRET).update(body).digest("hex");

  it("verifyLemonSqueezySignature accepts the exact HMAC (whitespace-trimmed header)", () => {
    expect(() => verifyLemonSqueezySignature(body, good)).not.toThrow();
    expect(() => verifyLemonSqueezySignature(body, ` ${good} `)).not.toThrow();
  });

  it.each([[undefined], [""], ["abc"], [good.slice(1)], [good + "0"], ["é".repeat(64)]])(
    "rejects signature %j with AppError 401 (never throws a RangeError from timingSafeEqual)",
    (sig) => {
      try {
        verifyLemonSqueezySignature(body, sig as string | undefined);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(401);
      }
    },
  );

  it("parseLemonSqueezyEvent rejects non-JSON and non-object JSON with 400", () => {
    for (const raw of ["{", "null", "42", '"str"']) {
      expect(() => parseLemonSqueezyEvent(Buffer.from(raw))).toThrow(AppError);
    }
    expect(parseLemonSqueezyEvent(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
  });

  it("packageIdForLemonVariant: env mapping, string/number ids, unknown → null", () => {
    expect(packageIdForLemonVariant(900002)).toBe("pro");
    expect(packageIdForLemonVariant(" 900003 ")).toBe("enterprise");
    expect(packageIdForLemonVariant(null)).toBeNull();
    expect(packageIdForLemonVariant("")).toBeNull();
    expect(packageIdForLemonVariant(1)).toBeNull();
  });

  it("packageIdForLemonVariant no longer honours hard-coded production variant ids (FINDING-13)", () => {
    expect([2154652, 2154661, 2154665].map(packageIdForLemonVariant)).toEqual([null, null, null]);
  });

  it("readCustomDataString coerces scalars and treats blank as missing", () => {
    const custom = { a: " x ", n: 5, b: true, blank: "  ", nul: null };
    expect(["a", "n", "b", "blank", "nul", "missing"].map((k) => readCustomDataString(custom, k))).toEqual([
      "x",
      "5",
      "true",
      null,
      null,
      null,
    ]);
    expect(readCustomDataString(undefined, "a")).toBeNull();
  });
});

describe("validation", () => {
  it("normalizeEmail trims, lowercases and enforces shape/length", () => {
    expect(normalizeEmail("  A.B@Example.COM ")).toBe("a.b@example.com");
    for (const bad of [undefined, 1, "", "a@b", "a b@c.de", `${"a".repeat(320)}@b.co`]) {
      expect(() => normalizeEmail(bad)).toThrow(ValidationError);
    }
  });

  it("validatePassword enforces 8..128 with a letter and a digit, and never trims", () => {
    expect(validatePassword("abcdefg1")).toBe("abcdefg1");
    expect(validatePassword(" abcdef1 ")).toBe(" abcdef1 ");
    for (const bad of ["abcdef1", "abcdefgh", "12345678", "a1".repeat(65), null]) {
      expect(() => validatePassword(bad)).toThrow(ValidationError);
    }
  });

  it("validateGoogleIdToken bounds the token length", () => {
    expect(validateGoogleIdToken(" t ")).toBe("t");
    expect(() => validateGoogleIdToken("x".repeat(8193))).toThrow(ValidationError);
  });

  it("date of birth: exactly 13 today is allowed, one day younger is not", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    expect(validateDateOfBirth("2013-06-15")).toBe("2013-06-15");
    expect(() => validateDateOfBirth("2013-06-16")).toThrow(/at least 13/);
    expect(() => validateDateOfBirth("1906-06-14")).toThrow(/out of allowed range/);
  });

  it("profile name rules allow unicode letters, apostrophes, spaces and hyphens", () => {
    expect(validateProfileInput({ firstName: " Ayşe ", lastName: "O'Brien-Çelik", dateOfBirth: "1990-01-01" })).toEqual({
      firstName: "Ayşe",
      lastName: "O'Brien-Çelik",
      dateOfBirth: "1990-01-01",
    });
    expect(() => validateProfileUpdateInput({})).toThrow(/At least one/);
  });

  it("a profile update: absent fields are left alone, null clears, strings are validated, an empty string is still invalid", () => {
    expect(validateProfileUpdateInput({ firstName: "Ada" })).toEqual({ firstName: "Ada" });
    expect(validateProfileUpdateInput({ firstName: null, dateOfBirth: null })).toEqual({ firstName: null, dateOfBirth: null });
    expect(validateProfileUpdateInput({ lastName: null })).toEqual({ lastName: null });
    expect(() => validateProfileUpdateInput({ firstName: "" })).toThrow(/First name/);
    expect(() => validateProfileUpdateInput({ dateOfBirth: "nope" })).toThrow(/YYYY-MM-DD/);
    expect(() => validateProfileUpdateInput({ firstName: undefined })).toThrow(/At least one/);
  });

  it("toPublicUserProfile maps NULL name and date of birth to empty strings (the API shape for a Google user)", () => {
    const row = { id: "u", email: "g@x.io", first_name: null, last_name: null, date_of_birth: null, is_admin: false, is_verified: true, created_at: new Date("2026-01-01T00:00:00Z") };
    expect(toPublicUserProfile(row)).toMatchObject({ firstName: "", lastName: "", dateOfBirth: "" });
  });

  it("toPublicUserProfile never exposes the password hash", () => {
    const row = {
      id: "u",
      email: "e@x.io",
      first_name: null,
      last_name: null,
      date_of_birth: null,
      is_admin: false,
      is_verified: true,
      created_at: new Date("2026-01-01T00:00:00Z"),
      password_hash: "$2b$10$secret",
    };
    const out = toPublicUserProfile(row);
    expect(out).toEqual({ id: "u", email: "e@x.io", firstName: "", lastName: "", dateOfBirth: "", isAdmin: false, isVerified: true, createdAt: "2026-01-01T00:00:00.000Z", deletionScheduledFor: null });
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});

describe("tokens", () => {
  it("signToken/verifyToken round-trip and a unique jti per token", () => {
    const a = verifyToken(signToken({ sub: "u1", email: "e@x.io", tv: 0 }));
    const b = verifyToken(signToken({ sub: "u1", email: "e@x.io", tv: 3 }));
    expect(a).toMatchObject({ sub: "u1", email: "e@x.io", tv: 0 });
    expect(b.tv).toBe(3);
    expect(a.jti).not.toBe(b.jti);
  });

  it("extractBearerToken is case-insensitive on the scheme and strict on shape", () => {
    expect(extractBearerToken("bearer abc")).toBe("abc");
    expect(extractBearerToken("  Bearer   abc  ")).toBe("abc");
    expect([undefined, "", "Bearer", "Token abc"].map((h) => extractBearerToken(h))).toEqual([null, null, null, null]);
  });

  it("secure tokens: 43-char base64url raw, SHA-256 hex stored, constant-time compare", () => {
    const { rawToken, tokenHash } = generateSecureToken();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(hashToken(rawToken));
    expect(safeEqualHex(tokenHash, hashToken(rawToken))).toBe(true);
    expect(safeEqualHex(tokenHash, "00")).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
    expect(safeEqualHex("zz", "zz")).toBe(false);
  });

  it("hoursFromNow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(hoursFromNow(24).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("errorHandler mapping", () => {
  function appThrowing(err: unknown) {
    const app = express();
    app.get("/boom", () => {
      throw err;
    });
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
  }

  it("AppError → its status, code and details", async () => {
    const res = await request(appThrowing(new AppError(402, "Insufficient credits.", "INSUFFICIENT_CREDITS", { requiredCredits: 5 }))).get("/boom");
    expect(res.status).toBe(402);
    expect(res.body).toEqual({ success: false, error: "Insufficient credits.", code: "INSUFFICIENT_CREDITS", requiredCredits: 5 });
  });

  it("ValidationError → 400 VALIDATION_ERROR", async () => {
    const res = await request(appThrowing(new ValidationError("Email is required."))).get("/boom");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("raw Postgres P0001 → 402 INSUFFICIENT_CREDITS", async () => {
    const res = await request(appThrowing(Object.assign(new Error("insufficient credits for user x"), { code: "P0001" }))).get("/boom");
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("unknown errors → 500 with a generic body (no message/stack leak)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await request(appThrowing(new Error("password=hunter2 at /srv/app.ts:1"))).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Internal server error.", code: "INTERNAL_ERROR" });
  });

  // FINDING-20 (Low): ANY unhandled unique violation (not just registration) is turned into a
  // 200 { success:true, "account created" } response — a misleading success on unrelated routes.
  it("an unrelated unique violation is not reported as a successful account creation (FINDING-20)", async () => {
    const res = await request(appThrowing(Object.assign(new Error("duplicate key"), { code: "23505" }))).get("/boom");
    expect(res.body.success).not.toBe(true);
  });

  // PERF-29 / R18: "the database cannot serve this now" is a 503 with Retry-After, not a 500.
  const unavailable: Array<[string, unknown]> = [
    ["pool saturated / connect timeout (pg-pool)", new Error("timeout exceeded when trying to connect")],
    ["connect timeout (pg client)", new Error("Connection terminated due to connection timeout")],
    ["connection lost", new Error("Connection terminated unexpectedly")],
    ["refused while connecting", Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED", syscall: "connect" })],
    ["host not resolvable", Object.assign(new Error("getaddrinfo ENOTFOUND db"), { code: "ENOTFOUND", syscall: "getaddrinfo" })],
    ["57P03 cannot_connect_now (resuming compute)", Object.assign(new Error("the database system is starting up"), { code: "57P03", severity: "FATAL" })],
    ["53300 too_many_connections", Object.assign(new Error("sorry, too many clients already"), { code: "53300", severity: "FATAL" })],
    ["08006 connection_failure", Object.assign(new Error("connection failure"), { code: "08006", severity: "FATAL" })],
  ];
  it.each(unavailable)("%s → 503 DATABASE_UNAVAILABLE with Retry-After", async (_label, err) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await request(appThrowing(err)).get("/boom");
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.body).toEqual({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" });
  });

  const notUnavailable: Array<[string, unknown, number]> = [
    ["a socket reset outside connect (not from pg)", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" }), 500],
    ["a failed fetch to another service", Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }), 500],
    ["an errno-looking code without a pg severity", Object.assign(new Error("x"), { code: "57P03" }), 500],
    ["a query error (syntax)", Object.assign(new Error("syntax error"), { code: "42601", severity: "ERROR" }), 500],
    ["insufficient credits (P0001)", Object.assign(new Error("insufficient credits"), { code: "P0001", severity: "ERROR" }), 402],
    ["unique violation", Object.assign(new Error("duplicate key"), { code: "23505", severity: "ERROR" }), 409],
  ];
  it.each(notUnavailable)("%s keeps its status (%s)", async (_label, err, status) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await request(appThrowing(err)).get("/boom");
    expect(res.status).toBe(status);
    expect(res.headers["retry-after"]).toBeUndefined();
  });

  it("unknown routes → 404 JSON", async () => {
    const res = await request(appThrowing(new Error("x"))).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: "Route not found." });
  });
});

describe("background timers and the webhook store deadline (env)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["aiHoldSweepIntervalMs", "AI_HOLD_SWEEP_INTERVAL_MS", 300_000],
    ["webhookRetryIntervalMs", "WEBHOOK_RETRY_INTERVAL_MS", 60_000],
  ] as const)("%s: default when unset or invalid, 0 disables, an integer is taken as is", (getter, name, fallback) => {
    for (const [value, expected] of [
      ["", fallback],
      ["abc", fallback],
      ["-1", fallback],
      ["1.5", fallback],
      ["0", 0],
      ["15000", 15_000],
    ] as const) {
      vi.stubEnv(name, value);
      expect(env[getter]).toBe(expected);
    }
  });

  it("webhookStoreTimeoutMs: 3 s by default; only a positive integer overrides it (0 cannot remove the deadline)", () => {
    for (const [value, expected] of [
      ["", 3_000],
      ["0", 3_000],
      ["-5", 3_000],
      ["x", 3_000],
      ["1500", 1_500],
    ] as const) {
      vi.stubEnv("WEBHOOK_STORE_TIMEOUT_MS", value);
      expect(env.webhookStoreTimeoutMs).toBe(expected);
    }
  });

  it("isDatabaseUnavailableError: anything that is not an error object is not a database outage", () => {
    for (const value of [null, undefined, "timeout exceeded when trying to connect", 42]) {
      expect(isDatabaseUnavailableError(value)).toBe(false);
    }
  });
});

describe("database config parsing", () => {
  it("parses DATABASE_URL and validates scheme/name; composes from DB_* when absent", async () => {
    const mod = await import("../../src/config/database.js");
    const saved = { ...process.env };
    try {
      mod.resetDatabaseEnvCache();
      process.env.DATABASE_URL = "postgresql://u%40x:p%3Aw@db.local:6543/app_test";
      expect(mod.resolveDatabaseEnv()).toMatchObject({ host: "db.local", port: 6543, user: "u@x", password: "p:w", database: "app_test" });

      for (const bad of ["mysql://h/db", "postgresql://h", "not a url"]) {
        mod.resetDatabaseEnvCache();
        process.env.DATABASE_URL = bad;
        expect(() => mod.resolveDatabaseEnv()).toThrow();
      }

      mod.resetDatabaseEnvCache();
      delete process.env.DATABASE_URL;
      Object.assign(process.env, { DB_HOST: "h", DB_PORT: "5433", DB_USER: "us er", DB_PASSWORD: "p@ss", DB_NAME: "d_test" });
      expect(mod.resolveDatabaseEnv().connectionString).toBe("postgresql://us%20er:p%40ss@h:5433/d_test");

      mod.resetDatabaseEnvCache();
      delete process.env.DATABASE_URL;
      process.env.DB_PORT = "70000";
      expect(() => mod.resolveDatabaseEnv()).toThrow(/Invalid DB_PORT/);
    } finally {
      process.env = saved;
      mod.resetDatabaseEnvCache();
    }
  });
});
