-- =============================================================================
-- MoleculeStudio — AI credit reservations (FINDING-03, FINDING-22)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run.
--
-- An AI operation is charged in two steps:
--   reserve  -> a 'held' row; balance and ledger untouched, but the amount is
--               excluded from the available balance so concurrent operations
--               cannot overspend.
--   capture  -> on success: status 'captured' + one CREDIT_CONSUMPTION ledger row.
--   release  -> on failure: status 'released'; nothing is ever written to the ledger.
-- A hold that is neither captured nor released before expires_at becomes
-- 'expired' (= never charged). A capture that reached the service but could not
-- debit is recorded as 'capture_failed'. Both are reported by
-- ledger_reconciliation(), so they are durable and countable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_credit_holds (
  user_id        UUID         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reference_id   VARCHAR(255) NOT NULL,
  operation_type VARCHAR(32)  NOT NULL,
  amount         INTEGER      NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'held',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ  NOT NULL,
  settled_at     TIMESTAMPTZ,
  ledger_id      BIGINT       REFERENCES credit_ledger_transactions (id),
  settle_reason  TEXT,

  PRIMARY KEY (user_id, reference_id),
  CONSTRAINT ai_credit_holds_amount_positive CHECK (amount > 0),
  CONSTRAINT ai_credit_holds_status_valid
    CHECK (status IN ('held', 'captured', 'released', 'expired', 'capture_failed')),
  CONSTRAINT ai_credit_holds_settlement_consistent CHECK (
    (status = 'held' AND settled_at IS NULL AND ledger_id IS NULL)
    OR (status = 'captured' AND settled_at IS NOT NULL AND ledger_id IS NOT NULL)
    OR (status IN ('released', 'expired', 'capture_failed') AND settled_at IS NOT NULL AND ledger_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_holds_active
  ON ai_credit_holds (user_id, expires_at)
  WHERE status = 'held';

CREATE INDEX IF NOT EXISTS idx_ai_credit_holds_expiry
  ON ai_credit_holds (expires_at)
  WHERE status = 'held';

COMMENT ON TABLE ai_credit_holds IS
  'AI credit reservations: held -> captured (ledger debit) | released | expired | capture_failed (never charged).';

-- Settle every held reservation past its expiry as 'expired' (never charged).
-- Called periodically by the service and safe to run by hand.
CREATE OR REPLACE FUNCTION release_expired_ai_holds()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE ai_credit_holds
  SET status = 'expired', settled_at = NOW(), settle_reason = 'expired_unsettled'
  WHERE status = 'held' AND expires_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION release_expired_ai_holds() IS
  'Marks held AI reservations past expires_at as expired (not charged). Returns the number settled.';

-- Reconciliation now also reports AI reservations that did not settle normally:
--   capture_failed        capture reached the service but the debit failed (durable)
--   hold_expired_unsettled neither capture nor release arrived before expiry (not charged;
--                          correlate reference_id with BFF logs CAPTURE_FAILED / RELEASE_FAILED)
-- (A captured hold always has its ledger row: enforced by the FK + settlement CHECK.)
CREATE OR REPLACE FUNCTION ledger_reconciliation()
RETURNS TABLE (
  issue          TEXT,
  user_id        UUID,
  cached_balance INTEGER,
  ledger_sum     BIGINT,
  difference     BIGINT,
  reference_id   TEXT,
  detail         TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH sums AS (
    SELECT t.user_id, SUM(t.amount)::BIGINT AS total
    FROM credit_ledger_transactions t
    GROUP BY t.user_id
  ),
  balance_issues AS (
    SELECT
      CASE WHEN b.user_id IS NULL THEN 'missing_balance_row' ELSE 'balance_mismatch' END AS issue,
      COALESCE(b.user_id, s.user_id) AS user_id,
      b.balance AS cached_balance,
      COALESCE(s.total, 0) AS ledger_sum,
      COALESCE(b.balance, 0) - COALESCE(s.total, 0) AS difference,
      NULL::TEXT AS reference_id,
      NULL::TEXT AS detail
    FROM user_balances b
    FULL OUTER JOIN sums s ON s.user_id = b.user_id
    WHERE b.user_id IS NULL
       OR b.balance <> COALESCE(s.total, 0)
  ),
  hold_issues AS (
    SELECT
      CASE WHEN h.status = 'capture_failed' THEN 'capture_failed' ELSE 'hold_expired_unsettled' END,
      h.user_id,
      NULL::INTEGER,
      NULL::BIGINT,
      h.amount::BIGINT,
      h.reference_id::TEXT,
      CONCAT(h.operation_type, ' · ', COALESCE(h.settle_reason, ''), ' · ', h.settled_at::TEXT)
    FROM ai_credit_holds h
    WHERE h.status IN ('capture_failed', 'expired')
  )
  SELECT * FROM balance_issues
  UNION ALL
  SELECT * FROM hold_issues
  ORDER BY 1, 2;
$$;

COMMENT ON FUNCTION ledger_reconciliation() IS
  'Read-only anomaly report: balance vs SUM(ledger) mismatches and AI reservations that did not settle normally. Empty = consistent.';
