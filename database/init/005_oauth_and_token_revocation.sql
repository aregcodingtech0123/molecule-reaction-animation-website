-- =============================================================================
-- MoleculeStudio — OAuth account linking + JWT revocation blacklist
-- Idempotent migration
-- =============================================================================

BEGIN;

-- ── OAuth provider accounts (stable identity = provider + provider_account_id) ─
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider             VARCHAR(32)  NOT NULL,
  provider_account_id  VARCHAR(255) NOT NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT oauth_accounts_provider_nonempty
    CHECK (length(trim(provider)) > 0),
  CONSTRAINT oauth_accounts_provider_account_id_nonempty
    CHECK (length(trim(provider_account_id)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_accounts_provider_account
  ON oauth_accounts (provider, provider_account_id);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id
  ON oauth_accounts (user_id);

COMMENT ON TABLE oauth_accounts IS
  'Links external IdP subjects (e.g. Google sub) to local users. Lookup by (provider, provider_account_id) — never by email alone.';

-- ── JWT blacklist (jti → expires_at). PK lookup is O(1) via heap/index. ───────
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         VARCHAR(64)  PRIMARY KEY,
  expires_at  TIMESTAMPTZ  NOT NULL
);

-- Supports periodic purge of expired rows without scanning the PK heap blindly.
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at
  ON revoked_tokens (expires_at);

COMMENT ON TABLE revoked_tokens IS
  'Server-side JWT revocation list. Middleware checks jti via primary-key lookup; rows past expires_at may be purged.';

COMMIT;
