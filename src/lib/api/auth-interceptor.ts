export type UnauthorizedHandler = (options?: { sessionExpired?: boolean }) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function registerUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/**
 * Fetch wrapper that sends httpOnly session cookies and notifies auth on 401.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    credentials: init?.credentials ?? "include",
  });
  if (res.status === 401) {
    unauthorizedHandler?.({ sessionExpired: true });
  }
  return res;
}
