-- =============================================================================
-- MoleculeStudio — Stale checkout expiry (FINDING-15)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: older code never calls it.
--
-- A pending_checkout_orders row is written before the Lemon Squeezy checkout is
-- created. The service now marks it 'failed' when that call fails; rows whose
-- checkout was created but never paid stay 'pending' until this function,
-- called on a schedule, marks them 'expired'. A late payment for an expired
-- row is still credited by the webhook (the row is then marked 'completed').
-- =============================================================================

CREATE OR REPLACE FUNCTION expire_stale_checkout_orders(
  p_older_than INTERVAL DEFAULT INTERVAL '24 hours'
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired INTEGER;
BEGIN
  IF p_older_than IS NULL OR p_older_than < INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'expire_stale_checkout_orders: p_older_than must be at least 1 hour (got %)', p_older_than
      USING ERRCODE = '22023';
  END IF;

  UPDATE pending_checkout_orders
     SET status = 'expired'
   WHERE status = 'pending'
     AND created_at < NOW() - p_older_than;

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

COMMENT ON FUNCTION expire_stale_checkout_orders(INTERVAL) IS
  'Marks pending checkout orders older than p_older_than (min 1 hour, default 24 hours) as expired; returns the count. Schedule it (see docs/ops/PRODUCTION_RUNBOOK.md).';

CREATE INDEX IF NOT EXISTS idx_pending_checkout_pending_created
  ON pending_checkout_orders (created_at)
  WHERE status = 'pending';
