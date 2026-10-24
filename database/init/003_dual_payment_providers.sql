-- =============================================================================
-- MoleculeStudio — Lemon Squeezy payment provider + pending checkouts
-- Idempotent migration — safe to re-run
-- =============================================================================

BEGIN;

-- Broaden purchase enum (keep STRIPE_PURCHASE for historical rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'credit_transaction_type' AND e.enumlabel = 'CREDIT_PURCHASE'
  ) THEN
    ALTER TYPE credit_transaction_type ADD VALUE 'CREDIT_PURCHASE';
  END IF;
END
$$;

ALTER TABLE credit_ledger_transactions
  ADD COLUMN IF NOT EXISTS provider VARCHAR(32);

COMMENT ON COLUMN credit_ledger_transactions.provider IS
  'Payment provider for purchases: lemonsqueezy (null for bonuses/deductions; legacy values may exist).';
COMMENT ON COLUMN credit_ledger_transactions.reference_id IS
  'External correlation ID — Lemon Squeezy order id, AI job id, etc.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_provider_reference
  ON credit_ledger_transactions (provider, reference_id)
  WHERE provider IS NOT NULL AND reference_id IS NOT NULL;

-- Pending checkouts (Lemon order ↔ user/package mapping)
CREATE TABLE IF NOT EXISTS pending_checkout_orders (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  package_id    VARCHAR(64)  NOT NULL,
  provider      VARCHAR(32)  NOT NULL,
  currency      VARCHAR(8)   NOT NULL,
  amount_minor  INTEGER      NOT NULL,
  credits       INTEGER      NOT NULL,
  status        VARCHAR(32)  NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,

  CONSTRAINT pending_checkout_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT pending_checkout_credits_positive CHECK (credits > 0),
  CONSTRAINT pending_checkout_status_valid CHECK (status IN ('pending', 'completed', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_pending_checkout_user_status
  ON pending_checkout_orders (user_id, status);

CREATE INDEX IF NOT EXISTS idx_pending_checkout_created
  ON pending_checkout_orders (created_at DESC);

COMMENT ON TABLE pending_checkout_orders IS
  'Maps provider checkout initiations to user/package before webhook fulfillment.';

-- Replace poster: drop prior 4-arg overload so provider becomes first-class
DROP FUNCTION IF EXISTS post_credit_transaction(UUID, INTEGER, credit_transaction_type, VARCHAR);

CREATE OR REPLACE FUNCTION post_credit_transaction(
  p_user_id          UUID,
  p_amount           INTEGER,
  p_transaction_type credit_transaction_type,
  p_reference_id     VARCHAR DEFAULT NULL,
  p_provider         VARCHAR DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_ledger_id BIGINT;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'amount must be non-zero' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Lets the user_balances write guard (008) accept this update; cleared below.
  PERFORM set_config('moleculestudio.ledger_write', 'on', true);

  IF p_amount < 0 THEN
    UPDATE user_balances
    SET balance = balance + p_amount
    WHERE user_id = p_user_id
      AND balance + p_amount >= 0;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient credits for user %', p_user_id
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    UPDATE user_balances
    SET balance = balance + p_amount
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
      INSERT INTO user_balances (user_id, balance) VALUES (p_user_id, p_amount)
      ON CONFLICT (user_id) DO UPDATE SET balance = user_balances.balance + EXCLUDED.balance;
    END IF;
  END IF;

  PERFORM set_config('moleculestudio.ledger_write', 'off', true);

  INSERT INTO credit_ledger_transactions (
    user_id, amount, transaction_type, reference_id, provider
  )
  VALUES (
    p_user_id, p_amount, p_transaction_type, p_reference_id, p_provider
  )
  RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$;

COMMIT;
