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
  it("characterisation: four DIFFERENT end users registering through the BFF — the 4th is throttled", async () => {
    const statuses = [];
    for (let i = 1; i <= 4; i++) statuses.push((await registerFrom(`203.0.113.${i}`)).status);
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});
