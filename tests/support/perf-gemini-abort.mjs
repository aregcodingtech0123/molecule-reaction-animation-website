/**
 * Child process for tests/api/perf-harness.test.ts (run with --expose-gc and the perf preload):
 * a Gemini call through the harness redirect to a hanging mock must abort at its timeout even though a
 * full GC runs while it waits (PERF-21). Prints one JSON line: { name, ms }.
 */
import { GoogleGenAI } from "@google/genai";
import { createMockGemini } from "../../scripts/perf/mock-gemini.mjs";

const mock = createMockGemini();
mock.configure({ failureRate: 1, failureMode: "hang" });
await new Promise((r) => mock.server.listen(Number(process.env.MOCK_PORT), "127.0.0.1", () => r()));
const timer = setInterval(() => globalThis.gc(), 200);
const start = performance.now();
let name = "answered";
try {
  // Same shape as src/app/api/chat/route.ts: the timeout signal is created inline; only the SDK holds it.
  await new GoogleGenAI({ apiKey: "perf-test-key-not-real" }).models.generateContent({
    model: "m",
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    config: { abortSignal: AbortSignal.timeout(1500) },
  });
} catch (err) {
  name = err?.name ?? String(err);
}
clearInterval(timer);
console.log(JSON.stringify({ name, ms: Math.round(performance.now() - start) }));
await mock.close();
process.exit(0);
