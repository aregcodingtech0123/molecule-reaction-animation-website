import { it } from "vitest";

/**
 * An acceptance test for approved behaviour the code does not have yet.
 *
 * The body asserts the FUTURE behaviour, never the defect. `it.fails` reports it as passing while the
 * assertions fail, and turns the suite red as soon as they hold, so the phase that fixes the defect has to
 * replace `itKnownDefect` with `it`.
 *
 * `it.fails` is satisfied by any error, including a broken test. To see the real failure reasons:
 *   SHOW_KNOWN_DEFECTS=1 npx vitest run --project api tests/api/chat.settlement-after-logout.test.ts
 * Those runs are expected to be red.
 */
export const itKnownDefect = (process.env.SHOW_KNOWN_DEFECTS === "1" ? it : it.fails) as typeof it;
