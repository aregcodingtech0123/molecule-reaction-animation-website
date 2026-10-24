export type UnauthorizedHandler = (options?: { sessionExpired?: boolean }) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Increments on every sign-in. A request remembers the epoch it started in; a 401 that belongs
 * to an older epoch (e.g. a guest-era balance probe answering after email verification signed the
 * user in) says nothing about the CURRENT session and must not sign the user out.
 */
let sessionEpoch = 0;

export function bumpSessionEpoch(): void {
  sessionEpoch += 1;
}

export function registerUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/**
 * Fetch wrapper that sends httpOnly session cookies and notifies auth on 401
 * — only for requests issued within the current session.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const startedIn = sessionEpoch;
  const res = await fetch(input, {
    ...init,
    credentials: init?.credentials ?? "include",
  });
  if (res.status === 401 && startedIn === sessionEpoch) {
    unauthorizedHandler?.({ sessionExpired: true });
  }
  return res;
}
