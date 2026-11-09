import { inspect } from "node:util";
import pg from "pg";
import { vi } from "vitest";
import type { ConsoleSpies } from "./console";

/**
 * Real PostgreSQL errors with a marker in their free text, and a check of what reached the console. Output is checked with
 * util.inspect over the raw console arguments: JSON.stringify drops an Error's message and stack.
 */

/** A statement that makes the server raise `sqlState`, with the marker in its message, DETAIL and HINT. */
export const markedRaise = (marker: string, sqlState = "XX000", messagePrefix = "") =>
  `DO $$ BEGIN RAISE EXCEPTION '${messagePrefix}${marker} in message' USING ERRCODE = '${sqlState}', DETAIL = '${marker} in detail', HINT = '${marker} in hint'; END $$`;

/** Pool queries matching `pattern` are replaced by a statement that makes the server raise the marked error. */
export function raiseOnPoolQuery(pattern: RegExp, marker: string, sqlState = "XX000") {
  const real = pg.Pool.prototype.query;
  return vi.spyOn(pg.Pool.prototype, "query").mockImplementation(function (this: pg.Pool, ...args: unknown[]) {
    const sql = typeof args[0] === "string" ? args[0] : "";
    const sent = pattern.test(sql) ? [markedRaise(marker, sqlState)] : args;
    return (real as (...a: unknown[]) => unknown).apply(this, sent) as never;
  });
}

/** Pool queries matching `pattern` reject with `makeError()`, without reaching the server. */
export function rejectPoolQuery(pattern: RegExp, makeError: () => unknown) {
  const real = pg.Pool.prototype.query;
  return vi.spyOn(pg.Pool.prototype, "query").mockImplementation(function (this: pg.Pool, ...args: unknown[]) {
    const sql = typeof args[0] === "string" ? args[0] : "";
    if (pattern.test(sql)) return Promise.reject(makeError()) as never;
    return (real as (...a: unknown[]) => unknown).apply(this, args) as never;
  });
}

/** Everything that reached the console, with Error objects shown in full (message, stack and every property). */
export const everythingLogged = (logs: ConsoleSpies) =>
  inspect([logs.log.mock.calls, logs.warn.mock.calls, logs.error.mock.calls], { depth: 10, breakLength: Infinity, maxStringLength: null, maxArrayLength: null });

/** The structured payload of the first console call whose text includes `label`. */
export function payloadOf(logs: ConsoleSpies, label: string): Record<string, unknown> {
  const call = [...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].find((args) => typeof args[0] === "string" && args[0].includes(label));
  if (!call) throw new Error(`no log line with "${label}"`);
  return call[1] as Record<string, unknown>;
}
