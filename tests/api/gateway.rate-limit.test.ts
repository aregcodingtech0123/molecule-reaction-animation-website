/**
 * Own file on purpose: express-rate-limit keeps its counters in module state,
 * so this suite needs a fresh module graph (Vitest isolates files).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const registerFrom = (clientIp: string) =>
  callGateway("auth", "register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: JSON.stringify({ email: uniqueEmail("ip"), password: "Gateway-pass-1", firstName: "A", lastName: "B", dateOfBirth: "1990-01-01" }),
  });

describe("client IP propagation through the BFF (FINDING-04)", () => {
  // Phase 1 characterised the shared bucket (4th of four different users throttled); inverted now
  // that the BFF forwards the platform-supplied client IP (TEST_CHANGES TC-26).
  it("four DIFFERENT end users registering through the BFF each get their own bucket", async () => {
    const statuses = [];
    for (let i = 1; i <= 4; i++) statuses.push((await registerFrom(`203.0.113.${i}`)).status);
    expect(statuses).toEqual([200, 200, 200, 200]);
  });

  it("the SAME end user is still limited to 3 sign-ups per hour", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await registerFrom("203.0.113.99")).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("a client-forged X-Client-IP is never forwarded; only the platform header counts", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await callGateway("auth", "register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.150", "x-client-ip": `198.51.100.${i}` },
        body: JSON.stringify({ email: uniqueEmail("ip"), password: "Gateway-pass-1", firstName: "A", lastName: "B", dateOfBirth: "1990-01-01" }),
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("the right-most valid entry of the platform header is used (client-prepended entries are ignored)", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await registerFrom(`10.0.0.${i}, 203.0.113.200`)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
