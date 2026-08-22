-- =============================================================================
-- MoleculeStudio — User profile & role fields
-- Idempotent: safe to re-run on existing clusters
-- =============================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.first_name IS 'User given name.';
COMMENT ON COLUMN users.last_name IS 'User family name.';
COMMENT ON COLUMN users.date_of_birth IS 'Date of birth (DATE, no time component).';
COMMENT ON COLUMN users.is_admin IS 'Role flag — grants elevated access when true. Defaults to false.';

COMMIT;
