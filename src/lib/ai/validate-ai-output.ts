const INJECTION_PATTERNS = [
  /ignore (all |previous |above )?instructions/i,
  /you are now (a |an )?/i,
  /system prompt/i,
  /\[INST\]|\[\/INST\]/,
];

export function validateAiOutput(text: string): { safe: boolean; reason?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: "policy_violation" };
    }
  }
  return { safe: true };
}

// SECURITY-TODO: Replace regex heuristics with Gemini safety settings and a
// dedicated moderation API pass before production scale.
