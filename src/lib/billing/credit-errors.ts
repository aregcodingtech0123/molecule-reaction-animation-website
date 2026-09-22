export const INSUFFICIENT_CREDITS_CODE = "INSUFFICIENT_CREDITS";

export const INSUFFICIENT_CREDITS_MESSAGE =
  "You don't have enough credits for this operation. Please top up.";

/**
 * Thrown by any AI client call that the server rejected with 402.
 *
 * Carries the server's own numbers so the UI can say how many credits the
 * operation needed instead of guessing from a local price list that may drift.
 */
export class InsufficientCreditsError extends Error {
  readonly code = INSUFFICIENT_CREDITS_CODE;

  constructor(
    readonly requiredCredits: number | null = null,
    readonly balance: number | null = null,
  ) {
    super(INSUFFICIENT_CREDITS_MESSAGE);
    this.name = "InsufficientCreditsError";
  }
}

export function isInsufficientCreditsError(err: unknown): err is InsufficientCreditsError {
  return err instanceof InsufficientCreditsError;
}

/**
 * Recognise an out-of-credits rejection from a fetch response.
 *
 * Matches on the 402 status first, then falls back to the error code in the
 * body — some routes surface the condition through a proxy that rewrites the
 * status, and older handlers only ever sent `{ error: "INSUFFICIENT_CREDITS" }`.
 */
export function isInsufficientCreditsResponse(status: number, body: unknown): boolean {
  if (status === 402) return true;
  if (!body || typeof body !== "object") return false;
  const b = body as { code?: unknown; error?: unknown };
  return b.code === INSUFFICIENT_CREDITS_CODE || b.error === INSUFFICIENT_CREDITS_CODE;
}

/** Build the error from a parsed 402 body, tolerating missing fields. */
export function insufficientCreditsFromBody(body: unknown): InsufficientCreditsError {
  const b = (body ?? {}) as { requiredCredits?: unknown; balance?: unknown };
  return new InsufficientCreditsError(
    typeof b.requiredCredits === "number" ? b.requiredCredits : null,
    typeof b.balance === "number" ? b.balance : null,
  );
}

/** Message for the billing modal — names the shortfall when the server sent it. */
export function creditShortfallMessage(err: InsufficientCreditsError): string {
  if (err.requiredCredits === null) return INSUFFICIENT_CREDITS_MESSAGE;
  const unit = err.requiredCredits === 1 ? "credit" : "credits";
  const have = err.balance === null ? "" : ` You have ${err.balance}.`;
  return `This operation needs ${err.requiredCredits} ${unit}.${have} Please top up.`;
}
