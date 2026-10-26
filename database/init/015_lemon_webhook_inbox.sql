-- =============================================================================
-- MoleculeStudio — durable inbox for Lemon Squeezy webhooks (R19)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: older code never reads it.
--
-- Every verified delivery is stored here (one INSERT) BEFORE the webhook answers
-- 200; fulfilment runs afterwards from the stored row. Before this, the webhook
-- answered 200 before any database work, so a fulfilment that failed (database
-- slow or down) was lost: Lemon never retries a delivery that got a 200. Now:
--   - stored  -> 200; processed at once, and retried by the service until done;
--   - not stored (database unavailable) -> 503, and Lemon retries the delivery.
--
-- Lemon sends no event id. A delivery is identified by the SHA-256 of its raw
-- (signed) body: retries and dashboard resends of the same event are the same
-- row; a different event about the same order is a new row. Crediting stays
-- idempotent per order in the ledger (`ls_order_<id>`), as before.
--
-- status: pending -> processing -> processed | failed (failed rows are retried
-- automatically up to the service's attempt limit, and always by
-- `npm run webhooks:replay`). `outcome` is what fulfilment reported (credited,
-- already_processed, amount_mismatch, ...). The payload (it holds the buyer's
-- e-mail) is cleared 30 days after an event was processed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lemon_webhook_events (
  id                BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  body_sha256       BYTEA        NOT NULL,
  event_name        VARCHAR(64)  NOT NULL,
  provider_order_id VARCHAR(64),
  payload           TEXT,         -- the verified raw body, exactly as signed (JSONB would refuse a NUL escape)
  status            VARCHAR(16)  NOT NULL DEFAULT 'pending',
  attempts          INTEGER      NOT NULL DEFAULT 0,
  outcome           VARCHAR(64),
  last_error        TEXT,
  received_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  claimed_at        TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ,

  CONSTRAINT lemon_webhook_events_status CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  CONSTRAINT lemon_webhook_events_attempts CHECK (attempts >= 0),
  CONSTRAINT lemon_webhook_events_processed CHECK ((status = 'processed') = (processed_at IS NOT NULL)),
  CONSTRAINT uq_lemon_webhook_events_body UNIQUE (body_sha256)
);

-- The retry worker and the reconcile report read only unfinished events.
CREATE INDEX IF NOT EXISTS idx_lemon_webhook_events_open
  ON lemon_webhook_events (received_at)
  WHERE status <> 'processed';

COMMENT ON TABLE lemon_webhook_events IS
  'Verified Lemon Squeezy deliveries, stored before the 200 and processed from here (R19).';

-- Stored events still not processed `p_grace` after they arrived: a delivery the service accepted
-- (Lemon will not resend it) whose credits may be missing. Read-only; `npm run db:reconcile` prints it,
-- `npm run webhooks:replay` processes them.
CREATE OR REPLACE FUNCTION webhook_events_to_review(p_grace INTERVAL DEFAULT INTERVAL '15 minutes')
RETURNS TABLE (
  id                BIGINT,
  event_name        TEXT,
  provider_order_id TEXT,
  status            TEXT,
  attempts          INTEGER,
  last_error        TEXT,
  received_at       TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.event_name::TEXT, e.provider_order_id::TEXT, e.status::TEXT, e.attempts, e.last_error, e.received_at
  FROM lemon_webhook_events e
  WHERE e.status <> 'processed'
    AND e.received_at < NOW() - p_grace
  ORDER BY e.received_at;
$$;

COMMENT ON FUNCTION webhook_events_to_review(INTERVAL) IS
  'Read-only: stored Lemon webhook events not processed within the grace period (R19).';
