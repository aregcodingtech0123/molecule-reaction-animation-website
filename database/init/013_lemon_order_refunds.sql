-- =============================================================================
-- MoleculeStudio — Lemon Squeezy refunds, recorded for manual review (SEC-14)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: older code never reads it.
--
-- The webhook stores every signed `order_refunded` event (full or partial) here.
-- Refunds NEVER touch the ledger: credits are not clawed back automatically
-- (owner decision). refunded_orders_to_review() lists refunded orders whose
-- purchase credits are in the ledger and that nobody has reviewed yet;
-- `npm run db:reconcile` prints it. Mark a review with:
--   UPDATE lemon_order_refunds SET reviewed_at = NOW(), review_note = '…'
--   WHERE provider_order_id = '<order id>' AND reviewed_at IS NULL;
--
-- Lemon sends no event id. One row per distinct refund state of an order
-- (status + cumulative refunded amount), so retries and replays are no-ops and
-- a later, larger partial refund is a new row.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lemon_order_refunds (
  id                  BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_order_id   VARCHAR(64)  NOT NULL,
  order_status        VARCHAR(32)  NOT NULL,
  fully_refunded      BOOLEAN      NOT NULL,
  refunded_amount     INTEGER      NOT NULL,
  refunded_amount_usd INTEGER,
  currency            VARCHAR(3)   NOT NULL,
  refunded_at         TIMESTAMPTZ,
  test_mode           BOOLEAN      NOT NULL DEFAULT FALSE,
  received_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,

  CONSTRAINT lemon_order_refunds_status CHECK (order_status IN ('refunded', 'partial_refund')),
  CONSTRAINT lemon_order_refunds_amount CHECK (refunded_amount >= 0),
  CONSTRAINT uq_lemon_order_refunds_state UNIQUE (provider_order_id, order_status, refunded_amount)
);

COMMENT ON TABLE lemon_order_refunds IS
  'Signed Lemon Squeezy order_refunded events (SEC-14). Never changes credits; reviewed by hand.';

CREATE OR REPLACE FUNCTION refunded_orders_to_review()
RETURNS TABLE (
  provider_order_id TEXT,
  user_id           UUID,
  credits           INTEGER,
  current_balance   INTEGER,
  order_status      TEXT,
  refunded_amount   INTEGER,
  currency          TEXT,
  refunded_at       TIMESTAMPTZ,
  test_mode         BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- Latest unreviewed refund state per order, joined to the purchase it credited.
  SELECT DISTINCT ON (r.provider_order_id)
    r.provider_order_id::TEXT,
    t.user_id,
    t.amount,
    b.balance,
    r.order_status::TEXT,
    r.refunded_amount,
    r.currency::TEXT,
    r.refunded_at,
    r.test_mode
  FROM lemon_order_refunds r
  JOIN credit_ledger_transactions t
    ON t.provider = 'lemonsqueezy'
   AND t.reference_id = 'ls_order_' || r.provider_order_id
   AND t.transaction_type = 'CREDIT_PURCHASE'
  LEFT JOIN user_balances b ON b.user_id = t.user_id
  WHERE r.reviewed_at IS NULL
  ORDER BY r.provider_order_id, r.refunded_amount DESC, r.received_at DESC;
$$;

COMMENT ON FUNCTION refunded_orders_to_review() IS
  'Read-only: refunded Lemon orders whose purchase credits are in the ledger and are not reviewed yet (SEC-14).';
