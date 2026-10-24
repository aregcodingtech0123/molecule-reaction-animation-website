-- =============================================================================
-- MoleculeStudio — PostgreSQL Cluster Initialization
-- =============================================================================
-- Purpose : Auth identities, current credit balances, immutable ledger audit log
-- Idempotent: safe to re-run (IF NOT EXISTS / DO blocks throughout)
-- PostgreSQL 14+ recommended
-- =============================================================================

BEGIN;

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ── Enumerations ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_transaction_type') THEN
    CREATE TYPE credit_transaction_type AS ENUM (
      'SIGNUP_BONUS',
      'STRIPE_PURCHASE',
      'AI_GENERATION_DEDUCTION',
      'ADMIN_ADJUSTMENT',
      'REFUND'
    );
  END IF;
END
$$;

-- ── Utility: auto-maintain users.updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ── Utility: reject mutation of immutable ledger rows ─────────────────────────
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger_transactions is immutable — % is not permitted', TG_OP
    USING ERRCODE = '55000';
END;
$$;

-- =============================================================================
-- 1. USERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT users_email_not_empty CHECK (length(trim(email)) > 0),
  CONSTRAINT users_password_hash_not_empty CHECK (length(password_hash) > 0)
);

-- Case-insensitive unique email (fast login lookups)
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON users (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users (created_at DESC);

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  users IS 'Registered MoleculeStudio accounts (auth microservice).';
COMMENT ON COLUMN users.password_hash IS 'bcrypt/argon2 hash — never store plaintext passwords.';

-- Signup IP for abuse heuristics (S-16)
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip INET;
COMMENT ON COLUMN users.signup_ip IS 'Client IP at registration time — used for signup credit abuse heuristics.';

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.first_name IS 'User given name.';
COMMENT ON COLUMN users.last_name IS 'User family name.';
COMMENT ON COLUMN users.date_of_birth IS 'Date of birth (DATE, no time component).';
COMMENT ON COLUMN users.is_admin IS 'Role flag — grants elevated access when true. Defaults to false.';

-- =============================================================================
-- 2. USER_BALANCES (current wallet snapshot)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_balances (
  user_id UUID    PRIMARY KEY
          REFERENCES users (id)
          ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 10,

  CONSTRAINT user_balances_non_negative CHECK (balance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_user_balances_balance
  ON user_balances (balance)
  WHERE balance > 0;

COMMENT ON TABLE  user_balances IS 'Cached current credit balance per user (signup default: 10).';
COMMENT ON CONSTRAINT user_balances_non_negative ON user_balances
  IS 'Database-level guard: credits can never go negative.';

-- =============================================================================
-- 3. CREDIT_LEDGER_TRANSACTIONS (immutable audit trail)
-- =============================================================================
CREATE TABLE IF NOT EXISTS credit_ledger_transactions (
  id               BIGINT                   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          UUID                     NOT NULL
                   REFERENCES users (id)
                   ON DELETE RESTRICT,
  amount           INTEGER                  NOT NULL,
  transaction_type credit_transaction_type  NOT NULL,
  reference_id     VARCHAR(255),
  created_at       TIMESTAMPTZ              NOT NULL DEFAULT NOW(),

  CONSTRAINT credit_ledger_amount_non_zero CHECK (amount <> 0)
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_id
  ON credit_ledger_transactions (user_id);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created
  ON credit_ledger_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_type
  ON credit_ledger_transactions (transaction_type);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_reference_id
  ON credit_ledger_transactions (reference_id)
  WHERE reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at
  ON credit_ledger_transactions (created_at DESC);

-- Append-only enforcement
DROP TRIGGER IF EXISTS trg_credit_ledger_no_update ON credit_ledger_transactions;
CREATE TRIGGER trg_credit_ledger_no_update
  BEFORE UPDATE ON credit_ledger_transactions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_credit_ledger_no_delete ON credit_ledger_transactions;
CREATE TRIGGER trg_credit_ledger_no_delete
  BEFORE DELETE ON credit_ledger_transactions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ledger_mutation();

COMMENT ON TABLE  credit_ledger_transactions IS 'Immutable append-only ledger of every credit change.';
COMMENT ON COLUMN credit_ledger_transactions.amount IS 'Signed delta: positive = credit in (+100), negative = spend (-1).';
COMMENT ON COLUMN credit_ledger_transactions.reference_id IS 'External correlation ID (Stripe session, AI job, etc.).';

-- =============================================================================
-- 4. ATOMIC CREDIT POSTING (optional helper — ledger + balance in one TX)
-- =============================================================================
-- Legacy 4-argument version. 003 replaces it with the provider-aware 5-argument
-- function and drops this overload. It is only created on a brand-new database:
-- re-running 001 after 003 used to re-create it, leaving two overloads, and the
-- unqualified COMMENT ON FUNCTION then failed with 42725 (FINDING-02).
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'post_credit_transaction'
  ) THEN
    EXECUTE $create$
CREATE FUNCTION post_credit_transaction(
  p_user_id          UUID,
  p_amount           INTEGER,
  p_transaction_type credit_transaction_type,
  p_reference_id     VARCHAR DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $body$
DECLARE
  v_ledger_id BIGINT;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'amount must be non-zero' USING ERRCODE = '22023';
  END IF;

  -- Per-user advisory lock for the duration of this transaction
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

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
      RAISE EXCEPTION 'user_balances row missing for user % — create on signup first', p_user_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO credit_ledger_transactions (user_id, amount, transaction_type, reference_id)
  VALUES (p_user_id, p_amount, p_transaction_type, p_reference_id)
  RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$body$
    $create$;

    COMMENT ON FUNCTION post_credit_transaction(UUID, INTEGER, credit_transaction_type, VARCHAR) IS
      'Atomically append an immutable ledger row and adjust user_balances (advisory-locked).';
  END IF;
END
$do$;

COMMIT;

-- =============================================================================
-- Example usage (run manually after creating a user + balance row on signup)
-- =============================================================================
-- INSERT INTO users (email, password_hash) VALUES ('demo@molecule.studio', '$2b$...');
-- INSERT INTO user_balances (user_id) VALUES ('<user-uuid>');
-- SELECT post_credit_transaction('<user-uuid>'::uuid, 100, 'STRIPE_PURCHASE', 'cs_live_abc');
-- SELECT post_credit_transaction('<user-uuid>'::uuid, -1, 'AI_GENERATION_DEDUCTION', 'ai-run-xyz');
