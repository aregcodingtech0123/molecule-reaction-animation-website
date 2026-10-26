/**
 * Experiment stand-in for tests/api/perf-harness.test.ts: run through scripts/perf/isolate.mjs it may use
 * the in-process mock, and a request to the real Gemini host must still be blocked. Prints one JSON line.
 */
import { createMockGemini } from "../../scripts/perf/mock-gemini.mjs";

const out = {};
try {
  createMockGemini();
  out.mock = "ok";
} catch (err) {
  out.mock = String(err.message);
}
try {
  await fetch("https://generativelanguage.googleapis.com/v1beta/models/m:generateContent", { method: "POST", body: "{}" });
  out.external = "REACHED";
} catch (err) {
  out.external = err.name;
}
console.log(JSON.stringify(out));
