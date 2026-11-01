-- =============================================================================
-- MoleculeStudio — account deletion by anonymisation + re-registration guard
-- (docs/seo/ACCOUNT_DELETION_DESIGN.md, ACCOUNT_DELETION_IMPLEMENTATION.md)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: nothing in the old application calls it.
--
-- A user who ever bought or spent credits cannot be DELETEd (credit_ledger_transactions and
-- ai_credit_holds reference users ON DELETE RESTRICT, the ledger is immutable by trigger). Deletion is
-- therefore anonymisation of the users row: the id stays, so the ledger's foreign key,
-- ledger_reconciliation() and the audit trail stay true.
--
-- NOTHING here touches credit_ledger_transactions, user_balances, post_credit_transaction() or any of their
-- triggers. anonymise_user() never names those tables.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymised_at         TIMESTAMPTZ;

COMMENT ON COLUMN users.deletion_requested_at IS
  'When the user asked for deletion; the account is anonymised once this is 14 days old (db:process-deletions). NULL = no request.';
COMMENT ON COLUMN users.anonymised_at IS
  'When the account was anonymised (email replaced, profile/credentials removed). The row itself stays for the immutable ledger.';

CREATE INDEX IF NOT EXISTS idx_users_deletion_due
  ON users (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND anonymised_at IS NULL;

-- A keyed hash (HMAC-SHA256 with EMAIL_TOMBSTONE_SECRET, kept in the environment) of an anonymised user's e-mail:
-- registering the same address again creates a normal account without the signup bonus. The address itself is never stored.
CREATE TABLE IF NOT EXISTS deleted_email_tombstones (
  email_hmac BYTEA       PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deleted_email_tombstones_hmac_len CHECK (octet_length(email_hmac) = 32)
);

COMMENT ON TABLE deleted_email_tombstones IS
  'Keyed hashes of e-mails of anonymised accounts (signup-bonus guard). Pseudonymous personal data: removed after 12 months by purge_email_tombstones().';

CREATE INDEX IF NOT EXISTS idx_deleted_email_tombstones_created ON deleted_email_tombstones (created_at);

-- Anonymise one due account. Returns what happened and changes nothing unless it returns 'anonymised':
--   not_found | already | not_due | admin_skipped | busy | anonymised
--   busy = an unexpired AI hold ('held') or a 'pending' checkout order younger than 24 h: retried the next day.
-- SECURITY INVOKER; EXECUTE revoked from PUBLIC and not granted to the application role (owner / daily job only).
CREATE OR REPLACE FUNCTION anonymise_user(
  p_user_id       UUID,
  p_unusable_hash TEXT,
  p_email_hmac    BYTEA    DEFAULT NULL,
  p_grace         INTERVAL DEFAULT INTERVAL '14 days'
)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  u users%ROWTYPE;
BEGIN
  IF p_grace IS NULL OR p_grace < INTERVAL '1 day' THEN
    RAISE EXCEPTION 'anonymise_user: grace period must be at least 1 day (got %)', p_grace USING ERRCODE = '22023';
  END IF;
  IF p_unusable_hash IS NULL OR length(p_unusable_hash) < 20 THEN
    RAISE EXCEPTION 'anonymise_user: p_unusable_hash must be a password hash' USING ERRCODE = '22023';
  END IF;
  IF p_email_hmac IS NOT NULL AND octet_length(p_email_hmac) <> 32 THEN
    RAISE EXCEPTION 'anonymise_user: p_email_hmac must be 32 bytes' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO u FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF u.anonymised_at IS NOT NULL THEN RETURN 'already'; END IF;
  IF u.deletion_requested_at IS NULL OR u.deletion_requested_at > NOW() - p_grace THEN RETURN 'not_due'; END IF;
  IF u.is_admin THEN RETURN 'admin_skipped'; END IF;

  IF EXISTS (SELECT 1 FROM ai_credit_holds WHERE user_id = p_user_id AND status = 'held' AND expires_at > NOW())
     OR EXISTS (SELECT 1 FROM pending_checkout_orders
                WHERE user_id = p_user_id AND status = 'pending' AND created_at > NOW() - INTERVAL '24 hours') THEN
    RETURN 'busy';
  END IF;

  IF p_email_hmac IS NOT NULL THEN
    INSERT INTO deleted_email_tombstones (email_hmac) VALUES (p_email_hmac)
    ON CONFLICT (email_hmac) DO UPDATE SET created_at = NOW();
  END IF;

  UPDATE users
     SET email         = 'deleted-' || id::text || '@invalid',
         password_hash = p_unusable_hash,
         first_name    = NULL,
         last_name     = NULL,
         date_of_birth = NULL,
         signup_ip     = NULL,
         is_verified   = FALSE,
         token_version = token_version + 1,
         anonymised_at = NOW()
   WHERE id = p_user_id;

  DELETE FROM oauth_accounts        WHERE user_id = p_user_id;
  DELETE FROM verification_tokens   WHERE user_id = p_user_id;
  DELETE FROM password_reset_tokens WHERE user_id = p_user_id;

  RETURN 'anonymised';
END;
$$;

REVOKE EXECUTE ON FUNCTION anonymise_user(UUID, TEXT, BYTEA, INTERVAL) FROM PUBLIC;

COMMENT ON FUNCTION anonymise_user(UUID, TEXT, BYTEA, INTERVAL) IS
  'Anonymises a user whose deletion request is at least p_grace (default 14 days, minimum 1 day) old; returns not_found|already|not_due|admin_skipped|busy|anonymised. Never touches the ledger or balances. Owner / daily job only.';

-- Remove tombstones older than the retention (default 12 months, minimum 30 days); returns how many.
CREATE OR REPLACE FUNCTION purge_email_tombstones(p_retention INTERVAL DEFAULT INTERVAL '12 months')
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  removed INTEGER;
BEGIN
  IF p_retention IS NULL OR p_retention < INTERVAL '30 days' THEN
    RAISE EXCEPTION 'purge_email_tombstones: retention must be at least 30 days (got %)', p_retention USING ERRCODE = '22023';
  END IF;
  DELETE FROM deleted_email_tombstones WHERE created_at < NOW() - p_retention;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_email_tombstones(INTERVAL) FROM PUBLIC;

COMMENT ON FUNCTION purge_email_tombstones(INTERVAL) IS
  'Deletes e-mail tombstones older than the retention (default 12 months, minimum 30 days); returns the number removed. Owner / daily job only.';
