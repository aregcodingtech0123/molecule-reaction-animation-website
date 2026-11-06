import { it } from "vitest";

/**
 * The service-suite twin of tests/support/known-defect.ts (a test file must use the `vitest` its own project runs).
 *
 * The body asserts the FUTURE behaviour, never the defect. `it.fails` reports it as passing while the assertions
 * fail, and turns the suite red as soon as they hold, so the fixing phase must replace `itKnownDefect` with `it`.
 * `it.fails` is satisfied by any error, so set SHOW_KNOWN_DEFECTS=1 to see the real failure reasons (expected red).
 */
export const itKnownDefect = (process.env.SHOW_KNOWN_DEFECTS === "1" ? it : it.fails) as typeof it;
