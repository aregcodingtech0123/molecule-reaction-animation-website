-- =============================================================================
-- MoleculeStudio — purchases that could not be credited because no account matched (db:reconcile section
-- `webhook_missing_user`; docs/ops/PRODUCTION_RUNBOOK.md §9)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: old code never reads or writes the new column.
--
-- An `order_created` delivery whose buyer cannot be matched to an account (custom_data.user_id missing or unknown, no
-- account with the buyer's e-mail - which includes an account that was deleted/anonymised, migration 017) is acknowledged
-- to Lemon with 200 and stored with outcome 'missing_user'. Nothing is credited, so the buyer has paid and received
-- nothing. Until now only a log line (`Missing user identity`) said so. This lists those deliveries, until the owner has
-- refunded the buyer in the Lemon dashboard and set reviewed_at.
--
-- NOT touched: the ledger, balances, post_credit_transaction(), the other review functions (ledger_reconciliation(),
-- refunded_orders_to_review(), webhook_events_to_review()) and what they list. This only adds a new, read-only list.
-- The list holds order ids and times - never the buyer's e-mail (the stored payload is cleared after 30 days anyway).
-- =============================================================================

ALTER TABLE lemon_webhook_events ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN lemon_webhook_events.reviewed_at IS
  'Owner marks an uncredited purchase (outcome missing_user) as handled - refunded in the Lemon dashboard - so db:reconcile stops listing it. NULL = not reviewed.';

CREATE INDEX IF NOT EXISTS idx_lemon_webhook_events_missing_user
  ON lemon_webhook_events (received_at)
  WHERE outcome = 'missing_user' AND reviewed_at IS NULL;

CREATE OR REPLACE FUNCTION webhook_missing_user_to_review()
RETURNS TABLE (
  id                BIGINT,
  event_name        TEXT,
  provider_order_id TEXT,
  received_at       TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.event_name::TEXT, e.provider_order_id::TEXT, e.received_at, e.processed_at
  FROM lemon_webhook_events e
  WHERE e.status = 'processed'
    AND e.outcome = 'missing_user'
    AND e.reviewed_at IS NULL
  ORDER BY e.received_at;
$$;

COMMENT ON FUNCTION webhook_missing_user_to_review() IS
  'Read-only: stored order_created events that credited nobody because no account matched (outcome missing_user), not yet reviewed. Printed by db:reconcile as webhook_missing_user.';
