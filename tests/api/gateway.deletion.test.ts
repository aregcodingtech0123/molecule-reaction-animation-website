/** The browser's path to /api/users/deletion: cookie -> Bearer, POST and DELETE pass through, a re-authentication failure stays 403. */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../../services/auth-billing-service/src/utils/password";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { createTestPool, createUser } from "../../services/auth-billing-service/tests/support/db";
import { callGateway, sessionCookie } from "../support/bff";
import { startAuthBillingService, type RunningService } from "../support/express-server";

let service: RunningService;
let db: pg.Pool;
beforeAll(async () => {
  service = await startAuthBillingService();
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await service.close();
});
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.env.AUTH_SERVICE_URL = `${service.origin}/api/auth`;
  process.env.BILLING_SERVICE_URL = `${service.origin}/api/billing`;
  process.env.USERS_SERVICE_URL = `${service.origin}/api/users`;
});

const PASSWORD = "Gateway-delete-1";
const request = (method: "POST" | "DELETE", body: unknown, cookie?: string) =>
  callGateway("users", "deletion", {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    ...(cookie ? { cookie } : {}),
  });

describe("/api/users/deletion through the gateway", () => {
  it("POST with the session cookie records the request; DELETE with a fresh session cancels it", async () => {
    const u = await createUser(db, { passwordHash: await hashPassword(PASSWORD) });
    const asked = await request("POST", { password: PASSWORD }, sessionCookie(tokenFor(u)));
    expect(asked.status).toBe(200);
    expect(asked.headers.get("cache-control")).toBe("no-store");
    const { rows } = await db.query(`SELECT deletion_requested_at, token_version FROM users WHERE id = $1`, [u.id]);
    expect(rows[0].deletion_requested_at).toBeInstanceOf(Date);

    // The request revoked the old session; a token for the new generation can cancel.
    expect((await request("DELETE", null, sessionCookie(tokenFor(u)))).status).toBe(401);
    const cancelled = await request("DELETE", null, sessionCookie(tokenFor(u, rows[0].token_version)));
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).data).toEqual({ cancelled: true });
  });

  it("no session → 401; a wrong password → 403 REAUTH_FAILED and nothing is recorded", async () => {
    const u = await createUser(db, { passwordHash: await hashPassword(PASSWORD) });
    expect((await request("POST", { password: PASSWORD })).status).toBe(401);
    const wrong = await request("POST", { password: "Not-the-password-1" }, sessionCookie(tokenFor(u)));
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).code).toBe("REAUTH_FAILED");
    expect((await db.query(`SELECT deletion_requested_at FROM users WHERE id = $1`, [u.id])).rows[0].deletion_requested_at).toBeNull();
  });
});
