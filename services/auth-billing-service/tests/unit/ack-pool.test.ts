/**
 * Delivery-attempt pool (ACK_DATABASE_URL) — Phase 2C, migration 021 compatibility. DATABASE-FREE: `pg` is replaced by an
 * in-memory fake, so no socket is ever opened. These tests prove the application-side rules only; that PostgreSQL really refuses
 * the app role and accepts the ack role is a separate, separately authorised real-login check (D1/D2 decision O-12).
 *
 * Covered: configuration (no fallback, no secret in diagnostics), run-time identity (current_user AND session_user), single-flight
 * readiness, the acknowledgement path (ack pool only, unchanged SQL, idempotency), tracked reservations failing closed before any
 * reservation work, and shutdown of both pools.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Result = { rows: Row[]; rowCount: number };
type Handler = (sql: string, params?: unknown[]) => Result | Promise<Result>;

const h = vi.hoisted(() => {
  const state = {
    pools: [] as FakePool[],
    /** Answers `pool.query` (the readiness probe), per connection string. */
    poolQuery: new Map<string, Handler>(),
    /** Answers queries on checked-out clients, per connection string. */
    clientQuery: new Map<string, Handler>(),
    endError: new Map<string, Error>(),
  };

  class FakeClient {
    readonly sql: string[] = [];
    released = false;
    constructor(private readonly owner: FakePool) {}
    async query(sql: string, params?: unknown[]) {
      this.sql.push(sql);
      const handler = state.clientQuery.get(this.owner.connectionString);
      if (!handler) throw new Error("no client handler for this pool");
      return handler(sql, params);
    }
    on() {
      return this;
    }
    removeListener() {
      return this;
    }
    release() {
      this.released = true;
    }
  }

  class FakePool {
    readonly connectionString: string;
    readonly options: Record<string, unknown>;
    readonly probeSql: string[] = [];
    readonly clients: FakeClient[] = [];
    endCalls = 0;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.connectionString = String(options.connectionString);
      state.pools.push(this);
    }
    on() {
      return this;
    }
    async query(sql: string, params?: unknown[]) {
      this.probeSql.push(sql);
      const handler = state.poolQuery.get(this.connectionString);
      if (!handler) throw new Error("no pool handler for this pool");
      return handler(sql, params);
    }
    async connect() {
      const client = new FakeClient(this);
      this.clients.push(client);
      return client;
    }
    async end() {
      this.endCalls += 1;
      const err = state.endError.get(this.connectionString);
      if (err) throw err;
    }
  }

  return { state, FakePool };
});

vi.mock("pg", () => {
  const pg = { Pool: h.FakePool, types: { setTypeParser: () => undefined, builtins: { DATE: 1082 } } };
  return { default: pg, ...pg };
});

const SECRET = "s3cr3t-ack-pw";
/** Same database name as the unit project's (never connected) main DATABASE_URL, as the same-database rule requires. */
const ACK_DB = "moleculestudio_unit_unused_test";
const ACK_URL = `postgresql://moleculestudio_ack:${SECRET}@127.0.0.1:59999/${ACK_DB}`;
const ACK = "moleculestudio_ack";
const IDENTITY_SQL = "SELECT current_user, session_user";
const identity = (current_user: string, session_user: string): Result => ({ rows: [{ current_user, session_user }], rowCount: 1 });
const ok = (rows: Row[] = [], rowCount = rows.length): Result => ({ rows, rowCount });
const grants = (granted: boolean): Result => ({ rows: [{ ok: granted }], rowCount: 1 });
/** Readiness answers: the identity query gets `id`, the S6 grant check gets `granted`. */
const probeAnswers = (id: Result | (() => Result | Promise<Result>), granted = true): Handler => (sql) =>
  sql === IDENTITY_SQL ? (typeof id === "function" ? id() : id) : grants(granted);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
/** Source with comments removed, so a static check looks at code only. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every console line written during a test, for "no secret in any log" checks. */
let logged: string[] = [];
let originalDatabaseUrl: string | undefined;

beforeEach(() => {
  vi.resetModules();
  h.state.pools.length = 0;
  h.state.poolQuery.clear();
  h.state.clientQuery.clear();
  h.state.endError.clear();
  logged = [];
  for (const level of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.ACK_DATABASE_URL;
});

afterEach(() => {
  delete process.env.ACK_DATABASE_URL;
  process.env.DATABASE_URL = originalDatabaseUrl;
  expect(logged.join("\n")).not.toContain(SECRET);
});

const mainUrl = () => String(process.env.DATABASE_URL);
const ackPools = () => h.state.pools.filter((p) => p.connectionString === ACK_URL);
const mainPools = () => h.state.pools.filter((p) => p.connectionString === mainUrl());

async function loadAckPool() {
  return import("../../src/db/ackPool.js");
}

function ackReadyAnswers() {
  process.env.ACK_DATABASE_URL = ACK_URL;
  h.state.poolQuery.set(ACK_URL, probeAnswers(identity(ACK, ACK)));
}

// ---------------------------------------------------------------------------------------------------------------------------
describe("configuration: ACK_DATABASE_URL only, no fallback, no secret in diagnostics", () => {
  const main = () => ({ user: "postgres", database: ACK_DB });

  it("missing (unset, empty or blank) is refused", async () => {
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    for (const value of [undefined, "", "   "]) {
      expect(resolveAckDatabaseConfig({ ACK_DATABASE_URL: value }, main)).toEqual({ ok: false, problem: "missing" });
    }
  });

  it("never falls back to DATABASE_URL or the DB_* variables", async () => {
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    const source = { DATABASE_URL: ACK_URL, DB_USER: ACK, DB_PASSWORD: SECRET, DB_NAME: "x", DB_HOST: "127.0.0.1" };
    expect(resolveAckDatabaseConfig(source, main)).toEqual({ ok: false, problem: "missing" });
  });

  it("invalid URL, wrong scheme, no user and no database are each refused with a code", async () => {
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    const cases: Array<[string, string]> = [
      ["not a url", "invalid_url"],
      [`postgresql://%E0%A4%A:${SECRET}@127.0.0.1/db`, "invalid_url"],
      [`mysql://${ACK}:${SECRET}@127.0.0.1/db`, "unsupported_scheme"],
      [`postgresql://127.0.0.1:5432/db`, "missing_user"],
      [`postgresql://${ACK}:${SECRET}@127.0.0.1:5432/`, "missing_database"],
    ];
    for (const [url, problem] of cases) {
      const result = resolveAckDatabaseConfig({ ACK_DATABASE_URL: url }, main);
      expect(result).toEqual({ ok: false, problem });
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });

  it("the same user as the main pool is refused (static check; the run-time identity check is separate)", async () => {
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    expect(resolveAckDatabaseConfig({ ACK_DATABASE_URL: ACK_URL }, () => ({ user: ACK, database: ACK_DB }))).toEqual({ ok: false, problem: "same_user_as_main" });
  });

  it("query parameters that could override the user, password, host, database or options are refused (review L6)", async () => {
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    for (const q of ["user=postgres", "password=x", "options=-c%20role%3Dpostgres", "host=10.0.0.1", "dbname=other", "port=1"]) {
      expect(resolveAckDatabaseConfig({ ACK_DATABASE_URL: `${ACK_URL}?${q}` }, main)).toEqual({ ok: false, problem: "unsupported_parameter" });
    }
    expect(resolveAckDatabaseConfig({ ACK_DATABASE_URL: `${ACK_URL}?sslmode=disable&application_name=ack` }, main).ok).toBe(true);
  });

  it("a different database than the main pool's is refused (review L7)", async () => {
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    expect(resolveAckDatabaseConfig({ ACK_DATABASE_URL: ACK_URL }, () => ({ user: "postgres", database: "other_db" }))).toEqual({ ok: false, problem: "different_database" });
  });

  it("the comparison uses the main pool's real configuration (DATABASE_URL user)", async () => {
    process.env.DATABASE_URL = `postgresql://${ACK}:other@127.0.0.1:59998/main_unused_test`;
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    expect(resolveAckDatabaseConfig({ ACK_DATABASE_URL: ACK_URL })).toEqual({ ok: false, problem: "same_user_as_main" });
  });

  it("an unresolvable main configuration fails closed", async () => {
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    expect(resolveAckDatabaseConfig({ ACK_DATABASE_URL: ACK_URL }, () => null)).toEqual({ ok: false, problem: "main_config_unavailable" });
  });

  it("a valid, distinct configuration is accepted", async () => {
    const { resolveAckDatabaseConfig } = await import("../../src/config/ackDatabase.js");
    expect(resolveAckDatabaseConfig({ ACK_DATABASE_URL: ` ${ACK_URL} ` }, main)).toEqual({
      ok: true,
      config: { connectionString: ACK_URL, user: ACK },
    });
  });

  it("problem descriptions are fixed text and the startup status carries no connection detail", async () => {
    const { describeAckConfigProblem } = await import("../../src/config/ackDatabase.js");
    for (const p of ["missing", "invalid_url", "unsupported_scheme", "missing_user", "missing_database", "unsupported_parameter", "main_config_unavailable", "same_user_as_main", "different_database"] as const) {
      // Fixed text: no user/host part, no secret, and the same whatever URL was configured.
      expect(describeAckConfigProblem(p)).not.toMatch(/@|127\.0\.0\.1|moleculestudio_ack:/);
      expect(describeAckConfigProblem(p)).not.toContain(SECRET);
    }
    process.env.ACK_DATABASE_URL = ACK_URL;
    const { ackDatabaseStatus } = await loadAckPool();
    const status = ackDatabaseStatus();
    expect(status).toEqual({ configured: true, problem: null, ready: false, lastReason: null });
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(h.state.pools).toHaveLength(0); // status makes no connection
  });

  it("source: the resolver reads ACK_DATABASE_URL only (static)", () => {
    const src = code("src/config/ackDatabase.ts");
    expect(src).toContain("source.ACK_DATABASE_URL");
    expect(src).not.toMatch(/source\.DATABASE_URL|process\.env\.DATABASE_URL|source\.DB_|process\.env\.DB_/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe("run-time identity: current_user AND session_user must both be moleculestudio_ack", () => {
  it("both equal: ready, one pool, built from ACK_DATABASE_URL only", async () => {
    ackReadyAnswers();
    const { ensureAckDatabaseReady } = await loadAckPool();
    await expect(ensureAckDatabaseReady()).resolves.toEqual({ ready: true });
    expect(ackPools()).toHaveLength(1);
    expect(ackPools()[0]!.probeSql[0]).toBe(IDENTITY_SQL);
    expect(ackPools()[0]!.probeSql[1]).toContain("has_column_privilege");
    expect(ackPools()[0]!.probeSql).toHaveLength(2);
    expect(mainPools()).toHaveLength(0);
  });

  const mismatches: Array<[string, Result]> = [
    ["current_user differs", identity("moleculestudio_app", ACK)],
    ["session_user differs", identity(ACK, "moleculestudio_app")],
    ["both differ", identity("postgres", "postgres")],
    ["no row", ok([])],
  ];
  for (const [name, answer] of mismatches) {
    it(`${name}: not ready, the pool is discarded, a safe diagnostic is logged`, async () => {
      process.env.ACK_DATABASE_URL = ACK_URL;
      h.state.poolQuery.set(ACK_URL, () => answer);
      const { ensureAckDatabaseReady } = await loadAckPool();
      await expect(ensureAckDatabaseReady()).resolves.toEqual({ ready: false, reason: "identity_mismatch" });
      expect(ackPools()[0]!.endCalls).toBe(1);
      expect(mainPools()).toHaveLength(0);
      expect(logged.join("\n")).toContain("ACK_IDENTITY_MISMATCH");
    });
  }

  it("identity query failure: not ready, pool discarded, no secret logged even if the error text contains one", async () => {
    process.env.ACK_DATABASE_URL = ACK_URL;
    h.state.poolQuery.set(ACK_URL, () => {
      throw new Error(`connect failed for ${ACK_URL}`);
    });
    const { ensureAckDatabaseReady } = await loadAckPool();
    await expect(ensureAckDatabaseReady()).resolves.toEqual({ ready: false, reason: "identity_check_failed" });
    expect(ackPools()[0]!.endCalls).toBe(1);
    expect(mainPools()).toHaveLength(0);
  });

  it("not configured: not ready and no pool is created at all", async () => {
    const { ensureAckDatabaseReady } = await loadAckPool();
    await expect(ensureAckDatabaseReady()).resolves.toEqual({ ready: false, reason: "missing" });
    expect(h.state.pools).toHaveLength(0);
  });

  it("concurrent readiness calls share one probe and one pool; later calls reuse the verified pool", async () => {
    process.env.ACK_DATABASE_URL = ACK_URL;
    let answer!: (r: Result) => void;
    h.state.poolQuery.set(ACK_URL, probeAnswers(() => new Promise<Result>((resolve) => (answer = resolve))));
    const { ensureAckDatabaseReady } = await loadAckPool();
    const calls = Array.from({ length: 6 }, () => ensureAckDatabaseReady());
    await vi.waitFor(() => expect(ackPools()[0]?.probeSql).toHaveLength(1));
    answer(identity(ACK, ACK));
    expect(await Promise.all(calls)).toEqual(Array.from({ length: 6 }, () => ({ ready: true })));
    await ensureAckDatabaseReady();
    expect(ackPools()).toHaveLength(1);
    expect(ackPools()[0]!.probeSql).toHaveLength(2); // one identity check and one grant check, shared by all six callers
  });

  it("a failed probe is retried by the next call with a fresh pool", async () => {
    process.env.ACK_DATABASE_URL = ACK_URL;
    let attempt = 0;
    h.state.poolQuery.set(ACK_URL, probeAnswers(() => (++attempt === 1 ? identity("postgres", "postgres") : identity(ACK, ACK))));
    const { ensureAckDatabaseReady } = await loadAckPool();
    await expect(ensureAckDatabaseReady()).resolves.toEqual({ ready: false, reason: "identity_mismatch" });
    await expect(ensureAckDatabaseReady()).resolves.toEqual({ ready: true });
    expect(ackPools()).toHaveLength(2);
    expect(ackPools()[0]!.endCalls).toBe(1);
  });

  it("closing during a probe never leaves a ready state behind", async () => {
    process.env.ACK_DATABASE_URL = ACK_URL;
    let answer!: (r: Result) => void;
    h.state.poolQuery.set(ACK_URL, probeAnswers(() => new Promise<Result>((resolve) => (answer = resolve))));
    const { ensureAckDatabaseReady, closeAckPool, ackDatabaseStatus } = await loadAckPool();
    const pending = ensureAckDatabaseReady();
    await vi.waitFor(() => expect(ackPools()[0]?.probeSql).toHaveLength(1));
    await closeAckPool();
    answer(identity(ACK, ACK));
    await expect(pending).resolves.toEqual({ ready: false, reason: "closed" });
    expect(ackDatabaseStatus().ready).toBe(false);
  });

  it("a stale probe finishing after a close does not overwrite the new pool's state (review L3)", async () => {
    process.env.ACK_DATABASE_URL = ACK_URL;
    let answerOld!: (r: Result) => void;
    let first = true;
    h.state.poolQuery.set(ACK_URL, probeAnswers(() => (first ? ((first = false), new Promise<Result>((resolve) => (answerOld = resolve))) : identity(ACK, ACK))));
    const { ensureAckDatabaseReady, closeAckPool, ackDatabaseStatus } = await loadAckPool();
    const stale = ensureAckDatabaseReady();
    await vi.waitFor(() => expect(ackPools()[0]?.probeSql).toHaveLength(1));
    await closeAckPool();
    await expect(ensureAckDatabaseReady()).resolves.toEqual({ ready: true }); // a new pool, verified
    answerOld(identity("postgres", "postgres")); // the old probe now reports a mismatch
    await expect(stale).resolves.toEqual({ ready: false, reason: "closed" });
    expect(ackDatabaseStatus().ready).toBe(true);
  });

  it("identity correct but the S6 grants missing: not ready (grants_missing), pool discarded (review M1)", async () => {
    process.env.ACK_DATABASE_URL = ACK_URL;
    h.state.poolQuery.set(ACK_URL, probeAnswers(identity(ACK, ACK), false));
    const { ensureAckDatabaseReady } = await loadAckPool();
    await expect(ensureAckDatabaseReady()).resolves.toEqual({ ready: false, reason: "grants_missing" });
    expect(ackPools()[0]!.endCalls).toBe(1);
    expect(logged.join("\n")).toContain("ACK_GRANTS_MISSING");
  });

  it("a server that never answers the probe: not ready after the probe timeout, pool discarded (review L1)", async () => {
    process.env.ACK_DATABASE_URL = ACK_URL;
    h.state.poolQuery.set(ACK_URL, () => new Promise<Result>(() => undefined));
    const { ensureAckDatabaseReady, ACK_PROBE_TIMEOUT_MS } = await loadAckPool();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = ensureAckDatabaseReady();
      await vi.advanceTimersByTimeAsync(ACK_PROBE_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ ready: false, reason: "probe_timeout" });
    } finally {
      vi.useRealTimers();
    }
    expect(ackPools()[0]!.endCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe("acknowledgement path: the ack pool only, the same SQL, the same idempotency", () => {
  const claims = {
    pur: "delivery_ack" as const,
    aud: "auth-billing-service",
    sub: "11111111-1111-4111-8111-111111111111",
    ref: "turn-1",
    amt: 2,
    op: "AI_CHAT_QUERY",
    iat: 1_800_000_000,
    rexp: 1_800_000_600,
    exp: 1_800_000_900,
  };
  const holdRow = (over: Row = {}): Row => ({
    status: "captured",
    amount: 2,
    operation_type: "AI_CHAT_QUERY",
    user_id: claims.sub,
    reference_id: claims.ref,
    delivery_tracking_enabled: true,
    already_recorded: false,
    created_at_s: claims.iat,
    expires_at_s: claims.rexp,
    ...over,
  });

  function ackClientAnswers(row: Row | null, txIdentity: Result = identity(ACK, ACK)) {
    h.state.clientQuery.set(ACK_URL, (sql) => {
      if (sql.startsWith("SELECT current_user")) return txIdentity;
      if (/FOR UPDATE/.test(sql)) return ok(row ? [row] : []);
      if (sql.trimStart().startsWith("UPDATE ai_credit_holds")) return ok([], 1);
      return ok(); // BEGIN / COMMIT / ROLLBACK
    });
  }

  async function record() {
    const { recordDeliveryAttempt } = await import("../../src/services/deliveryAttempt.service.js");
    return recordDeliveryAttempt(claims);
  }

  it("records through the ack pool: identity first, then the unchanged SELECT ... FOR UPDATE and UPDATE, then COMMIT", async () => {
    ackReadyAnswers();
    ackClientAnswers(holdRow());
    await expect(record()).resolves.toEqual({ recorded: true, alreadyRecorded: false });
    const client = ackPools()[0]!.clients[0]!;
    expect(client.sql[0]).toBe("BEGIN");
    expect(client.sql[1]).toBe("SELECT current_user, session_user");
    expect(client.sql[2]).toMatch(/FROM ai_credit_holds\s+WHERE user_id = \$1 AND reference_id = \$2\s+FOR UPDATE/);
    expect(client.sql[3]).toMatch(/UPDATE ai_credit_holds\s+SET answer_delivery_attempted_at = NOW\(\)/);
    expect(client.sql[3]).toMatch(/answer_delivery_attempted_at IS NULL/);
    expect(client.sql[4]).toBe("COMMIT");
    expect(client.released).toBe(true);
    expect(mainPools()).toHaveLength(0); // the main pool is never even created
  });

  it("a repeat is idempotent: reports the earlier record and writes nothing", async () => {
    ackReadyAnswers();
    ackClientAnswers(holdRow({ already_recorded: true }));
    await expect(record()).resolves.toEqual({ recorded: true, alreadyRecorded: true });
    const client = ackPools()[0]!.clients[0]!;
    expect(client.sql.some((s) => s.trimStart().startsWith("UPDATE"))).toBe(false);
    expect(client.sql.at(-1)).toBe("COMMIT");
    expect(mainPools()).toHaveLength(0);
  });

  it("an unrecordable reservation keeps its 409 and writes nothing", async () => {
    ackReadyAnswers();
    ackClientAnswers(holdRow({ status: "held" }));
    await expect(record()).rejects.toMatchObject({ statusCode: 409, code: "DELIVERY_ATTEMPT_NOT_RECORDABLE" });
    expect(ackPools()[0]!.clients[0]!.sql).toContain("ROLLBACK");
    expect(mainPools()).toHaveLength(0);
  });

  it("ack pool not configured: 503, nothing written, no fallback to the main pool", async () => {
    await expect(record()).rejects.toMatchObject({ statusCode: 503, code: "DELIVERY_TRACKING_UNAVAILABLE" });
    expect(h.state.pools).toHaveLength(0);
  });

  it("ack connection failure: 503, no fallback to the main pool", async () => {
    process.env.ACK_DATABASE_URL = ACK_URL;
    h.state.poolQuery.set(ACK_URL, () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    await expect(record()).rejects.toMatchObject({ statusCode: 503, code: "DELIVERY_TRACKING_UNAVAILABLE" });
    expect(mainPools()).toHaveLength(0);
  });

  it("a privilege or authentication error from the ack pool fails closed (503) and forces a fresh check (review M1)", async () => {
    ackReadyAnswers();
    let denied = true;
    h.state.clientQuery.set(ACK_URL, (sql) => {
      if (sql.startsWith("SELECT current_user")) return identity(ACK, ACK);
      if (/FOR UPDATE/.test(sql) && denied) throw Object.assign(new Error("permission denied for table ai_credit_holds"), { code: "42501" });
      if (/FOR UPDATE/.test(sql)) return ok([holdRow()]);
      if (sql.trimStart().startsWith("UPDATE ai_credit_holds")) return ok([], 1);
      return ok();
    });
    await expect(record()).rejects.toMatchObject({ statusCode: 503, code: "DELIVERY_TRACKING_UNAVAILABLE" });
    expect(ackPools()[0]!.clients[0]!.sql).toContain("ROLLBACK");
    denied = false;
    await expect(record()).resolves.toEqual({ recorded: true, alreadyRecorded: false });
    expect(ackPools()[0]!.probeSql.filter((s) => s === IDENTITY_SQL)).toHaveLength(2); // re-verified before the second attempt
    expect(mainPools()).toHaveLength(0);
  });

  it("a transient error keeps its classification (40001 stays retryable), and readiness is re-checked", async () => {
    ackReadyAnswers();
    h.state.clientQuery.set(ACK_URL, (sql) => {
      if (sql.startsWith("SELECT current_user")) return identity(ACK, ACK);
      if (/FOR UPDATE/.test(sql)) return ok([holdRow()]);
      if (sql.trimStart().startsWith("UPDATE ai_credit_holds")) throw Object.assign(new Error("could not serialize access"), { code: "40001" });
      return ok();
    });
    await expect(record()).rejects.toMatchObject({ code: "40001" });
    const { ackDatabaseStatus } = await loadAckPool();
    expect(ackDatabaseStatus().ready).toBe(false);
  });

  it("identity re-checked inside the transaction: a wrong identity rolls back before the hold is read", async () => {
    ackReadyAnswers();
    ackClientAnswers(holdRow(), identity("moleculestudio_app", "moleculestudio_app"));
    await expect(record()).rejects.toMatchObject({ statusCode: 503, code: "DELIVERY_TRACKING_UNAVAILABLE" });
    const client = ackPools()[0]!.clients[0]!;
    expect(client.sql.some((s) => /FOR UPDATE/.test(s))).toBe(false);
    expect(client.sql).toContain("ROLLBACK");
    expect(ackPools()[0]!.endCalls).toBe(1);
    expect(mainPools()).toHaveLength(0);
  });

  it("source: the acknowledgement path cannot reach the main pool (static)", () => {
    const service = code("src/services/deliveryAttempt.service.ts");
    expect(service).toContain('import { withAckTransaction } from "../db/ackPool.js"');
    expect(service).not.toMatch(/from "\.\.\/db\/index\.js"|withTransaction\(|\bpool\./);
    const ackPool = code("src/db/ackPool.ts");
    expect(ackPool).not.toMatch(/getPool|withTransaction\b|DATABASE_URL"|process\.env\.DATABASE_URL|SET ROLE/i);
    expect(ackPool).toContain('import { runInTransaction } from "./index.js"');
    const routes = read("src/routes/billing.routes.ts");
    const ackRoute = routes.split("\n").find((l) => l.includes('"/delivery-attempt"'))!;
    expect(ackRoute).not.toContain("requireDatabase");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe("tracked reservations fail closed before any reservation work", () => {
  /** The main pool's first statement fails, so a test can see whether the reservation transaction was ever started. */
  function mainStopsAtBegin() {
    h.state.clientQuery.set(mainUrl(), (sql) => {
      if (sql === "BEGIN") throw new Error("reservation transaction reached");
      return ok();
    });
  }

  async function reserve(trackDelivery: boolean, operationType: unknown = "AI_CHAT_QUERY") {
    const { reserveCreditsForOperation } = await import("../../src/services/aiCredits.service.js");
    return reserveCreditsForOperation("11111111-1111-4111-8111-111111111111", operationType, "turn-1", { trackDelivery });
  }

  it("tracking off: unchanged — the reservation transaction starts and the ack pool is never touched", async () => {
    mainStopsAtBegin();
    await expect(reserve(false)).rejects.toThrow("reservation transaction reached");
    expect(mainPools()[0]!.clients).toHaveLength(1);
    expect(ackPools()).toHaveLength(0);
  });

  it("tracking on and the ack pool ready: the reservation proceeds, after the identity check", async () => {
    ackReadyAnswers();
    mainStopsAtBegin();
    await expect(reserve(true)).rejects.toThrow("reservation transaction reached");
    expect(ackPools()[0]!.probeSql[0]).toBe(IDENTITY_SQL);
    expect(ackPools()[0]!.probeSql[1]).toContain("has_column_privilege");
    expect(ackPools()[0]!.probeSql).toHaveLength(2);
    expect(mainPools()[0]!.clients).toHaveLength(1);
  });

  const refusals: Array<[string, () => void]> = [
    ["ack pool missing", () => undefined],
    [
      "ack identity invalid",
      () => {
        process.env.ACK_DATABASE_URL = ACK_URL;
        h.state.poolQuery.set(ACK_URL, () => identity("moleculestudio_app", "moleculestudio_app"));
      },
    ],
    [
      "ack pool unavailable",
      () => {
        process.env.ACK_DATABASE_URL = ACK_URL;
        h.state.poolQuery.set(ACK_URL, () => {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        });
      },
    ],
  ];
  for (const [name, arrange] of refusals) {
    it(`tracking on and ${name}: refused with 503 before any reservation, capture or charge`, async () => {
      arrange();
      mainStopsAtBegin();
      await expect(reserve(true)).rejects.toMatchObject({ statusCode: 503, code: "DELIVERY_TRACKING_UNAVAILABLE" });
      // The main pool was never used: no lock, no hold INSERT, no token, so nothing to release and nothing to charge.
      expect(mainPools().flatMap((p) => p.clients)).toHaveLength(0);
      expect(logged.join("\n")).toContain("TRACKED_RESERVATION_REFUSED");
    });
  }

  it("validation still comes first: an unknown operation is a 400 and the ack pool is not probed", async () => {
    await expect(reserve(true, "NOT_AN_OPERATION")).rejects.toMatchObject({ statusCode: 400, code: "INVALID_OPERATION" });
    expect(h.state.pools).toHaveLength(0);
  });

  it("source: tracking is never switched on by default anywhere in the service", () => {
    const service = read("src/services/aiCredits.service.ts");
    expect(service).toContain("const trackDelivery = options.trackDelivery === true;");
    expect(read("src/controllers/billing.controller.ts")).toContain("trackDelivery: trackDelivery === true");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe("shutdown closes both pools", () => {
  async function bothPools() {
    ackReadyAnswers();
    const db = await import("../../src/db/index.js");
    db.getPool(); // the lazy main pool
    const ack = await loadAckPool();
    await ack.ensureAckDatabaseReady();
    const { closeDatabasePools } = await import("../../src/db/lifecycle.js");
    return { closeDatabasePools };
  }

  it("both pools are ended, and a second shutdown is a no-op", async () => {
    const { closeDatabasePools } = await bothPools();
    await closeDatabasePools();
    expect(mainPools()[0]!.endCalls).toBe(1);
    expect(ackPools()[0]!.endCalls).toBe(1);
    await expect(closeDatabasePools()).resolves.toBeUndefined();
    expect(mainPools()[0]!.endCalls).toBe(1);
    expect(ackPools()[0]!.endCalls).toBe(1);
  });

  it("the main pool failing to close does not keep the ack pool open", async () => {
    const { closeDatabasePools } = await bothPools();
    h.state.endError.set(mainUrl(), new Error(`end failed ${ACK_URL}`));
    await expect(closeDatabasePools()).rejects.toBeInstanceOf(AggregateError);
    expect(ackPools()[0]!.endCalls).toBe(1);
    // Repeated shutdown after the failure is safe: neither pool is ended twice (review L5).
    await expect(closeDatabasePools()).resolves.toBeUndefined();
    expect(mainPools()[0]!.endCalls).toBe(1);
    expect(ackPools()[0]!.endCalls).toBe(1);
  });

  it("the ack pool failing to close does not keep the main pool open", async () => {
    const { closeDatabasePools } = await bothPools();
    h.state.endError.set(ACK_URL, new Error("end failed"));
    await expect(closeDatabasePools()).rejects.toBeInstanceOf(AggregateError);
    expect(mainPools()[0]!.endCalls).toBe(1);
  });

  it("nothing was ever opened: shutdown resolves", async () => {
    const { closeDatabasePools } = await import("../../src/db/lifecycle.js");
    await expect(closeDatabasePools()).resolves.toBeUndefined();
    expect(h.state.pools).toHaveLength(0);
  });

  it("source: the service's shutdown uses closeDatabasePools (static)", () => {
    const index = read("src/index.ts");
    expect(index).toContain("await closeDatabasePools();");
    expect(index).not.toMatch(/await closePool\(\)/);
  });
});
