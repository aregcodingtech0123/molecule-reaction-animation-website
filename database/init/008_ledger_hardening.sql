-- =============================================================================
-- MoleculeStudio — Ledger hardening (FINDING-05)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run.
--
-- 1. TRUNCATE is blocked on the ledger and on the balance projection
--    (row-level triggers never fire for TRUNCATE).
-- 2. user_balances.balance may only change through post_credit_transaction(),
--    which sets the transaction-local flag `moleculestudio.ledger_write`.
--    This guards against application/accidental writes; it is NOT a privilege
--    boundary (any session can set the flag). The privilege boundary is a role
--    split — see docs/ops/PRODUCTION_RUNBOOK.md.
--    The trigger is AFTER UPDATE so CHECK violations keep their own SQLSTATE.
--    INSERT (zero-balance row at signup) and DELETE (user cascade) are unchanged.
-- 3. ledger_reconciliation() reports cache/ledger mismatches (read-only).
-- =============================================================================

DROP TRIGGER IF EXISTS trg_credit_ledger_no_truncate ON credit_ledger_transactions;
CREATE TRIGGER trg_credit_ledger_no_truncate
  BEFORE TRUNCATE ON credit_ledger_transactions
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION guard_user_balance_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'user_balances cannot be truncated' USING ERRCODE = '55000';
  END IF;

  IF COALESCE(current_setting('moleculestudio.ledger_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'user_balances.balance can only change through post_credit_transaction()'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_balances_write_guard ON user_balances;
CREATE TRIGGER trg_user_balances_write_guard
  AFTER UPDATE OF balance ON user_balances
  FOR EACH ROW
  WHEN (OLD.balance IS DISTINCT FROM NEW.balance)
  EXECUTE FUNCTION guard_user_balance_write();

DROP TRIGGER IF EXISTS trg_user_balances_no_truncate ON user_balances;
CREATE TRIGGER trg_user_balances_no_truncate
  BEFORE TRUNCATE ON user_balances
  FOR EACH STATEMENT
  EXECUTE FUNCTION guard_user_balance_write();

-- Same definition as 003 (kept identical so re-running 003 cannot downgrade it).
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

COMMENT ON FUNCTION post_credit_transaction(UUID, INTEGER, credit_transaction_type, VARCHAR, VARCHAR) IS
  'Atomically append an immutable ledger row and adjust user_balances (advisory-locked; the only permitted balance writer).';

-- Rows describe a problem; an empty result means the cache matches the ledger.
--   balance_mismatch     cached balance <> SUM(ledger)
--   missing_balance_row  ledger rows exist but no user_balances row
-- (009 adds capture_failed for AI credit holds.)
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
  )
  SELECT
    CASE WHEN b.user_id IS NULL THEN 'missing_balance_row' ELSE 'balance_mismatch' END,
    COALESCE(b.user_id, s.user_id),
    b.balance,
    COALESCE(s.total, 0),
    COALESCE(b.balance, 0) - COALESCE(s.total, 0),
    NULL::TEXT,
    NULL::TEXT
  FROM user_balances b
  FULL OUTER JOIN sums s ON s.user_id = b.user_id
  WHERE b.user_id IS NULL
     OR b.balance <> COALESCE(s.total, 0)
  ORDER BY 2;
$$;

COMMENT ON FUNCTION ledger_reconciliation() IS
  'Read-only report of users whose cached balance differs from SUM(ledger). Empty = consistent.';
