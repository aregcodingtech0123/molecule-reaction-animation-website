/** The browser's path to POST /api/users/export: cookie -> Bearer, body and status pass through, nothing is cached. */
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

const PASSWORD = "Gateway-export-1";
const post = (body: unknown, cookie?: string) =>
  callGateway("users", "export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(cookie ? { cookie } : {}),
  });

describe("POST /api/users/export through the gateway", () => {
  it("the session cookie authenticates it; the data comes back with Cache-Control: no-store and no secrets", async () => {
    const hash = await hashPassword(PASSWORD);
    const u = await createUser(db, { passwordHash: hash });
    const res = await post({ password: PASSWORD }, sessionCookie(tokenFor(u)));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text).data.account).toMatchObject({ id: u.id, email: u.email });
    expect(text).not.toContain(hash);
    expect(text).not.toContain(PASSWORD);
  });

  it("no session cookie → 401; a wrong password → 403 REAUTH_FAILED (passed through unchanged)", async () => {
    const hash = await hashPassword(PASSWORD);
    const u = await createUser(db, { passwordHash: hash });
    expect((await post({ password: PASSWORD })).status).toBe(401);
    const wrong = await post({ password: "Not-the-password-1" }, sessionCookie(tokenFor(u)));
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).code).toBe("REAUTH_FAILED");
  });
});
