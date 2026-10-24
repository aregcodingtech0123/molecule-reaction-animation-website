import { vi, type MockInstance } from "vitest";
import { waitFor } from "./db";

export interface ConsoleSpies {
  log: MockInstance;
  warn: MockInstance;
  error: MockInstance;
  /** Every console line (log/warn/error) flattened to text, in call order. */
  lines(): string[];
  waitForLine(fragment: string | RegExp, timeoutMs?: number): Promise<string>;
}

function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/** Silence and capture console output (the service is chatty by design). */
export function spyConsole(): ConsoleSpies {
  const order: string[] = [];
  const capture = (level: string) => (...args: unknown[]) => {
    order.push(`${level}: ${stringify(args)}`);
  };
  const log = vi.spyOn(console, "log").mockImplementation(capture("log"));
  const warn = vi.spyOn(console, "warn").mockImplementation(capture("warn"));
  const error = vi.spyOn(console, "error").mockImplementation(capture("error"));

  return {
    log,
    warn,
    error,
    lines: () => [...order],
    waitForLine: (fragment, timeoutMs = 5_000) =>
      waitFor(
        async () =>
          order.find((l) => (typeof fragment === "string" ? l.includes(fragment) : fragment.test(l))) ?? null,
        { timeoutMs },
      ),
  };
}
