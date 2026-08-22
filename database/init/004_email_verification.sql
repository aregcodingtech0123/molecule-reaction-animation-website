-- =============================================================================
-- MoleculeStudio — Email verification & password reset tokens
-- Idempotent migration
-- =============================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_verified IS
  'True after email ownership is proven (verification link or trusted OAuth).';

-- Grandfather pre-verification accounts that already received signup credits
UPDATE users u
SET is_verified = true
WHERE u.is_verified = false
  AND EXISTS (
    SELECT 1
    FROM credit_ledger_transactions t
    WHERE t.user_id = u.id
      AND t.transaction_type = 'SIGNUP_BONUS'
  );

CREATE TABLE IF NOT EXISTS verification_tokens (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  VARCHAR(64)  NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT verification_tokens_hash_len CHECK (length(token_hash) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_tokens_hash
  ON verification_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_user
  ON verification_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_expires
  ON verification_tokens (expires_at);

COMMENT ON TABLE verification_tokens IS
  'Hashed one-time email verification tokens (SHA-256 hex of raw token).';

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  VARCHAR(64)  NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT password_reset_tokens_hash_len CHECK (length(token_hash) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_tokens_hash
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
  ON password_reset_tokens (expires_at);

COMMENT ON TABLE password_reset_tokens IS
  'Hashed one-time password reset tokens (SHA-256 hex of raw token).';

COMMIT;
