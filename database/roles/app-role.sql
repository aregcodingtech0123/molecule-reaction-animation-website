-- =============================================================================
-- MoleculeStudio — least-privilege application role (SEC-12, optional hardening)
--
-- NOT a migration: the runner never executes this file. Run it by hand as the
-- schema owner, AFTER `node scripts/migrate.mjs` (015 or later), then point the
-- auth-billing service's DATABASE_URL at the app role. Migrations, db:reconcile
-- and the scheduled SQL jobs keep using the owner role. See docs/security/DB_ROLES.md.
--
-- Create the login role first (Neon console, or):
--   CREATE ROLE moleculestudio_app LOGIN PASSWORD '<generated secret>';
--
-- Idempotent: safe to re-run. Re-run it after any migration that adds a table
-- the service uses; new tables get no grant by default (fail closed).
--
-- What the app role can NOT do (asserted by tests/api/app-role.test.ts):
--   UPDATE/DELETE/TRUNCATE the ledger or the balance cache, INSERT ledger rows
--   directly, disable triggers, read or write schema_migrations, create objects.
-- Credits move only through post_credit_transaction() (SECURITY DEFINER, 012).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moleculestudio_app') THEN
    RAISE EXCEPTION 'role moleculestudio_app does not exist — create it first (see the header)';
  END IF;
  IF to_regprocedure('post_credit_transaction(uuid,integer,credit_transaction_type,character varying,character varying)') IS NULL
     OR NOT (SELECT prosecdef FROM pg_proc
             WHERE oid = to_regprocedure('post_credit_transaction(uuid,integer,credit_transaction_type,character varying,character varying)')) THEN
    RAISE EXCEPTION 'post_credit_transaction() is not SECURITY DEFINER — apply migration 012 first';
  END IF;
END
$$;

-- Nobody but the owner creates objects in public (already the default on PostgreSQL 15+).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO moleculestudio_app;

-- Accounts and sessions.
GRANT SELECT, INSERT, UPDATE         ON users                                    TO moleculestudio_app;
GRANT SELECT, INSERT                 ON oauth_accounts                           TO moleculestudio_app;
-- UPDATE only for SELECT … FOR UPDATE row locks on the single-use tokens; rows are never updated.
GRANT SELECT, INSERT, UPDATE, DELETE ON verification_tokens, password_reset_tokens TO moleculestudio_app;
GRANT SELECT, INSERT, DELETE         ON revoked_tokens                           TO moleculestudio_app;

-- Checkout and AI reservations (status transitions only).
GRANT SELECT, INSERT, UPDATE         ON pending_checkout_orders, ai_credit_holds TO moleculestudio_app;

-- Money: read-only, plus the zero-balance row a new account starts with.
GRANT SELECT                         ON credit_ledger_transactions               TO moleculestudio_app;
GRANT SELECT, INSERT                 ON user_balances                            TO moleculestudio_app;
-- Lemon refunds (SEC-14, migration 013): the webhook records them; reviewing them is owner-only.
GRANT SELECT, INSERT                 ON lemon_order_refunds                      TO moleculestudio_app;
-- Lemon webhook inbox (R19, migration 015): stored before the 200, then status transitions and the
-- 30-day payload clean-up. Deleting stored events is owner-only.
GRANT SELECT, INSERT, UPDATE         ON lemon_webhook_events                     TO moleculestudio_app;

-- Account deletion (migration 017): registration looks up the keyed e-mail hash of anonymised accounts. Writing tombstones,
-- anonymising accounts and purging tombstones are owner-only (the daily db:process-deletions job).
GRANT SELECT                         ON deleted_email_tombstones                 TO moleculestudio_app;

GRANT EXECUTE ON FUNCTION
  post_credit_transaction(uuid, integer, credit_transaction_type, character varying, character varying),
  release_expired_ai_holds()
TO moleculestudio_app;

COMMIT;
