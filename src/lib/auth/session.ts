/** httpOnly cookie name — must match middleware and set-cookie route. */
export const SESSION_TOKEN_COOKIE = "session_token";

export interface VerifiedSession {
  sub: string;
  email: string;
}
