/**
 * Request shapes the browser (through the BFF) and the BFF (to Express) really send.
 * Each virtual user gets its own client IP, as a platform proxy would forward it (CLIENT_IP_HEADER).
 */
import { WEB_ORIGIN } from "../config.mjs";

export const clientIp = (vu) => `10.${(vu >> 16) & 255}.${(vu >> 8) & 255}.${vu & 255}`;

/** Browser → Next: session cookie, same-origin fetch headers. */
export function browserRequest(token, vu, method, path, json) {
  const headers = {
    "x-forwarded-for": clientIp(vu),
    "sec-fetch-site": "same-origin",
    accept: "application/json",
  };
  if (token) headers.cookie = `session_token=${token}`;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    headers.origin = WEB_ORIGIN;
  }
  return { method, path, headers, body: json === undefined ? undefined : JSON.stringify(json) };
}

/** Direct to Express with a Bearer token (isolates the service from the BFF hop). */
export function apiRequest(token, method, path) {
  return { method, path, headers: { authorization: `Bearer ${token}`, accept: "application/json" } };
}

/**
 * Rotates virtual users over seeded users 1..N (0 is the hot user) so no user exceeds the BFF's
 * per-user chat limit (10 / min) or its daily cap; the result records the rotation.
 */
export function rotatingUser(userCount, concurrency) {
  const regular = userCount - 1;
  return ({ vu, iteration }) => 1 + ((iteration * concurrency + vu) % regular);
}
