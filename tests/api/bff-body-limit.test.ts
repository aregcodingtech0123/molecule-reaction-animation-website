/**
 * SEC-10: the BFF must not buffer unbounded request bodies. The gateway used to read the whole body
 * (`request.arrayBuffer()`) before forwarding it — Express rejects anything over 32 kb, but only after
 * the BFF has held all of it in memory — and /api/chat parsed any size with `request.json()`. Both are
 * reachable without a session (login, register, the chat route before auth).
 *
 * Bodies are counting streams, so the tests see how many bytes the BFF actually pulled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as chatPOST } from "@/app/api/chat/route";
import { proxyToService } from "@/lib/gateway";
import type pg from "pg";
import { createTestPool, createUser } from "../../services/auth-billing-service/tests/support/db";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { sessionCookie } from "../support/bff";
import { startAuthBillingService, startFakeUpstream, type RunningService } from "../support/express-server";

const MB = 1024 * 1024;
let upstream: RunningService;
let upstreamHits = 0;
let saved: string | undefined;
beforeAll(async () => {
  upstream = await startFakeUpstream((_req, body, res) => {
    upstreamHits += 1;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, received: body.length }));
  });
  saved = process.env.AUTH_SERVICE_URL;
  process.env.AUTH_SERVICE_URL = `${upstream.origin}/api/auth`;
});
afterAll(async () => {
  process.env.AUTH_SERVICE_URL = saved;
  await upstream.close();
});

/** A body of `totalBytes`, delivered in 64 kB chunks, that records how much was read. */
function countingBody(totalBytes: number) {
  const stats = { pulled: 0 };
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stats.pulled >= totalBytes) return controller.close();
      stats.pulled += chunk.length;
      controller.enqueue(chunk);
    },
  });
  return { stream, stats };
}

function post(url: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", body, headers: { "content-type": "application/json", ...headers }, duplex: "half" } as RequestInit);
}

describe("BFF request body limits (SEC-10)", () => {
  it("gateway: a declared Content-Length over the limit → 413 before reading, nothing forwarded", async () => {
    const { stream, stats } = countingBody(20 * MB);
    const before = upstreamHits;
    const res = await proxyToService({
      service: "auth",
      request: post("http://localhost:3000/api/auth/login", stream, { "content-length": String(20 * MB) }),
      pathSegments: ["login"],
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("PAYLOAD_TOO_LARGE");
    expect(stats.pulled).toBeLessThanOrEqual(64 * 1024);
    expect(upstreamHits).toBe(before);
  });

  it("gateway: a streamed body without Content-Length stops being read at the limit → 413, nothing forwarded", async () => {
    const { stream, stats } = countingBody(20 * MB);
    const before = upstreamHits;
    const res = await proxyToService({
      service: "auth",
      request: post("http://localhost:3000/api/auth/register", stream),
      pathSegments: ["register"],
    });
    expect(res.status).toBe(413);
    expect(stats.pulled).toBeLessThan(1 * MB);
    expect(upstreamHits).toBe(before);
  });

  it("gateway: a normal body is forwarded unchanged", async () => {
    const body = JSON.stringify({ email: "a@example.test", password: "Correct-horse-9" });
    const res = await proxyToService({ service: "auth", request: post("http://localhost:3000/api/auth/login", body), pathSegments: ["login"] });
    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(body.length);
  });
});

describe("/api/chat request body limit (SEC-10)", () => {
  let service: RunningService;
  let db: pg.Pool;
  let cookie: string;
  beforeAll(async () => {
    service = await startAuthBillingService();
    db = createTestPool();
    const user = await createUser(db, { balance: 5, verified: true });
    cookie = sessionCookie(tokenFor(user));
  });
  afterAll(async () => {
    await db.end();
    await service.close();
  });

  it("without a session the body is never read (401 first)", async () => {
    const { stream, stats } = countingBody(50 * MB);
    const res = await chatPOST(post("http://localhost:3000/api/chat", stream));
    expect(res.status).toBe(401);
    expect(stats.pulled).toBeLessThanOrEqual(64 * 1024);
  });

  it("a signed-in user's oversized body → 413, read only up to the limit, model never called", async () => {
    const { stream, stats } = countingBody(50 * MB);
    const res = await chatPOST(post("http://localhost:3000/api/chat", stream, { cookie }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("PAYLOAD_TOO_LARGE");
    expect(stats.pulled).toBeLessThan(2 * MB);
  });

  it("a signed-in user's declared Content-Length over the limit → 413 without reading", async () => {
    const { stream, stats } = countingBody(50 * MB);
    const res = await chatPOST(post("http://localhost:3000/api/chat", stream, { cookie, "content-length": String(50 * MB) }));
    expect(res.status).toBe(413);
    expect(stats.pulled).toBeLessThanOrEqual(64 * 1024);
  });
});
