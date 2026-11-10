-- =============================================================================
-- DRAFT V5 — NOT APPLIED, NOT EXECUTED, NOT VERIFIED — REQUIRES EXPLICIT APPROVAL      (STEP R0: ADDITIVE grants for the new service build)
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
--     S6b THIS FILE (R0)  — additive only; the old build is unaffected (it ignores functions and tables it does not call)
--     S8  deploy the new build (old and new instances may run together; mixed-fleet capture was verified, MV-7 / MV-8b)
--     S9  R (V5) — removes the old privileges, only after NO old instance is running
-- It removes nothing and changes no other privilege. It is a strict subset of the GRANT statements in
-- app-role-sql-correction-draft-v5.sql, so running R afterwards is idempotent.
--
-- NOT VERIFIED: this file was written after the verification run and has never been parsed or executed.
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
