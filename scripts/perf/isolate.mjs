/**
 * The only supported way to run an ad-hoc experiment (an "isolation run") outside the scenario runner:
 *
 *   node scripts/perf/isolate.mjs path/to/experiment.mjs [args…]
 *
 * Installs the network guard (every non-loopback host is blocked) and redirects Gemini REST calls to
 * PERF_GEMINI_ORIGIN when set, exactly like the server preload, verifies the guard, then imports the
 * experiment. A bare `node experiment.mjs` that uses createMockGemini() is refused by assertNetworkGuard.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installNetworkGuard } from "../test/network-guard.mjs";
import { geminiRedirect } from "./lib/gemini-redirect.mjs";
import { assertNetworkGuard } from "./lib/guard.mjs";

installNetworkGuard();
if (process.env.PERF_GEMINI_ORIGIN) globalThis.fetch = geminiRedirect(globalThis.fetch, process.env.PERF_GEMINI_ORIGIN);
assertNetworkGuard("an isolation run");

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error("Usage: node scripts/perf/isolate.mjs <experiment.mjs> [args…]");
  process.exit(64);
}
process.argv = [process.argv[0], path.resolve(script), ...rest];
await import(pathToFileURL(path.resolve(script)).href);
