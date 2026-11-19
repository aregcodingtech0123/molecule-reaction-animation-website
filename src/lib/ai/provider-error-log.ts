/**
 * Log-safe description of a model-provider failure (Step 7.4, E.17).
 *
 * A provider error can carry the provider's message, a stack trace, the request that was sent (the user's prompt) and the
 * response body, and its serialisation can include any of them. None of that may reach the logs. This helper therefore
 * never forwards the error, its message, its stack or any property of it: it builds a NEW object from two explicitly
 * approved facts and nothing else.
 *
 *  - `errorName`: the error's `name`, only if it is one of KNOWN_ERROR_NAMES; anything else is reported as "other". A free
 *    `name` is not trusted, because a provider (or a wrapper) can put arbitrary text there.
 *  - `status`: the HTTP status the provider answered with, only if it is an integer from 100 to 599.
 */
const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ApiError",
  "ClientError",
  "ServerError",
  "Error",
  "TypeError",
  "SyntaxError",
  "RangeError",
  "FetchError",
]);

export interface ProviderErrorLogFields {
  errorName: string;
  status?: number;
}

export function providerErrorLogFields(err: unknown): ProviderErrorLogFields {
  if (err === null || typeof err !== "object") return { errorName: "non_object" };

  const record = err as { name?: unknown; status?: unknown };
  const errorName = typeof record.name === "string" && KNOWN_ERROR_NAMES.has(record.name) ? record.name : "other";
  const status = record.status;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? { errorName, status } : { errorName };
}
