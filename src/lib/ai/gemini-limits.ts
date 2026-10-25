/** Upper bound for one model call (FINDING-21). `npm run check:config` compares it with the hold TTL. */
export const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;
/** Upper bound for one answer (SEC-16): output tokens are the expensive side of a turn. */
export const DEFAULT_GEMINI_MAX_OUTPUT_TOKENS = 2048;
/** Total characters of conversation sent per turn (SEC-16); the oldest turns are dropped to fit. */
export const MAX_PROMPT_CHARS = 32_000;

export function geminiTimeoutMs(source: NodeJS.ProcessEnv = process.env): number {
  const v = Number(source.GEMINI_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GEMINI_TIMEOUT_MS;
}

export function geminiMaxOutputTokens(source: NodeJS.ProcessEnv = process.env): number {
  const v = Number(source.GEMINI_MAX_OUTPUT_TOKENS);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_GEMINI_MAX_OUTPUT_TOKENS;
}

/**
 * Newest turns that fit MAX_PROMPT_CHARS. The last message (the user's question, at most 8 000
 * characters) is always kept.
 */
export function boundConversation<T extends { role: string; content: string }>(messages: T[]): T[] {
  const kept: T[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const len = messages[i]!.content.length;
    if (kept.length > 0 && chars + len > MAX_PROMPT_CHARS) break;
    kept.unshift(messages[i]!);
    chars += len;
  }
  return kept;
}
