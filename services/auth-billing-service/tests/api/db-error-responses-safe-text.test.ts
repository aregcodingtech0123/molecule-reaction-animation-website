/**
 * Phase 2C step 4.1, finding F: no database text in any HTTP response, in any mode, including the development-only fields, which
 * keep their names and their use but now hold a fixed description. Real process, real server errors: a schema of its own shadows
 * NOW(), which is what the connection probe calls, so the probe fails with a marker in the message, DETAIL and HINT.
 */
import { randomBytes } from "node:crypto";
import type pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool, getPool, verifyDatabaseConnection } from "../../src/db/index.js";
import { spyConsole } from "../support/console";
import { createTestPool } from "../support/db";
import { DEVELOPMENT_VARS, PRODUCTION_VARS, startService, strongSecret } from "../support/service-process";

const TEXT_MARKER = "SENSITIVE-HTTP-MARKER-c14d";
const DB_NAME_MARKER = "dbnamemarker";
const QUERY_MARKER = "QUERYMARKER";
const PASSWORD_MARKER = "PASSWORDMARKER";
const MARKERS = [TEXT_MARKER, DB_NAME_MARKER, QUERY_MARKER, PASSWORD_MARKER];
const SCHEMA = `step41_probe_fault_${randomBytes(4).toString("hex")}`;

let db: pg.Pool;
beforeAll(async () => {
  db = createTestPool();
  await db.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(
    `CREATE FUNCTION ${SCHEMA}.now() RETURNS timestamptz LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${TEXT_MARKER} in message' USING ERRCODE = 'XX000', DETAIL = '${TEXT_MARKER} in detail', HINT = '${TEXT_MARKER} in hint'; END $$`,
  );
});
afterAll(async () => {
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await db.end();
});

function withQueryMarkers(url: URL): string {
  url.searchParams.set("application_name", QUERY_MARKER);
  url.searchParams.set("some_param", QUERY_MARKER);
  url.password = PASSWORD_MARKER; // The test server uses trust authentication: the password is accepted and ignored.
  return url.toString();
}
/** The probe reaches the server and the server raises the marked error. */
function urlWithFailingProbe(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${SCHEMA},pg_catalog,public`);
  return withQueryMarkers(url);
}
/** The server answers that the database does not exist, quoting its name. */
function urlWithMarkedDatabaseName(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${DB_NAME_MARKER}_absent_test`;
  return withQueryMarkers(url);
}

/** What the two affected routes answer while the database cannot be used. */
async function answers(vars: Record<string, string | undefined>, databaseUrl: string) {
  const svc = await startService({ ...vars, SETTLEMENT_CAPABILITY_SECRET: strongSecret(), DATABASE_URL: databaseUrl });
  try {
    const first = await svc.firstHealth();
    expect(first?.status, svc.output()).toBe(503);
    const health = await fetch(`${svc.url}/health`);
    const route = await fetch(`${svc.url}/api/billing/operation-costs`);
    const healthText = await health.text();
    const routeText = await route.text();
    return { healthStatus: health.status, routeStatus: route.status, healthText, routeText, health: JSON.parse(healthText) as Record<string, unknown>, route: JSON.parse(routeText) as Record<string, unknown> };
  } finally {
    await svc.stop();
  }
}

function expectNoMarkers(a: { healthText: string; routeText: string }) {
  for (const marker of MARKERS) {
    expect(a.healthText).not.toContain(marker);
    expect(a.routeText).not.toContain(marker);
  }
}

describe.each<[string, Record<string, string | undefined>]>([
  ["development", DEVELOPMENT_VARS],
  ["test", { ...DEVELOPMENT_VARS, NODE_ENV: "test" }],
  ["production", PRODUCTION_VARS],
  ["unset (production rules)", { ...PRODUCTION_VARS, NODE_ENV: undefined }],
])("NODE_ENV %s: no marker in any response body", (_label, vars) => {
  it("a server error in the probe: message, DETAIL, HINT, connection-string parameters", async () => {
    const a = await answers(vars, urlWithFailingProbe());
    expect(a.healthStatus).toBe(503);
    expect(a.routeStatus).toBe(503);
    expect(a.route).toMatchObject({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" });
    expect(a.health).toMatchObject({ success: false, status: "degraded", database: "unavailable" });
    expectNoMarkers(a);
  }, 60_000);

  it("a database that does not exist: its name", async () => {
    const a = await answers(vars, urlWithMarkedDatabaseName());
    expect(a.healthStatus).toBe(503);
    expect(a.routeStatus).toBe(503);
    expectNoMarkers(a);
  }, 60_000);
});

describe("development keeps its diagnosis, as fixed text", () => {
  it("a server error: the description and the SQLSTATE", async () => {
    const a = await answers(DEVELOPMENT_VARS, urlWithFailingProbe());
    expect(a.health.databaseError).toBe("Database error (SQLSTATE XX000)");
    expect(a.route).toEqual({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE", details: "Database error (SQLSTATE XX000)", pgCode: "XX000" });
  }, 60_000);

  it("a database that does not exist: the fixed hint telling the developer what to fix", async () => {
    const a = await answers(DEVELOPMENT_VARS, urlWithMarkedDatabaseName());
    const hint = "Database does not exist — create it or fix DB_NAME / DATABASE_URL path.";
    expect(a.health.databaseError).toBe(hint);
    expect(a.route).toMatchObject({ details: hint, pgCode: "3D000" });
  }, 60_000);

  it("nothing listening: the fixed hint and the code", async () => {
    const a = await answers(DEVELOPMENT_VARS, `postgresql://u:${PASSWORD_MARKER}@127.0.0.1:1/${DB_NAME_MARKER}_absent_test`);
    expect(a.health.databaseError).toBe("PostgreSQL is not running or not listening on the configured host:port.");
    expect(a.route).toMatchObject({ pgCode: "ECONNREFUSED" });
    expectNoMarkers(a);
  }, 60_000);

  it("the production classes do not have the development fields at all", async () => {
    const a = await answers(PRODUCTION_VARS, urlWithFailingProbe());
    expect(a.health).not.toHaveProperty("databaseError");
    expect(a.route).toEqual({ success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" });
  }, 60_000);
});

describe("the other way the state is set: the pool's idle-client listener", () => {
  const saved = process.env.NODE_ENV;
  const app = createApp();
  beforeEach(async () => {
    spyConsole();
    process.env.NODE_ENV = "development";
    expect(await verifyDatabaseConnection()).toBe(true);
  });
  afterEach(() => {
    process.env.NODE_ENV = saved;
  });
  afterAll(async () => {
    await closePool();
  });

  it("/health in development: the code in a fixed sentence, not the error's text, and it recovers", async () => {
    const event = Object.assign(new Error(`${TEXT_MARKER} message`), { code: "57P01", severity: "FATAL", detail: `${TEXT_MARKER} detail`, hint: `${TEXT_MARKER} hint`, where: TEXT_MARKER });
    getPool().emit("error", event, undefined as never);

    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.text).not.toContain(TEXT_MARKER);
    expect(res.body.databaseError).toBe("Database error (SQLSTATE 57P01)");

    expect(await verifyDatabaseConnection()).toBe(true);
    const after = await request(app).get("/health");
    expect(after.status).toBe(200);
    expect(after.body).not.toHaveProperty("databaseError");
  });
});
