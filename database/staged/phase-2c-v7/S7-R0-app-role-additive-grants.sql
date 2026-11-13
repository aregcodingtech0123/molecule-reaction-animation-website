-- =============================================================================
-- STAGED V7 CONTRACT ARTIFACT — step S7 (R0) — not applied by the migration runner — NOT production-approved
-- Staged as database/staged/phase-2c-v7/S7-R0-app-role-additive-grants.sql; source draft phase-2c-step-5-2-2-app-role-additive-grants-draft-v5.sql (sha256 b3dc400e6e29d0a5…, MANIFEST.json).
-- Purpose: R0 (draft V5): ADDITIVE grants for the new service build.
-- Execution status, three separate facts:
--   * Disposable PostgreSQL: the V7 verification executed a copy of this file in a disposable PostgreSQL 18.6 test database,
--     with the role prefix moleculestudio_ replaced by v7v_20261109_ (V7 substitution record).
--   * Original role names: this file as staged, with the moleculestudio_ role names, has not been executed anywhere.
--   * Production: not executed in production or in any other non-disposable database; not production-approved.
-- Only comments differ from the source draft; the executable SQL is frozen (MANIFEST.json strippedSha256).
-- =============================================================================
-- Why this file exists (failure DEP-1 of the V4 disposable verification):
--   In the V4 deployment order the new service build (step S8) calls the six narrow operations and reads the two policy tables, but
--   ONLY app-role v4/v5 (step S9, "R") grants those privileges — and R also REMOVES what the old build needs (post_credit_transaction,
--   UPDATE on holds, inbox INSERT). Executed result: as the app role BEFORE R, grant_signup_bonus, credit_verified_purchase,
--   capture_ai_hold, release_ai_hold, clear_processed_webhook_payloads and SELECT on credit_packages / ledger_policy all fail 42501.
--   So between S8 and S9 the new build cannot work and after S9 the old build cannot work: the order is not executable.
--
-- The change: grant the additive privileges EARLIER, in their own step, and keep R (restrictive) as the LAST step.
--     S6  W2 / A2
--     S7  THIS FILE (R0)  — additive only; the old build is unaffected (it ignores functions and tables it does not call)
--     S8  deploy the new build (old and new instances may run together before R; see the mixed-fleet note below)
--     S9  pre-R soak
--     S10 R (V7, S10-R-app-role-transition.sql) — removes the old privileges, only after NO old instance is running
-- Mixed-fleet note: V7 reclassified the timer-based mixed-build checks MV-7 / MV-8b as NOT TESTED for concurrency. Its gated
-- MIX-* rounds kept the data consistent but showed a pre-R deadlock hazard (the old path aborted with 40P01 in 6 of 12 new-first rounds).
-- It removes nothing and changes no other privilege. It is a strict subset of the GRANT statements in
-- S10-R-app-role-transition.sql (R V7), so running R afterwards is idempotent.
--
-- Written after the V4 verification run; V7 later executed a role-substituted copy of this file (see the banner above).
-- Preconditions are checked below; run as the owner of the tables. Does not create or alter any role.
-- Text constraints kept: never names the review table, never uses a schema-wide wildcard grant, never configures automatic grants.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moleculestudio_app') THEN
    RAISE EXCEPTION 'role moleculestudio_app does not exist' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('capture_ai_hold(uuid,character varying)') IS NULL OR to_regprocedure('credit_verified_purchase(bigint)') IS NULL
     OR to_regprocedure('grant_signup_bonus(uuid)') IS NULL OR to_regprocedure('release_ai_hold(uuid,character varying,text)') IS NULL
     OR to_regprocedure('clear_processed_webhook_payloads(interval)') IS NULL OR to_regprocedure('release_expired_ai_holds()') IS NULL
     OR to_regclass('public.credit_packages') IS NULL OR to_regclass('public.ledger_policy') IS NULL THEN
    RAISE EXCEPTION 'apply migration 022 first' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = 'public.ledger_policy'::regclass) IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'run as the owner of the policy tables' USING ERRCODE = '42501';
  END IF;
END
$$;

GRANT SELECT ON credit_packages, ledger_policy TO moleculestudio_app;
GRANT EXECUTE ON FUNCTION
  grant_signup_bonus(uuid),
  credit_verified_purchase(bigint),
  capture_ai_hold(uuid, character varying),
  release_ai_hold(uuid, character varying, text),
  clear_processed_webhook_payloads(interval),
  release_expired_ai_holds()
TO moleculestudio_app;

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(f, ', ') INTO v_bad FROM unnest(ARRAY[
    'grant_signup_bonus(uuid)', 'credit_verified_purchase(bigint)', 'capture_ai_hold(uuid,character varying)',
    'release_ai_hold(uuid,character varying,text)', 'clear_processed_webhook_payloads(interval)', 'release_expired_ai_holds()']) AS f
  WHERE NOT has_function_privilege('moleculestudio_app', f, 'EXECUTE') OR has_function_privilege('public', f, 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'EXECUTE state wrong for: %', v_bad USING ERRCODE = '42501'; END IF;
  IF NOT has_table_privilege('moleculestudio_app', 'public.credit_packages', 'SELECT') OR NOT has_table_privilege('moleculestudio_app', 'public.ledger_policy', 'SELECT')
     OR has_table_privilege('moleculestudio_app', 'public.credit_packages', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('moleculestudio_app', 'public.ledger_policy', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'policy tables must be SELECT-only for moleculestudio_app' USING ERRCODE = '42501';
  END IF;
END
$$;

COMMIT;
