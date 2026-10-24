-- =============================================================================
-- MoleculeStudio — Session token version (FINDING-18, FINDING-34)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: older code ignores the column.
--
-- Every JWT carries the user's token_version as claim `tv`. Bumping the column
-- (password reset, Google sign-in taking over an unverified account) revokes
-- every session issued before. Tokens without `tv` are rejected by the service.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_token_version_non_negative'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_token_version_non_negative CHECK (token_version >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN users.token_version IS
  'Session generation. JWT claim tv must equal it; incremented to revoke all existing sessions.';
