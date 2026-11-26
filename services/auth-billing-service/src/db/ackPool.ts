import pg from "pg";
import {
  ACK_DATABASE_ROLE,
  describeAckConfigProblem,
  resolveAckDatabaseConfig,
  type AckConfigProblem,
} from "../config/ackDatabase.js";
import { POOL_OPTIONS } from "../config/database.js";
import { AppError } from "../types/index.js";
import { logDbError } from "./diagnostics.js";
import { runInTransaction } from "./index.js";

/**
 * The delivery-attempt connection pool (ACK_DATABASE_URL), separate from the main pool (Phase 2C, migration 021).
 *
 * It exists for one statement pair: recording `answer_delivery_attempted_at` (services/deliveryAttempt.service.ts). Migration
 * 021 lets only `moleculestudio_ack` (or a member of the table owner) make that write, judged by `current_user` inside a SECURITY
 * INVOKER trigger. So this pool must be authenticated directly as that role:
 *  - no fallback: it is built only from ACK_DATABASE_URL, never from DATABASE_URL, and nothing here ever uses the main pool;
 *  - no SET ROLE, no membership, no extra grant: the pool is simply ready or not;
 *  - ready only after `SELECT current_user, session_user` through THIS pool returned the ack role for both; every acknowledgement
 *    transaction checks the same again as its first statement, so a connection authenticated as anyone else never writes;
 *  - lazy: no connection is made until a tracked reservation or an acknowledgement needs one;
 *  - single-flight: concurrent callers share one readiness probe and one pool.
 *
 * Diagnostics are fixed codes and role names only: never a URL, password or other connection detail.
 */

const { Pool } = pg;

/** Small: one short transaction per acknowledged answer. Timeouts as for the main pool. */
const ACK_POOL_MAX = 10;

export type AckUnavailableReason = AckConfigProblem | "identity_mismatch" | "grants_missing" | "identity_check_failed" | "probe_timeout" | "closed";

/** Upper bound for one readiness probe; a server that accepts the connection but never answers must not hang reservations (L1). */
export const ACK_PROBE_TIMEOUT_MS = 5_000;

/**
 * The privileges the acknowledgement needs (S6-ack-role-deployment.sql): SELECT on the nine columns it reads or filters, UPDATE on
 * the one it writes (which also allows the SELECT ... FOR UPDATE row lock). Checked at readiness so a role without its grants
 * refuses tracked reservations instead of accepting them and failing every acknowledgement later (review finding M1).
 */
const ACK_GRANTS_SQL = `SELECT (
  has_column_privilege('public.ai_credit_holds', 'user_id', 'SELECT') AND has_column_privilege('public.ai_credit_holds', 'reference_id', 'SELECT')
  AND has_column_privilege('public.ai_credit_holds', 'status', 'SELECT') AND has_column_privilege('public.ai_credit_holds', 'amount', 'SELECT')
  AND has_column_privilege('public.ai_credit_holds', 'operation_type', 'SELECT') AND has_column_privilege('public.ai_credit_holds', 'created_at', 'SELECT')
  AND has_column_privilege('public.ai_credit_holds', 'expires_at', 'SELECT') AND has_column_privilege('public.ai_credit_holds', 'delivery_tracking_enabled', 'SELECT')
  AND has_column_privilege('public.ai_credit_holds', 'answer_delivery_attempted_at', 'SELECT')
  AND has_column_privilege('public.ai_credit_holds', 'answer_delivery_attempted_at', 'UPDATE')) AS ok`;

/** SQLSTATEs from the ack pool that mean its role or configuration is wrong, not that the request is: authorization (28xxx), unknown database, privilege. */
function isAckConfigurationError(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  return code.startsWith("28") || code === "3D000" || code === "42501";
}

export type AckReadiness = { ready: true } | { ready: false; reason: AckUnavailableReason };

/** The uniform refusal for tracked reservations and for acknowledgements while the pool is not ready. Says nothing secret. */
export function deliveryTrackingUnavailable(): AppError {
  return new AppError(503, "Delivery tracking is temporarily unavailable.", "DELIVERY_TRACKING_UNAVAILABLE");
}

let ackPool: pg.Pool | null = null;
let ready = false;
let lastReason: AckUnavailableReason | null = null;
/** Bumped by closeAckPool: a probe that started before the close must not mark a later state ready. */
let generation = 0;
let inflight: Promise<AckReadiness> | null = null;

/** Ends a pool that must not be used again (wrong identity, failed check, shutdown) and forgets it. Never throws. */
function discardPool(p: pg.Pool): void {
  if (ackPool === p) {
    ackPool = null;
    ready = false;
  }
  void p.end().catch(() => undefined);
}

function createAckPool(connectionString: string): pg.Pool {
  const p = new Pool({
    connectionString,
    max: ACK_POOL_MAX,
    idleTimeoutMillis: POOL_OPTIONS.idleTimeoutMillis,
    connectionTimeoutMillis: POOL_OPTIONS.connectionTimeoutMillis,
  });
  p.on("error", (err) => {
    logDbError("ack pool idle client", err);
    // Re-check identity before the next use instead of trusting a pool that just lost a connection.
    if (ackPool === p) ready = false;
  });
  return p;
}

function unavailable(reason: AckUnavailableReason): AckReadiness {
  lastReason = reason;
  ready = false;
  return { ready: false, reason };
}

/** Both identities must be exactly the ack role. Exported for the tests of this rule only. */
export function isAckIdentity(row: { current_user?: unknown; session_user?: unknown } | undefined): boolean {
  return Boolean(row) && row!.current_user === ACK_DATABASE_ROLE && row!.session_user === ACK_DATABASE_ROLE;
}

function logIdentityMismatch(row: { current_user?: unknown; session_user?: unknown } | undefined): void {
  // Role names are not secret; the connection string is never logged.
  console.error("[ack-db] ACK_IDENTITY_MISMATCH: the acknowledgement connection is not authenticated as the acknowledgement role", {
    expected: ACK_DATABASE_ROLE,
    currentUser: typeof row?.current_user === "string" ? row.current_user : null,
    sessionUser: typeof row?.session_user === "string" ? row.session_user : null,
  });
}

async function probe(): Promise<AckReadiness> {
  const startedIn = generation;
  // A probe that started before closeAckPool reports "closed" and leaves the module state alone (review finding L3).
  const fail = (reason: AckUnavailableReason): AckReadiness => (startedIn === generation ? unavailable(reason) : { ready: false, reason: "closed" });
  const resolved = resolveAckDatabaseConfig();
  if (!resolved.ok) {
    console.warn(`[ack-db] ACK_DATABASE_UNAVAILABLE: ${describeAckConfigProblem(resolved.problem)}`);
    return fail(resolved.problem);
  }

  ackPool ??= createAckPool(resolved.config.connectionString);
  const p = ackPool;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ACK_PROBE_TIMEOUT_MS);
  });
  try {
    const checked = await Promise.race([
      (async () => {
        const { rows } = await p.query<{ current_user: string; session_user: string }>("SELECT current_user, session_user");
        if (!isAckIdentity(rows[0])) return { identity: rows[0], grants: false };
        const g = await p.query<{ ok: boolean }>(ACK_GRANTS_SQL);
        return { identity: rows[0], grants: g.rows[0]?.ok === true };
      })(),
      timedOut,
    ]);
    if (startedIn !== generation) return fail("closed");
    if (checked === "timeout") {
      console.error("[ack-db] ACK_PROBE_TIMEOUT: the acknowledgement database did not answer the readiness check");
      discardPool(p);
      return fail("probe_timeout");
    }
    if (!isAckIdentity(checked.identity)) {
      logIdentityMismatch(checked.identity);
      discardPool(p);
      return fail("identity_mismatch");
    }
    if (!checked.grants) {
      console.error("[ack-db] ACK_GRANTS_MISSING: the acknowledgement role lacks the S6 column privileges on ai_credit_holds");
      discardPool(p);
      return fail("grants_missing");
    }
    ready = true;
    lastReason = null;
    return { ready: true };
  } catch (err) {
    logDbError("ack identity check", err);
    discardPool(p);
    return fail("identity_check_failed");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Establish (once) that the ack pool is configured and authenticated as the ack role. Safe to call concurrently and repeatedly:
 * callers share one probe, at most one pool exists, and a failed probe is retried by the next call with a fresh pool.
 */
export function ensureAckDatabaseReady(): Promise<AckReadiness> {
  if (ready && ackPool) return Promise.resolve({ ready: true });
  if (!inflight) {
    const current = probe();
    inflight = current;
    void current.finally(() => {
      if (inflight === current) inflight = null;
    });
  }
  return inflight;
}

/** Status for startup logging. Makes no connection and reveals no connection detail. */
export function ackDatabaseStatus(): { configured: boolean; problem: AckConfigProblem | null; ready: boolean; lastReason: AckUnavailableReason | null } {
  const resolved = resolveAckDatabaseConfig();
  return { configured: resolved.ok, problem: resolved.ok ? null : resolved.problem, ready: ready && ackPool !== null, lastReason };
}

/**
 * Run `fn` in one transaction on the ack pool ONLY. Refuses (503 DELIVERY_TRACKING_UNAVAILABLE) when the pool is not ready, and
 * re-checks the identity as the first statement of the transaction. There is no path to the main pool.
 */
export async function withAckTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const readiness = await ensureAckDatabaseReady();
  const p = ackPool;
  if (!readiness.ready || !p) throw deliveryTrackingUnavailable();

  try {
    return await runInTransaction(
      () => p,
      async (client) => {
        const { rows } = await client.query<{ current_user: string; session_user: string }>("SELECT current_user, session_user");
        if (!isAckIdentity(rows[0])) {
          logIdentityMismatch(rows[0]);
          discardPool(p);
          lastReason = "identity_mismatch";
          throw deliveryTrackingUnavailable();
        }
        return fn(client);
      },
    );
  } catch (err) {
    if (err instanceof AppError) throw err; // the acknowledgement's own answers (404, 403, 409) and the refusal above
    // Any database or connection failure: verify identity and grants again before the next tracked reservation (M1).
    if (ackPool === p) ready = false;
    if (isAckConfigurationError(err)) {
      // Wrong credentials, wrong database or missing privilege: the ack pool is not usable, so fail closed with the same refusal.
      logDbError("ack transaction (configuration)", err);
      lastReason = "identity_check_failed";
      throw deliveryTrackingUnavailable();
    }
    throw err; // transient and connection errors keep their existing classification (503 TRANSIENT_DATABASE_ERROR / DATABASE_UNAVAILABLE)
  }
}

/** Close the ack pool (shutdown). Safe to call repeatedly and when the pool was never created. */
export async function closeAckPool(): Promise<void> {
  generation += 1;
  ready = false;
  inflight = null;
  const p = ackPool;
  ackPool = null;
  if (p) await p.end();
}
