/**
 * Owner-only review decisions on stored Lemon webhook events (V8 contract 17.6, 17.7; OD-1; Q-D1). The two statements are the
 * contract's text, unchanged; they run on the OWNER connection (the migration URL), because the V8 guard trigger refuses any
 * other role (I-1, Q-T1, Q-D5). The application never runs them. They need the V8 migration 022 (review columns): on an older
 * schema nothing runs. Whether reopening should instead be an owner-only database function is reviewer question Q-D7 (open);
 * these statements are the contract's current procedure.
 */
export const DISPOSITIONS = Object.freeze(["do_not_credit", "resolved"]);

/** 17.6: closes only an open review stop; no row means "not closable". */
export const CLOSE_REVIEW_SQL = `UPDATE lemon_webhook_events
   SET reviewed_at = now(), review_disposition = $2, review_note = $3
   WHERE id = $1 AND status = 'failed' AND reviewed_at IS NULL AND last_error LIKE 'review:%'
   RETURNING id::text`;

/** 17.7 with Q-D1: clears reviewed_at, the disposition and the stop marker; review_note is kept; status stays 'failed'. */
export const REOPEN_REVIEW_SQL = `UPDATE lemon_webhook_events
   SET reviewed_at = NULL, review_disposition = NULL, last_error = NULL
   WHERE id = $1 AND reviewed_at IS NOT NULL AND status = 'failed'
   RETURNING id::text`;

export const REVIEW_COLUMNS_PRESENT_SQL = `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('lemon_webhook_events')
                   AND attname = 'review_disposition' AND NOT attisdropped) AS present`;

const EVENT_ID = /^[1-9]\d{0,18}$/;
const MAX_NOTE = 1000;

export class ReviewDecisionError extends Error {}

function checkId(id) {
  if (!EVENT_ID.test(String(id))) throw new ReviewDecisionError("the event id must be a positive integer");
  return String(id);
}

async function requireReviewColumns(client) {
  const { rows } = await client.query(REVIEW_COLUMNS_PRESENT_SQL);
  if (!rows[0]?.present) throw new ReviewDecisionError("review columns are missing: this needs the V8 migration 022");
}

/** Returns true when the event was closed, false when it was not closable (not an open review stop). */
export async function closeReview(client, id, disposition, note) {
  const eventId = checkId(id);
  if (!DISPOSITIONS.includes(disposition)) throw new ReviewDecisionError(`disposition must be one of: ${DISPOSITIONS.join(", ")}`);
  const text = typeof note === "string" ? note.trim() : "";
  if (!text || text.length > MAX_NOTE) throw new ReviewDecisionError(`a note (decision and initials, at most ${MAX_NOTE} characters) is required`);
  await requireReviewColumns(client);
  const { rows } = await client.query(CLOSE_REVIEW_SQL, [eventId, disposition, text]);
  return rows.length === 1;
}

/** Returns true when the event was reopened, false when it was not reopenable (not a closed, failed event). */
export async function reopenReview(client, id) {
  const eventId = checkId(id);
  await requireReviewColumns(client);
  const { rows } = await client.query(REOPEN_REVIEW_SQL, [eventId]);
  return rows.length === 1;
}
