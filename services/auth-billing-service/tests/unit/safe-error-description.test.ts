/**
 * safeErrorDescription: one line, safe to log, store or send, for any thrown value. Every word of it comes from this service or
 * from values shaped like identifiers, never from the error's own text.
 */
import { describe, expect, it } from "vitest";
import { safeErrorDescription } from "../../src/db/diagnostics.js";

const MARKER = "SENSITIVE-DESC-MARKER";

describe("safeErrorDescription", () => {
  it.each<[string, unknown, string]>([
    ["a server error", Object.assign(new Error(MARKER), { code: "XX000", severity: "ERROR", detail: MARKER, hint: MARKER }), "Database error (SQLSTATE XX000)"],
    ["a server error with a constraint", Object.assign(new Error(MARKER), { code: "23503", severity: "ERROR", constraint: "a_fkey", detail: MARKER }), "Database error (SQLSTATE 23503, constraint a_fkey)"],
    ["a known configuration mistake", Object.assign(new Error(MARKER), { code: "28P01", severity: "FATAL" }), "Invalid password — DB_PASSWORD / DATABASE_URL credentials rejected by PostgreSQL."],
    ["a socket error", Object.assign(new Error(MARKER), { code: "ECONNREFUSED", syscall: "connect" }), "PostgreSQL is not running or not listening on the configured host:port."],
    ["a saturated pool, with more text", new Error(`timeout exceeded when trying to connect ${MARKER}`), "timeout exceeded when trying to connect"],
    ["a connection timeout", new Error("Connection terminated due to connection timeout"), "Connection terminated due to connection timeout"],
    ["a dropped connection", new Error("Connection terminated unexpectedly"), "Connection terminated unexpectedly"],
    ["a programming error", new TypeError(MARKER), "Unexpected error (TypeError)"],
    ["a thrown string", MARKER, "Unexpected error (string)"],
    ["a thrown object", { message: MARKER }, "Unexpected error (object)"],
    ["null", null, "Unexpected error (object)"],
    ["undefined", undefined, "Unexpected error (undefined)"],
  ])("%s", (_label, err, expected) => {
    expect(safeErrorDescription(err)).toBe(expected);
  });

  it.each<[string, unknown]>([
    ["a code with free text", Object.assign(new Error(MARKER), { code: `${MARKER} free text`, severity: "ERROR" })],
    ["a constraint with free text", Object.assign(new Error(MARKER), { code: "23503", constraint: `${MARKER} (quoted) value` })],
    ["an error name with free text", Object.assign(new Error(MARKER), { name: `${MARKER} free text` })],
  ])("drops what is not shaped like an identifier: %s", (_label, err) => {
    expect(safeErrorDescription(err)).not.toContain(MARKER);
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])("a code named like an inherited property (%s) is not taken for a known one", (code) => {
    expect(safeErrorDescription(Object.assign(new Error(MARKER), { code }))).toBe(`Database error (SQLSTATE ${code})`);
  });
});
