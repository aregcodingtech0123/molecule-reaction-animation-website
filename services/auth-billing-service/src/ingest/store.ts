/**
 * The ingestion process's only database access: one connection pool authenticated as `moleculestudio_webhook`, and the one insert
 * the S6 grants allow (S6-webhook-role-privileges.sql: SELECT (id, body_sha256, status), column INSERT, nothing else).
 *
 *  - No fallback: the pool is built from WEBHOOK_DATABASE_URL only. This module imports nothing that can reach the main pool.
 *  - Ready only after `current_user` AND `session_user` are the webhook role and the column privileges are exactly the contract's:
 *    INSERT on the typed columns, none on `ingested_by` / `status` / `outcome` (the database records who stored the event, and
 *    only this role may set `eligible`), no UPDATE anywhere, no DELETE, no read of the stored message. On a database that does not
 *    have migration 022's columns the check itself fails (42703), so the process refuses deliveries (503) instead of storing untyped rows.
 *  - Duplicate delivery: INSERT ... ON CONFLICT ON CONSTRAINT uq_lemon_webhook_events_body DO NOTHING, then a read by hash. No UPDATE
 *    privilege is needed, which is the point of the V4 statement.
 *
 * Diagnostics are fixed codes: never a URL, a password or a stored value.
 */
import pg from "pg";
import type { IngestRow } from "./classify.js";

export const INSERT_COLUMNS = [
  "body_sha256",
  "event_name",
  "provider_order_id",
  "payload",
  "eligible",
  "order_store_id",
  "order_test_mode",
  "order_variant_id",
  "order_currency",
  "order_total_cents",
  "order_subtotal_cents",
  "order_item_price_cents",
  "buyer_user_id",
  "buyer_email",
  "pending_order_id",
] as const;
const SELECT_COLUMNS = ["id", "body_sha256", "status"] as const;
/** Columns the role must NOT be able to write. */
const FORBIDDEN_INSERT_COLUMNS = ["ingested_by", "status", "attempts", "outcome", "last_error", "processed_at", "claimed_at", "received_at"] as const;

const INSERT_SQL = `INSERT INTO lemon_webhook_events (${INSERT_COLUMNS.join(", ")})
     VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT ON CONSTRAINT uq_lemon_webhook_events_body DO NOTHING
     RETURNING id::text, status`;
const SELECT_BY_HASH_SQL = `SELECT id::text, status FROM lemon_webhook_events WHERE body_sha256 = $1`;

const priv = (column: string, kind: string) => `has_column_privilege('public.lemon_webhook_events', '${column}', '${kind}')`;
/** True only when the role's privileges on the inbox are exactly the contract's. */
export const GRANTS_SQL = `SELECT (
  ${SELECT_COLUMNS.map((c) => priv(c, "SELECT")).join(" AND ")}
  AND ${INSERT_COLUMNS.map((c) => priv(c, "INSERT")).join(" AND ")}
  AND NOT (${FORBIDDEN_INSERT_COLUMNS.map((c) => priv(c, "INSERT")).join(" OR ")})
  AND NOT ${priv("payload", "SELECT")} AND NOT ${priv("buyer_email", "SELECT")}
  AND NOT has_any_column_privilege('public.lemon_webhook_events', 'UPDATE')
  AND NOT has_table_privilege('public.lemon_webhook_events', 'DELETE')
) AS ok`;

export type StoreUnavailableReason = "identity_mismatch" | "grants_wrong" | "contract_missing" | "check_failed" | "probe_timeout" | "closed";
export type StoreReadiness = { ready: true } | { ready: false; reason: StoreUnavailableReason };

export interface StoredDelivery {
  id: string;
  status: string;
  /** false: an identical delivery was already stored. */
  inserted: boolean;
}

/** The part of pg.Pool this module uses (a fake in the tests). */
export interface PoolLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  on(event: "error", listener: (err: Error) => void): unknown;
  end(): Promise<void>;
}

export interface IngestStore {
  ready(): Promise<StoreReadiness>;
  insert(row: IngestRow): Promise<StoredDelivery>;
  close(): Promise<void>;
}

export class StoreNotReadyError extends Error {
  constructor(readonly reason: StoreUnavailableReason) {
    super(`webhook store is not ready: ${reason}`);
    this.name = "StoreNotReadyError";
  }
}

const PROBE_TIMEOUT_MS = 5_000;
const sqlstate = (err: unknown): string => (err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "");

export function createIngestStore(options: {
  connectionString: string;
  poolFactory?: (connectionString: string) => PoolLike;
  probeTimeoutMs?: number;
}): IngestStore {
  const factory = options.poolFactory ?? ((cs) => new pg.Pool({ connectionString: cs, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }) as unknown as PoolLike);
  let pool: PoolLike | null = null;
  let isReady = false;
  let generation = 0;
  let inflight: Promise<StoreReadiness> | null = null;

  const discard = (p: PoolLike) => {
    if (pool === p) {
      pool = null;
      isReady = false;
    }
    void p.end().catch(() => undefined);
  };

  async function probe(): Promise<StoreReadiness> {
    const started = generation;
    const fail = (reason: StoreUnavailableReason): StoreReadiness => ({ ready: false, reason: started === generation ? reason : "closed" });
    pool ??= factory(options.connectionString);
    const p = pool;
    p.on("error", () => {
      if (pool === p) isReady = false; // re-check identity before the next use
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), options.probeTimeoutMs ?? PROBE_TIMEOUT_MS);
    });
    try {
      const checked = await Promise.race([
        (async () => {
          const who = await p.query("SELECT current_user, session_user");
          const row = who.rows[0];
          if (row?.current_user !== "moleculestudio_webhook" || row?.session_user !== "moleculestudio_webhook") return "identity" as const;
          const grants = await p.query(GRANTS_SQL);
          return grants.rows[0]?.ok === true ? ("ok" as const) : ("grants" as const);
        })(),
        timedOut,
      ]);
      if (started !== generation) return fail("closed");
      if (checked === "ok") {
        isReady = true;
        return { ready: true };
      }
      discard(p);
      if (checked === "timeout") {
        console.error("[ingest-db] INGEST_PROBE_TIMEOUT: the database did not answer the readiness check");
        return fail("probe_timeout");
      }
      console.error(
        checked === "identity"
          ? "[ingest-db] INGEST_IDENTITY_MISMATCH: the connection is not authenticated as the webhook role"
          : "[ingest-db] INGEST_GRANTS_WRONG: the webhook role's privileges on lemon_webhook_events differ from the S6 contract",
      );
      return fail(checked === "identity" ? "identity_mismatch" : "grants_wrong");
    } catch (err) {
      discard(p);
      const code = sqlstate(err);
      console.error("[ingest-db] INGEST_CHECK_FAILED", { sqlstate: code || null });
      // 42703: the typed columns of migration 022 do not exist, so this database is not the contract's.
      return fail(code === "42703" ? "contract_missing" : "check_failed");
    } finally {
      clearTimeout(timer);
    }
  }

  function ready(): Promise<StoreReadiness> {
    if (isReady && pool) return Promise.resolve({ ready: true });
    if (!inflight) {
      const current = probe();
      inflight = current;
      void current.finally(() => {
        if (inflight === current) inflight = null;
      });
    }
    return inflight;
  }

  return {
    ready,
    async insert(row) {
      const readiness = await ready();
      const p = pool;
      if (!readiness.ready || !p) throw new StoreNotReadyError(readiness.ready ? "closed" : readiness.reason);
      try {
        const params = [
          row.bodySha256,
          row.eventName,
          row.providerOrderId,
          row.payload,
          row.eligible,
          row.orderStoreId,
          row.orderTestMode,
          row.orderVariantId,
          row.orderCurrency,
          row.orderTotalCents,
          row.orderSubtotalCents,
          row.orderItemPriceCents,
          row.buyerUserId,
          row.buyerEmail,
          row.pendingOrderId,
        ];
        const inserted = await p.query(INSERT_SQL, params);
        if (inserted.rows[0]) return { id: String(inserted.rows[0].id), status: String(inserted.rows[0].status), inserted: true };
        const existing = await p.query(SELECT_BY_HASH_SQL, [row.bodySha256]);
        // Neither inserted nor found: it is not stored, so it must not be acknowledged.
        if (!existing.rows[0]) throw new StoreNotReadyError("check_failed");
        return { id: String(existing.rows[0].id), status: String(existing.rows[0].status), inserted: false };
      } catch (err) {
        // Wrong credentials, missing privilege or database: this pool is not trusted until it is checked again.
        const code = sqlstate(err);
        if (code.startsWith("28") || code === "42501" || code === "3D000") {
          if (pool === p) isReady = false;
        }
        throw err;
      }
    },
    async close() {
      generation += 1;
      isReady = false;
      inflight = null;
      const p = pool;
      pool = null;
      if (p) await p.end();
    },
  };
}
