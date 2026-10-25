-- =============================================================================
-- MoleculeStudio — Function hardening (SEC-12)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: behaviour is unchanged while
-- one role owns the schema and runs the app.
--
-- 1. post_credit_transaction() — the only writer of the ledger and the balance
--    cache — runs with its owner's rights (SECURITY DEFINER) and is executable
--    only by roles granted it (EXECUTE revoked from PUBLIC; the owner keeps it).
--    With the role split in database/roles/app-role.sql the app role posts
--    credits through it while holding no UPDATE/DELETE/TRUNCATE on the tables.
-- 2. Every project function that touches a relation resolves names through a
--    pinned search_path, so a caller cannot redirect what it reads or writes by
--    putting another schema first. set_updated_at() and prevent_ledger_mutation()
--    (001) are left as they are: invoker-rights triggers that reference no
--    relation, and 001 is frozen (checksummed), so re-running it would reset them.
--
-- Any later migration that redefines one of these functions with CREATE OR
-- REPLACE must repeat SET search_path (and SECURITY DEFINER for the ledger
-- writer); tests/db/function-hardening.test.ts fails otherwise. Re-running 003 by
-- hand rebuilds post_credit_transaction() without them: re-run this file after it.
-- =============================================================================

DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'guard_user_balance_write()',
    'ledger_reconciliation()',
    'release_expired_ai_holds()',
    'expire_stale_checkout_orders(interval)',
    'post_credit_transaction(uuid,integer,credit_transaction_type,character varying,character varying)'
  ]
  LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', to_regprocedure(fn));
    END IF;
  END LOOP;
END
$$;

ALTER FUNCTION post_credit_transaction(uuid, integer, credit_transaction_type, character varying, character varying)
  SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION post_credit_transaction(uuid, integer, credit_transaction_type, character varying, character varying)
  FROM PUBLIC;
