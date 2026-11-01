import { generateKeyPairSync, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { vi } from "vitest";
import { TEST_ENV } from "../setup/env";

/**
 * Real google-auth-library verification against a locally generated key.
 * Only the network fetch of Google's public certs is replaced, so signature,
 * audience, issuer and expiry checks are the library's own.
 */
const KID = "test-kid-1";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const { privateKey: attackerKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

export function stubGoogleCerts() {
  return vi
    .spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync")
    .mockResolvedValue({ certs: { [KID]: publicPem }, format: "PEM" } as never);
}

export interface GoogleClaims {
  sub?: string;
  email?: string | undefined;
  email_verified?: boolean;
  aud?: string;
  iss?: string;
  expiresInSec?: number;
  /** Issue the token this many seconds in the past (default 0 = just now). */
  issuedSecondsAgo?: number;
  signWithAttackerKey?: boolean;
}

export function googleIdToken(claims: GoogleClaims = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: claims.iss ?? "https://accounts.google.com",
    aud: claims.aud ?? TEST_ENV.GOOGLE_CLIENT_ID,
    sub: claims.sub ?? `g-${randomUUID()}`,
    email_verified: claims.email_verified ?? true,
    iat: now - (claims.issuedSecondsAgo ?? 0),
    exp: now + (claims.expiresInSec ?? 3600),
  };
  if (!("email" in claims) || claims.email !== undefined) {
    payload.email = claims.email ?? `google.${randomUUID().slice(0, 8)}@example.test`;
  }
  return jwt.sign(payload, claims.signWithAttackerKey ? attackerKey : privateKey, {
    algorithm: "RS256",
    keyid: KID,
  });
}
