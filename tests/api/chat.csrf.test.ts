/**
 * SEC-11: /api/chat spends credits, so it gets the same cross-site guard as every other state-changing
 * BFF route (FINDING-24 / gateway). It relied on SameSite=Strict alone; a cross-site request that does
 * carry the cookie (a SameSite bypass, an embedded browser, a misconfigured cookie) must still be
 * refused before any reservation or model call.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as chatPOST } from "@/app/api/chat/route";
import { createTestPool, createUser } from "../../services/auth-billing-service/tests/support/db";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { sessionCookie } from "../support/bff";
import { startAuthBillingService, type RunningService } from "../support/express-server";

let service: RunningService;
let db: pg.Pool;
let cookie: string;
let userId: string;
beforeAll(async () => {
  service = await startAuthBillingService();
  db = createTestPool();
  const user = await createUser(db, { balance: 5, verified: true });
  userId = user.id;
  cookie = sessionCookie(tokenFor(user));
});
afterAll(async () => {
  await db.end();
  await service.close();
});

const chat = (headers: Record<string, string>, body = "{not json") =>
  chatPOST(new Request("http://localhost:3000/api/chat", { method: "POST", headers: { "content-type": "application/json", cookie, ...headers }, body }));

const holds = async () =>
  (await db.query(`SELECT count(*)::int AS n FROM ai_credit_holds WHERE user_id = $1`, [userId])).rows[0].n as number;

describe("/api/chat cross-site guard (SEC-11)", () => {
  it.each([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["Origin: null", { origin: "null" }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
  ])("%s with a valid session → 403 CSRF_REJECTED, nothing reserved", async (_l, headers) => {
    const before = await holds();
    const res = await chat(headers, JSON.stringify({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CSRF_REJECTED");
    expect(await holds()).toBe(before);
  });

  it("same-origin and server-side callers pass the guard (then hit validation)", async () => {
    expect((await chat({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })).status).toBe(400);
    expect((await chat({})).status).toBe(400);
  });
});
