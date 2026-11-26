/**
 * Provenance partition of the webhook inbox (Step 7.5 V8; owner decisions G-R1 Option B and F-1 Option A; audit finding F-2).
 *
 * Events stored by the separate ingestion process belong exclusively to the V8 consumer; the legacy claim and retry must never
 * take them. Provenance is `lemon_webhook_events.ingested_by` (migration 022: the database records who stored the row, column
 * default `current_user`). The V8 consumer takes `ingested_by <> current_user`; the legacy path takes the complement,
 * `ingested_by = current_user`, i.e. the rows the main service stored itself. The two predicates are exact complements.
 *
 * The column does not exist before migration 022, so the predicate cannot be written blindly. This module asks the catalogue:
 *  - column present  -> `v8`: the legacy path adds `ingested_by = current_user`;
 *  - column absent   -> `pre-022`: no ingestion process can have stored a row, nothing to partition;
 *  - anything else (the probe fails, the table is not found, the answer is malformed) -> the error is thrown. The caller's
 *    claim or selection fails and is retried on the next tick: a failed probe is NEVER read as permission to take every row.
 * `v8` is remembered for the life of the process (a column does not go away). `pre-022` is remembered for only a few seconds, so
 * a migration applied while the service runs is noticed at once; the residual window is documented in the contract (15.7).
 *
 * The OLD deployed builds contain none of this: they select every pending or failed row and cannot be given the partition
 * without being replaced (contract 15.7; the F3 and Q-D6 sequencing remains an explicit gate).
 */
import { pool } from "../db/index.js";

export type InboxProvenance = "pre-022" | "v8";

/** How long "the column is absent" is trusted. */
export const PRE_022_TTL_MS = 5_000;

export const PROVENANCE_PROBE_SQL = `SELECT to_regclass('public.lemon_webhook_events') IS NOT NULL AS table_present,
       EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.lemon_webhook_events')
                 AND attname = 'ingested_by' AND NOT attisdropped) AS has_ingested_by`;

let cache: { value: InboxProvenance; at: number } | null = null;

/** Tests only: forget what was learned. */
export function resetInboxProvenanceCache(): void {
  cache = null;
}

export async function inboxProvenance(now: () => number = Date.now): Promise<InboxProvenance> {
  if (cache?.value === "v8") return "v8";
  if (cache && now() - cache.at < PRE_022_TTL_MS) return cache.value;
  const { rows } = await pool.query<{ table_present: unknown; has_ingested_by: unknown }>(PROVENANCE_PROBE_SQL);
  const row = rows[0];
  if (!row || row.table_present !== true || typeof row.has_ingested_by !== "boolean") {
    throw new Error("inbox provenance could not be established");
  }
  cache = { value: row.has_ingested_by ? "v8" : "pre-022", at: now() };
  return cache.value;
}

/** SQL for the legacy claim and retry: only rows the main service stored itself (or every row, on a schema that has no ingestion). */
export async function legacyPartitionSql(): Promise<string> {
  return (await inboxProvenance()) === "v8" ? "ingested_by = current_user" : "TRUE";
}
