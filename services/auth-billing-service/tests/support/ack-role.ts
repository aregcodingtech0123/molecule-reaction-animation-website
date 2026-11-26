/**
 * O-21: a REAL `moleculestudio_ack` login for the database-backed suites (delivery-attempt.test.ts and the BFF's
 * chat.delivery-ack.test.ts), so the delivery-attempt pool is exercised exactly as in production: its own URL, its own role,
 * and the run-time identity check (current_user AND session_user) passing for real. No superuser stands in for it, no
 * membership is added, nothing in src/ is weakened.
 *
 * Lifecycle
 *  - The role is cluster-global: created ONCE per disposable cluster by the staged S3 script and never dropped by tests (other
 *    projects may be using it). It disappears with the cluster (`npm run test:db:down` locally; the job's service container in CI).
 *  - Its privileges are database-local: the staged S6 script grants them inside each freshly recreated test database.
 *  - Both scripts are the staged contract files themselves, read from database/staged/phase-2c-v7, checked against
 *    MANIFEST.json (LF-normalised SHA-256) and executed verbatim. No grant text lives in the tests.
 *  - Concurrent global setups (several Vitest projects, or two processes on one cluster) are serialised by one advisory lock
 *    taken in the `postgres` database (advisory locks are per database, so every provisioner locks in the same one).
 *
 * Safety: nothing privileged runs unless the target is demonstrably a disposable test cluster (see disposableTarget). A database
 * name containing "test" is NOT enough. No credential is created, read, logged or written: the ACK URL is the test URL with only
 * the user name changed, and the disposable clusters use trust authentication.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const ACK_ROLE = "moleculestudio_ack";

const STAGED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../database/staged/phase-2c-v7");
const STAGED_FILES = ["S3-ack-role-creation.sql", "S6-ack-role-deployment.sql"] as const;

/** Arbitrary fixed key, distinct from the migration runner's lock (7_302_215_847_263). */
export const ACK_PROVISION_LOCK_KEY = 7_302_215_847_301;

/** The local disposable cluster of docker-compose.test.yml. */
export const LOCAL_TEST_PORT = 55432;
/** The CI service container (.github/workflows/test.yml). */
export const CI_TEST_PORT = 5432;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const TEST_DB_NAME = /^[a-z][a-z0-9_]*_test$/;

export type Verdict = { ok: true; mode: "local" | "ci" } | { ok: false; reason: string };
export type AckProvisioning = { ok: true; ackUrl: string } | { ok: false; reason: string };

/**
 * Static part of the guard (no connection): loopback host, a password-less URL (trust-authenticated disposable cluster), a
 * guarded test database name, and one of exactly two known targets:
 *  - local: port 55432 (docker-compose.test.yml), confirmed at run time by `fsync = off`, which that compose file sets;
 *  - ci:    port 5432 with GITHUB_ACTIONS=true, CI=true and RUNNER_ENVIRONMENT=github-hosted (set by GitHub Actions itself, not by
 *           this repository; a self-hosted runner is refused).
 * Anything else is refused, so a developer database on 5432 is never touched.
 */
export function disposableTarget(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): Verdict {
  let u: URL;
  try {
    u = new URL(databaseUrl);
  } catch {
    return { ok: false, reason: "test database URL is not a valid URL" };
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return { ok: false, reason: "not a postgresql:// URL" };
  if (!LOOPBACK.has(u.hostname.toLowerCase())) return { ok: false, reason: "host is not loopback" };
  if (u.password) return { ok: false, reason: "URL carries a password (the disposable test clusters use trust authentication)" };
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!TEST_DB_NAME.test(database)) return { ok: false, reason: "database name is not a guarded *_test name" };
  const port = Number(u.port || 5432);
  if (port === LOCAL_TEST_PORT) return { ok: true, mode: "local" };
  // GitHub-hosted runners only: a self-hosted runner could have a long-lived database on 5432 (review finding L8).
  if (port === CI_TEST_PORT && env.GITHUB_ACTIONS === "true" && env.CI === "true" && env.RUNNER_ENVIRONMENT === "github-hosted") {
    return { ok: true, mode: "ci" };
  }
  return { ok: false, reason: `port ${port} is not a recognised disposable test cluster (local ${LOCAL_TEST_PORT}, or ${CI_TEST_PORT} on GitHub Actions)` };
}

/** The ACK URL: the test URL with only the user name replaced. No password is added. */
export function ackUrlFor(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  u.username = ACK_ROLE;
  u.password = "";
  return u.toString();
}

const lfSha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");

/** The two staged files, verified against MANIFEST.json. Throws on any mismatch: a changed contract never runs. */
export function loadStagedAckSql(dir = STAGED_DIR): Record<(typeof STAGED_FILES)[number], string> {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "MANIFEST.json"), "utf8")) as { entries: Array<{ file: string; sha256: string }> };
  const out = {} as Record<(typeof STAGED_FILES)[number], string>;
  for (const file of STAGED_FILES) {
    const entry = manifest.entries.find((e) => e.file === file);
    if (!entry) throw new Error(`[ack-role] ${file} is not listed in MANIFEST.json`);
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    if (lfSha256(sql) !== entry.sha256) throw new Error(`[ack-role] ${file} does not match its MANIFEST.json sha256; refusing to run it`);
    out[file] = sql;
  }
  return out;
}

async function withClient<T>(connectionString: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

interface ServerFacts {
  systemIdentifier: string;
  database: string;
  superuser: boolean;
  versionNum: number;
  fsync: string;
}

async function serverFacts(c: pg.Client): Promise<ServerFacts> {
  const { rows } = await c.query<{ sid: string; db: string; su: boolean; v: string; fsync: string }>(
    `SELECT (SELECT system_identifier::text FROM pg_control_system()) AS sid, current_database() AS db,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su,
            current_setting('server_version_num') AS v, current_setting('fsync') AS fsync`,
  );
  const r = rows[0]!;
  return { systemIdentifier: r.sid, database: r.db, superuser: r.su, versionNum: Number(r.v), fsync: r.fsync };
}

function adminUrlFor(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  u.pathname = "/postgres";
  return u.toString();
}

/**
 * Provision the real ACK login for one freshly prepared test database and return its URL, or explain why not.
 * Refusals by the guard return `{ ok: false }` (no privileged statement was sent). Any failure AFTER the guard passed throws.
 */
export async function provisionAckRole(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): Promise<AckProvisioning> {
  const verdict = disposableTarget(databaseUrl, env);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const expectedDb = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  const sql = loadStagedAckSql();

  return withClient(adminUrlFor(databaseUrl), async (admin) => {
    const adminFacts = await serverFacts(admin);
    if (!adminFacts.superuser) return { ok: false, reason: "setup role is not a superuser" };
    if (adminFacts.versionNum < 180000) return { ok: false, reason: "server is not PostgreSQL 18 or later" };
    if (verdict.mode === "local" && adminFacts.fsync !== "off") {
      return { ok: false, reason: "local cluster does not carry the docker-compose.test.yml signature (fsync = off)" };
    }

    await admin.query("SELECT pg_advisory_lock($1)", [ACK_PROVISION_LOCK_KEY]);
    try {
      await withClient(databaseUrl, async (target) => {
        const t = await serverFacts(target);
        if (t.systemIdentifier !== adminFacts.systemIdentifier) throw new Error("[ack-role] target database is on a different cluster than the admin connection");
        if (t.database !== expectedDb) throw new Error("[ack-role] connected to an unexpected database");
        if (!t.superuser) throw new Error("[ack-role] target connection is not the superuser");
        // Verbatim staged contract: S3 creates the role once per cluster (or only verifies it), S6 grants inside this database.
        await target.query(sql["S3-ack-role-creation.sql"]);
        await target.query(sql["S6-ack-role-deployment.sql"]);
      });

      // Cluster-global facts, checked before the URL is handed out.
      const { rows: attrs } = await admin.query<{ login: boolean; inherit: boolean; elevated: boolean; memberships: number; members: number }>(
        `SELECT r.rolcanlogin AS login, r.rolinherit AS inherit,
                (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls) AS elevated,
                (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships,
                (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = r.oid) AS members
           FROM pg_roles r WHERE r.rolname = $1`,
        [ACK_ROLE],
      );
      const a = attrs[0];
      if (!a || !a.login || a.inherit || a.elevated || a.memberships !== 0 || a.members !== 0) {
        throw new Error("[ack-role] moleculestudio_ack does not have the S3 attributes (LOGIN NOINHERIT, nothing elevated, no membership)");
      }
    } finally {
      await admin.query("SELECT pg_advisory_unlock($1)", [ACK_PROVISION_LOCK_KEY]).catch(() => undefined);
    }

    // The real login, as PostgreSQL authenticates it: the same check the application pool makes.
    const ackUrl = ackUrlFor(databaseUrl);
    await withClient(ackUrl, async (ack) => {
      const { rows } = await ack.query<{ current_user: string; session_user: string; db: string }>(
        "SELECT current_user, session_user, current_database() AS db",
      );
      const r = rows[0];
      if (!r || r.current_user !== ACK_ROLE || r.session_user !== ACK_ROLE || r.db !== expectedDb) {
        throw new Error("[ack-role] the ACK login is not authenticated as moleculestudio_ack on the test database");
      }
    });
    return { ok: true, ackUrl };
  });
}
