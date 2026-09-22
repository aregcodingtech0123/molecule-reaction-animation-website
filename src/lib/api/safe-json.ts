/**
 * Parse a `Response` body as JSON without crashing on non-JSON payloads.
 *
 * Calling `res.json()` directly throws a `SyntaxError` when the server returns
 * an HTML error page — a Next.js 404, a proxy 502, or a dev server that has not
 * registered the route yet. That SyntaxError masks the real HTTP status and
 * surfaces to the user as "Unexpected token '<'".
 *
 * This reads the body as text first and only then attempts JSON.parse, so a
 * caller's `if (!res.ok || !data.success)` guard always gets a chance to run.
 * Non-JSON bodies resolve to a `{ success: false, error }` shape carrying a
 * descriptive, actionable message instead of throwing.
 */
export interface SafeJsonFailure {
  success: false;
  error: string;
  /** HTTP status of the offending response, for callers that want to branch. */
  status: number;
  /** True when the body could not be parsed as JSON at all. */
  nonJson: true;
}

function describeNonJson(res: Response, body: string): string {
  const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(body);

  if (res.status === 404) {
    return looksLikeHtml
      ? `API route not found (HTTP 404). The server returned an HTML page instead of JSON. If the route exists, restart the Next.js dev server — it does not pick up .env changes or newly added routes automatically.`
      : `API route not found (HTTP 404).`;
  }

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return `Backend unavailable (HTTP ${res.status}). Check that the Express service on port 4000 is running.`;
  }

  if (looksLikeHtml) {
    return `Server returned an HTML page instead of JSON (HTTP ${res.status}).`;
  }

  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 120);
  return snippet
    ? `Server returned a non-JSON response (HTTP ${res.status}): ${snippet}`
    : `Server returned a non-JSON response (HTTP ${res.status}).`;
}

export async function safeJson<T>(res: Response): Promise<T> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return {
      success: false,
      status: res.status,
      nonJson: true,
      error: `Could not read the response body (HTTP ${res.status}).`,
    } satisfies SafeJsonFailure as T;
  }

  if (!text.trim()) {
    return {
      success: false,
      status: res.status,
      nonJson: true,
      error: res.ok
        ? "Server returned an empty response."
        : `Request failed with HTTP ${res.status} and an empty body.`,
    } satisfies SafeJsonFailure as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      success: false,
      status: res.status,
      nonJson: true,
      error: describeNonJson(res, text),
    } satisfies SafeJsonFailure as T;
  }
}
