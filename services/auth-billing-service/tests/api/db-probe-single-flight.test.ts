/**
 * PERF-22: requests that find the database "not ready" share ONE reconnect probe (each probe replaces the
 * pool; before, every such request ran its own and they ended each other's pools). The outage is a local
 * black-hole TCP server that accepts connections and never answers — like a database that is still
 * resuming — so the pool's 2 s connect timeout really fires. The 503 mapping and that timeout must not
 * change; recovery must follow as soon as the database answers again; nothing may be left running.
 */
import net from "node:net";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { POOL_OPTIONS } from "../../src/config/database.js";
import { closePool, isDatabaseReady, verifyDatabaseConnection } from "../../src/db/index.js";
import { spyConsole, type ConsoleSpies } from "../support/console";

const app = createApp();
const realUrl = process.env.DATABASE_URL!;
let blackHole: net.Server;
let blackHoleUrl: string;
const openSockets = new Set<net.Socket>();
let consoleSpies: ConsoleSpies;

const probesStarted = () => consoleSpies.lines().filter((l) => l.includes("[db:config] ── environment inspection ──")).length;
const probesFailed = () => consoleSpies.lines().filter((l) => l.includes("Database connection failed")).length;
const probesSucceeded = () => consoleSpies.lines().filter((l) => l.includes("Database connection successfully established")).length;
const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

beforeAll(async () => {
  blackHole = net.createServer((socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  await new Promise<void>((r) => blackHole.listen(0, "127.0.0.1", () => r()));
  const url = new URL(realUrl);
  url.host = `127.0.0.1:${(blackHole.address() as net.AddressInfo).port}`;
  blackHoleUrl = url.toString();
});
afterAll(async () => {
  for (const s of openSockets) s.destroy();
  await new Promise<void>((r) => blackHole.close(() => r()));
  process.env.DATABASE_URL = realUrl;
  await closePool();
});
beforeEach(async () => {
  consoleSpies = spyConsole();
  // Start every test in the "database not ready" state, pointed at the outage, with no connection left over.
  await closePool();
  for (const s of openSockets) s.destroy();
  process.env.DATABASE_URL = blackHoleUrl;
});
afterEach(() => {
  process.env.DATABASE_URL = realUrl;
});

describe("single-flight reconnect probe", () => {
  it("20 concurrent requests during an outage share one probe; each answers 503 DATABASE_UNAVAILABLE after the 2 s connect timeout", async () => {
    expect(POOL_OPTIONS.connectionTimeoutMillis).toBe(2_000);
    const started = performance.now();
    const responses = await Promise.all(Array.from({ length: 20 }, () => request(app).get("/api/billing/balance")));
    const elapsed = performance.now() - started;

    for (const res of responses) {
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ success: false, code: "DATABASE_UNAVAILABLE" });
    }
    expect(probesStarted()).toBe(1);
    expect(probesFailed()).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(4_000);
    expect(isDatabaseReady()).toBe(false);
  }, 15_000);

  it("a request after a failed probe starts a new one (the shared probe is not kept once settled)", async () => {
    expect((await request(app).get("/api/billing/balance")).status).toBe(503);
    expect((await request(app).get("/api/billing/balance")).status).toBe(503);
    expect(probesStarted()).toBe(2);
  }, 15_000);

  it("recovers as soon as the database answers again; later requests do not probe", async () => {
    expect((await request(app).get("/api/billing/balance")).status).toBe(503);
    process.env.DATABASE_URL = realUrl;
    // Unauthenticated, so the route itself answers 401 — which proves requireDatabase let it through.
    const recovered = await Promise.all(Array.from({ length: 10 }, () => request(app).get("/api/billing/balance")));
    for (const res of recovered) expect(res.status).toBe(401);
    expect(isDatabaseReady()).toBe(true);
    expect(probesSucceeded()).toBe(1);
    expect((await request(app).get("/api/billing/balance")).status).toBe(401);
    expect(probesStarted()).toBe(2); // the failed one and the successful one — none after
  }, 15_000);

  it("one connection attempt per outage round, not per request; no timers left running", async () => {
    const before = timers();
    await Promise.all(Array.from({ length: 10 }, () => request(app).get("/api/billing/balance")));
    await new Promise((r) => setTimeout(r, 200));
    // pg leaves a timed-out connect attempt's socket open against a silent server (pre-existing, unchanged by
    // PERF-22); with the shared probe that is one socket for the round instead of one per request (10).
    expect(openSockets.size).toBe(1);
    expect(timers()).toBeLessThanOrEqual(before);
  }, 15_000);

  it("direct callers share the same probe too", async () => {
    const [a, b, c] = await Promise.all([verifyDatabaseConnection(), verifyDatabaseConnection(), verifyDatabaseConnection()]);
    expect([a, b, c]).toEqual([false, false, false]);
    expect(probesStarted()).toBe(1);
  }, 15_000);
});
