/**
 * The allowlist behind every database error log: only these fields, and only values shaped like what they claim to be.
 * Pure: no database. The real paths are in tests/api/db-error-logging.test.ts.
 */
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { logDbError, safeDbErrorFields, safeStackFrames } from "../../src/db/diagnostics.js";
import { databaseUnavailableReason } from "../../src/db/unavailable.js";

const MARKER = "SENSITIVE-DB-MARKER";

describe("safeDbErrorFields", () => {
  it("keeps the allowlisted identifiers of a database error", () => {
    expect(safeDbErrorFields({ code: "23503", severity: "ERROR", constraint: "a_fkey", routine: "RI_FKey_check", message: MARKER, detail: MARKER })).toEqual({
      sqlstate: "23503",
      severity: "ERROR",
      constraint: "a_fkey",
      routine: "RI_FKey_check",
    });
  });

  it.each([
    ["free text in code", { code: `${MARKER} with spaces` }],
    ["free text in constraint", { constraint: "a value (quoted) here" }],
    ["a newline", { routine: "x\ny" }],
    ["a very long value", { code: "A".repeat(200) }],
    ["a number", { code: 40001 }],
    ["an object", { severity: { toString: () => MARKER } }],
  ])("drops a value not shaped like an identifier: %s", (_label, err) => {
    const fields = safeDbErrorFields(err);
    expect(Object.values(fields).every((v) => v === null)).toBe(true);
  });

  it.each([[null], [undefined], ["text"], [7]])("survives %j", (err) => {
    expect(safeDbErrorFields(err)).toEqual({ sqlstate: null, severity: null, constraint: null, routine: null });
  });
});

describe("safeStackFrames", () => {
  it("returns the frames only, without the name and message at the top", () => {
    const err = new Error(MARKER);
    const frames = safeStackFrames(err)!;
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.join("\n")).not.toContain(MARKER);
    expect(frames.every((f) => f.startsWith("at "))).toBe(true);
  });

  it("a message that spans lines or imitates a frame is removed with the header", () => {
    const frames = safeStackFrames(new TypeError(`line one ${MARKER}\n    at ${MARKER} (fake.ts:1:1)\nline three ${MARKER}`))!;
    expect(frames.join("\n")).not.toContain(MARKER);
    expect(frames.length).toBeGreaterThan(0);
  });

  it("a stack whose header no longer matches the message gives no frames rather than risk it", () => {
    const err = new Error("original");
    err.message = `changed ${MARKER}`;
    err.stack = `Error: earlier ${MARKER}\n    at ${MARKER} (fake.ts:1:1)`;
    expect(safeStackFrames(err)).toBeUndefined();
  });

  it("a database error has no useful frames, and a non-Error has none at all", () => {
    expect(safeStackFrames(Object.assign(new Error(MARKER), { severity: "ERROR" }))).toBeUndefined();
    expect(safeStackFrames(MARKER)).toBeUndefined();
    expect(safeStackFrames(null)).toBeUndefined();
  });
});

describe("logDbError", () => {
  it("logs the fields and the operator's hint, keeps the message for the caller's return value, and logs none of it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = Object.assign(new Error(`${MARKER} message`), { code: "28P01", severity: "FATAL", detail: `${MARKER} detail`, hint: `${MARKER} hint`, where: `${MARKER} where` });

    const parsed = logDbError("some context", err);

    expect(parsed.message).toBe(`${MARKER} message`);
    const logged = inspect(error.mock.calls, { depth: 10, maxStringLength: null });
    expect(logged).not.toContain(MARKER);
    expect(error.mock.calls[0]).toEqual(["DB ERROR [some context]", expect.objectContaining({ sqlstate: "28P01", severity: "FATAL", errorName: "Error" })]);
    expect(logged).toContain("Invalid password");
  });
});

describe("databaseUnavailableReason", () => {
  it.each<[string, unknown, string | null]>([
    ["a saturated pool", new Error("timeout exceeded when trying to connect"), "pool_connect_timeout"],
    ["a slow connect", new Error("Connection terminated due to connection timeout"), "connection_timeout"],
    ["a dropped connection", new Error("Connection terminated unexpectedly"), "connection_terminated"],
    ["a server refusal", Object.assign(new Error(MARKER), { code: "57P03", severity: "FATAL" }), "server_unavailable"],
    ["a socket error", Object.assign(new Error(MARKER), { code: "ECONNREFUSED", syscall: "connect" }), "connect_socket_error"],
    ["anything else", new Error(MARKER), null],
    ["not an error", MARKER, null],
  ])("%s", (_label, err, reason) => {
    expect(databaseUnavailableReason(err)).toBe(reason);
  });
});
