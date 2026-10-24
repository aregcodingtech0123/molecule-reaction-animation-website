import { describe, expect, it, vi } from "vitest";
import { resolveClientIp } from "@/lib/gateway/client-ip";
import { warnMissingClientIpHeader } from "@/instrumentation";

const req = (headers: Record<string, string>) => new Request("http://localhost:3000/x", { headers });
const env = (vars: Record<string, string | undefined>) => vars as NodeJS.ProcessEnv;

describe("BFF client IP resolution (FINDING-04)", () => {
  it("is off unless CLIENT_IP_HEADER is configured (no header is trusted by default)", () => {
    expect(resolveClientIp(req({ "x-forwarded-for": "203.0.113.5" }), env({}))).toBeNull();
  });

  it.each([
    ["x-forwarded-for", { "x-forwarded-for": "203.0.113.5" }, "203.0.113.5"],
    ["x-forwarded-for", { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 203.0.113.5" }, "203.0.113.5"],
    ["x-forwarded-for", { "x-forwarded-for": "203.0.113.5, garbage" }, "203.0.113.5"],
    ["X-Real-IP", { "x-real-ip": "2001:db8::1" }, "2001:db8::1"],
    ["cf-connecting-ip", { "cf-connecting-ip": "198.51.100.7" }, "198.51.100.7"],
    ["x-forwarded-for", { "x-forwarded-for": "not-an-ip" }, null],
    ["x-real-ip", {}, null],
  ])("CLIENT_IP_HEADER=%s with %j → %s (right-most valid entry)", (header, headers, expected) => {
    expect(resolveClientIp(req(headers as Record<string, string>), env({ CLIENT_IP_HEADER: header }))).toBe(expected);
  });
});

describe("production startup warning when CLIENT_IP_HEADER is missing", () => {
  it("warns in production, never during next build or outside production, and not when set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnMissingClientIpHeader(env({ NODE_ENV: "production" }))).toBe(true);
    expect(warn.mock.calls[0]![0]).toMatch(/CLIENT_IP_HEADER is not set.*FINDING-04/);
    expect(warnMissingClientIpHeader(env({ NODE_ENV: "production", CLIENT_IP_HEADER: "x-real-ip" }))).toBe(false);
    expect(warnMissingClientIpHeader(env({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }))).toBe(false);
    expect(warnMissingClientIpHeader(env({ NODE_ENV: "development" }))).toBe(false);
  });
});
