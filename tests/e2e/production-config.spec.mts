import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import net from "node:net";
import { expect, test } from "@playwright/test";
import { repoRoot, webEnv } from "../../scripts/test/e2e-env.mjs";
import { closeDb, plantVerificationToken, uniqueEmail } from "./support.mjs";

/**
 * SEC-08: what the browser actually receives, in the mode the stack runs in.
 * Default run = `next dev`; `E2E_NEXT_MODE=production` = `next build` + `next start`.
 */
const PRODUCTION = process.env.E2E_NEXT_MODE === "production";

test.afterAll(async () => {
  await closeDb();
});

test("session cookie flags: HttpOnly, SameSite=Strict, Path=/, Max-Age; Secure exactly in production", async ({ request }) => {
  const email = uniqueEmail("cookie");
  // Own client IP (the E2E BFF reads x-forwarded-for): the journeys share the 3-per-hour register bucket.
  const client = { "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}` };
  const reg = await request.post("/api/auth/register", {
    headers: client,
    data: { email, password: "E2e-pass-123", firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10" },
  });
  expect(reg.status()).toBe(200);
  const token = await plantVerificationToken(email);
  const verified = await request.post("/api/auth/verify-email", { headers: client, data: { token } });
  expect(verified.status()).toBe(200);
  expect(await verified.json()).not.toHaveProperty("data.token");

  const cookie = verified.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("session_token="))?.value;
  expect(cookie, "session cookie must be set by the BFF").toBeTruthy();
  const attrs = cookie!.split(";").map((p) => p.trim().toLowerCase());
  expect(attrs).toContain("httponly");
  expect(attrs).toContain("samesite=strict");
  expect(attrs).toContain("path=/");
  expect(attrs.some((a) => /^max-age=\d+$/.test(a) && Number(a.split("=")[1]) > 0)).toBe(true);
  expect(attrs.includes("secure")).toBe(PRODUCTION);
});

test("security headers are present on pages and on BFF API responses", async ({ request }) => {
  for (const path of ["/", "/api/billing/balance"]) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["content-security-policy"], path).toMatch(/default-src 'self'/);
  }
});

test("BFF error responses carry no stack traces or internal paths", async ({ request }) => {
  const res = await request.post("/api/chat", { headers: { "Content-Type": "application/json" }, data: "{not json" });
  const body = await res.text();
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(body).not.toMatch(/at \w+ \(|node_modules|webpack-internal|\.tsx?:\d+/);
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

test("a production server refuses to start without JWT_SECRET (real `next start`)", async () => {
  test.skip(!PRODUCTION, "needs the production build: run with E2E_NEXT_MODE=production");
  test.setTimeout(120_000);
  const port = await freePort();
  const env = { ...process.env, ...webEnv(), NODE_ENV: "production", JWT_SECRET: "" } as unknown as NodeJS.ProcessEnv;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));

  // Either the process exits, or (if it stayed up) it must not serve requests.
  const result = await Promise.race([exited, new Promise<"running">((r) => setTimeout(() => r("running"), 60_000))]);
  if (result === "running") {
    const res = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
    child.kill();
    await exited;
    expect(res?.status ?? 0, out).not.toBe(200);
  } else {
    expect(result, out).not.toBe(0);
  }
  expect(out).toMatch(/JWT_SECRET is not set/);
});
