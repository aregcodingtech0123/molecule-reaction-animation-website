/**
 * Standing rule: nothing in the performance harness may run without the network guard
 * (scripts/test/network-guard.mjs). Part 1 had one isolation run that skipped it and sent a request to the
 * real Gemini endpoint (PERFORMANCE_FINDINGS § incident). These checks make that impossible to repeat by
 * accident:
 *  - `assertNetworkGuard(where)` — throws unless the guard is installed in THIS process. Called by the
 *    runner, by `createMockGemini()` and by `scripts/perf/isolate.mjs` before any experiment code runs.
 *  - `assertServerGuarded(logText, name)` — the perf preload prints GUARD_MARKER when it installs the
 *    guard in a server; the stack refuses to measure a server whose log does not show it.
 */
import { isNetworkGuardInstalled } from "../../test/network-guard.mjs";

export const GUARD_MARKER = "[perf-preload] network guard active";

export function assertNetworkGuard(where) {
  if (!isNetworkGuardInstalled()) {
    throw new Error(
      `[perf] refusing to run ${where} without the network guard. Use node scripts/perf/run.mjs <scenario> ` +
        "or node scripts/perf/isolate.mjs <script.mjs> (both install it), never a bare `node script.mjs`.",
    );
  }
}

export function assertServerGuarded(logText, name) {
  if (!logText.includes(GUARD_MARKER)) {
    throw new Error(`[perf] refusing to measure: the ${name} server started without the network guard (no "${GUARD_MARKER}" in its log)`);
  }
}
