/** Separate file → fresh rate-limiter state (see gateway.rate-limit.test.ts). */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { uniqueEmail } from "../../services/auth-billing-service/tests/support/db";
import { callGateway } from "../support/bff";
import { startAuthBillingService, type RunningService } from "../support/express-server";

let service: RunningService;
beforeAll(async () => {
  service = await startAuthBillingService();
});
afterAll(async () => {
  await service.close();
});
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

// FINDING-04 (High): the gateway forwards neither the client IP nor X-Forwarded-For, so behind the
// BFF every user shares ONE rate-limit bucket keyed on the Next server's address: 3 sign-ups per
// hour site-wide, 20 verify/reset per hour site-wide, 10 Google sign-ins per 15 min site-wide.
it.fails("rate limits are applied per end-user client IP behind the BFF (FINDING-04)", async () => {
  const statuses = [];
  for (let i = 1; i <= 4; i++) {
    const res = await callGateway("auth", "register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${i}` },
      body: JSON.stringify({ email: uniqueEmail("ip"), password: "Gateway-pass-1", firstName: "A", lastName: "B", dateOfBirth: "1990-01-01" }),
    });
    statuses.push(res.status);
  }
  expect(statuses).toEqual([201, 201, 201, 201]);
});
