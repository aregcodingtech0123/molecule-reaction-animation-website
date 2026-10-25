/** Upper bound for one model call (FINDING-21). `npm run check:config` compares it with the hold TTL. */
export const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;

export function geminiTimeoutMs(source: NodeJS.ProcessEnv = process.env): number {
  const v = Number(source.GEMINI_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GEMINI_TIMEOUT_MS;
}
