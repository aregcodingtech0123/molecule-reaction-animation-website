-- =============================================================================
-- STAGED V7 CONTRACT ARTIFACT — step S10 (R) — POINT OF NO RETURN — not applied by the migration runner — NOT production-approved
-- Staged as database/staged/phase-2c-v7/S10-R-app-role-transition.sql; source draft phase-2c-step-5-2-2-app-role-sql-correction-draft-v7.sql (sha256 23c26808253da60b…, MANIFEST.json).
-- Purpose: R (draft V7): the application-role transition.
-- Execution status, three separate facts:
--   * Disposable PostgreSQL: the V7 verification executed a copy of this file in a disposable PostgreSQL 18.6 test database,
--     with the role prefix moleculestudio_ replaced by v7v_20261109_ (V7 substitution record).
--   * Original role names: this file as staged, with the moleculestudio_ role names, has not been executed anywhere.
--   * Production: not executed in production or in any other non-disposable database; not production-approved.
-- Only comments differ from the source draft; the executable SQL is frozen (MANIFEST.json strippedSha256).
-- POINT OF NO RETURN: apply only at S10, under a separately approved deployment plan, after the soak, with no old instance running.
-- =============================================================================
-- Separate transition artifact, not a replacement file: database/roles/app-role.sql stays unchanged until S10, is neutralised
-- or replaced at S10, and must never be re-run after R (it would grant back what R removes). Supersedes the v3 correction draft.
-- When the V4 text was written it had not been executed; this V7 text was later executed by V7 as a role-substituted copy
-- (see the execution status above). At the time of writing only text checks had been done: balanced dollar quoting, quotes and
-- parentheses; no transaction-control line outside the wrapper.
--
-- V5 CORRECTION (one change, found by the V4 disposable verification, failure F-1): the v4 text of the sequence-privilege assertion was
--   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND has_sequence_privilege(...)
-- PostgreSQL does not guarantee that the relkind test runs before the function, and has_sequence_privilege() raises 42809
-- ('... is not a sequence') for every non-sequence relation it is evaluated on (observed on a pg_toast table), which aborted the
-- whole script. v5 puts the call inside CASE WHEN c.relkind = 'S' THEN ... ELSE false END, whose branch order IS guaranteed.
-- Nothing else differs from v4.
--
-- V7 CORRECTION (one change, found by the V5 verification, observation F1-17, confirmed as a defect by the V6 final verification): the
-- sequence assertion tested only USAGE and UPDATE, but the documented policy is NO sequence privilege of any kind for the application role
-- (all three sequences are GENERATED ALWAYS AS IDENTITY columns: inserting roles need no sequence privilege, and every operation of the old and
-- new build ran with none). A SELECT-only privilege on a sequence (currval/lastval) was neither flagged nor revoked. v7 tests 'USAGE,SELECT,UPDATE'.
-- R still asserts rather than revokes sequence privileges (an unexpected privilege fails the script, it is not silently removed).
-- Nothing else differs from v5.
--
-- WHAT CHANGED FROM v3
--   * user_balances: INSERT is column-level (user_id, balance) and is safe only together with migration 022 v4, whose
--     trigger trg_user_balances_insert_guard refuses a non-zero opening balance from any role that is not the table owner
--     (finding A-01: v3 left SELECT, INSERT on the whole table, which let the application insert a row with any balance).
--     Note: the column default of balance is 10, so an INSERT that omits the balance is refused too; both services insert 0
--     explicitly (auth.service.ts:118, checkout.service.ts:242).
--   * SELECT on credit_packages and ledger_policy (D-5): the application CONSUMES the authoritative policy, it cannot write it.
--   * credit_verified_purchase now takes only the stored event id: credit_verified_purchase(bigint).
--   * lemon_webhook_events: unchanged from v3 (SELECT; UPDATE only on the six processing columns). Stored events come from the
--     ingest role (D-1); the eligibility, typed order columns and ingested_by are never writable here. Assertions strengthened.
--   * New assertions: no default ACL entry for this role or PUBLIC (a future table would otherwise start with a grant), no
--     membership either way with the other service roles, EVERY SECURITY DEFINER function in the schema is executable by this
--     role only if it is one of the six narrow operations, no sequence privilege, no ownership of any public object.
--
-- ORDER (deployment document): ... 022 -> service build using the narrow operations -> THIS file -> verification file.
-- Running this file before the new service build makes capture, release, purchase and signup fail with 42501 (fails closed, but an
-- outage); running it after migration 021/022 but with the OLD service build in place is the same hazard.
--
-- Text constraints kept (tests/unit/ai-delivery-tracking-migrations.test.ts): this file never names the review table, never
-- uses a schema-wide wildcard grant and never configures automatic grants for future objects.
--
-- NOT a migration: the runner never executes it. Run by hand as the schema owner. Idempotent: it revokes before it grants and
-- then asserts. Create the login role first (with SQL, never through a console that adds memberships):
--   CREATE ROLE moleculestudio_app LOGIN NOINHERIT PASSWORD '<generated secret>';
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moleculestudio_app') THEN
    RAISE EXCEPTION 'role moleculestudio_app does not exist — create it first (see the header)';
  END IF;
  IF to_regprocedure('capture_ai_hold(uuid,character varying)') IS NULL OR to_regprocedure('credit_verified_purchase(bigint)') IS NULL
     OR to_regprocedure('grant_signup_bonus(uuid)') IS NULL OR to_regprocedure('release_ai_hold(uuid,character varying,text)') IS NULL
     OR to_regprocedure('clear_processed_webhook_payloads(interval)') IS NULL OR to_regprocedure('release_expired_ai_holds()') IS NULL THEN
    RAISE EXCEPTION 'the narrow ledger operations are missing — apply migration 022 v4 first';
  END IF;
  IF to_regclass('public.credit_packages') IS NULL OR to_regclass('public.ledger_policy') IS NULL THEN
    RAISE EXCEPTION 'the policy tables are missing — apply migration 022 v4 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_balances'::regclass AND tgname = 'trg_user_balances_insert_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'the user_balances insert guard is missing or disabled — apply migration 022 v4 first (this file keeps INSERT on user_balances)';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.ai_credit_holds'::regclass AND NOT a.attisdropped
        AND a.attname IN ('delivery_tracking_enabled', 'answer_delivery_attempted_at')) <> 2 THEN
    RAISE EXCEPTION 'ai_credit_holds lacks the delivery columns — apply migration 019 first';
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO moleculestudio_app;

-- Accounts and sessions.
GRANT SELECT, INSERT, UPDATE         ON users                                    TO moleculestudio_app;
GRANT SELECT, INSERT                 ON oauth_accounts                           TO moleculestudio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON verification_tokens, password_reset_tokens TO moleculestudio_app;
GRANT SELECT, INSERT, DELETE         ON revoked_tokens                           TO moleculestudio_app;

-- Checkout orders (created and expired by the service; completion is done by credit_verified_purchase()).
GRANT SELECT, INSERT, UPDATE         ON pending_checkout_orders                  TO moleculestudio_app;

-- Authoritative policy (D-5): read only.
REVOKE ALL ON credit_packages, ledger_policy FROM moleculestudio_app;
GRANT SELECT ON credit_packages, ledger_policy TO moleculestudio_app;

-- AI reservations: read, and create a 'held' reservation. NO UPDATE: settlement only through the 022 operations.
REVOKE ALL            ON ai_credit_holds FROM PUBLIC;
REVOKE INSERT, UPDATE ON ai_credit_holds FROM moleculestudio_app;
GRANT SELECT          ON ai_credit_holds TO moleculestudio_app;
GRANT INSERT (user_id, reference_id, operation_type, amount, expires_at, delivery_tracking_enabled)
                      ON ai_credit_holds TO moleculestudio_app;

-- Money: read-only ledger; the cache row a new account starts with is created with a zero balance only (guard in 022).
REVOKE ALL                           ON credit_ledger_transactions FROM PUBLIC;
GRANT SELECT                         ON credit_ledger_transactions               TO moleculestudio_app;
REVOKE INSERT, UPDATE ON user_balances FROM moleculestudio_app;
GRANT SELECT                         ON user_balances                            TO moleculestudio_app;
GRANT INSERT (user_id, balance)      ON user_balances                            TO moleculestudio_app;
GRANT SELECT, INSERT                 ON lemon_order_refunds                      TO moleculestudio_app;

-- Lemon webhook inbox: read and move events through their states. Storing events belongs to the ingest role (D-1).
REVOKE ALL            ON lemon_webhook_events FROM PUBLIC;
REVOKE INSERT, UPDATE ON lemon_webhook_events FROM moleculestudio_app;
GRANT SELECT          ON lemon_webhook_events TO moleculestudio_app;
GRANT UPDATE (status, attempts, outcome, last_error, claimed_at, processed_at) ON lemon_webhook_events TO moleculestudio_app;

GRANT SELECT                         ON deleted_email_tombstones                 TO moleculestudio_app;

-- Functions: the general ledger writer is NOT executable by the application.
REVOKE EXECUTE ON FUNCTION post_credit_transaction(uuid, integer, credit_transaction_type, character varying, character varying) FROM moleculestudio_app;
GRANT EXECUTE ON FUNCTION
  grant_signup_bonus(uuid),
  credit_verified_purchase(bigint),
  capture_ai_hold(uuid, character varying),
  release_ai_hold(uuid, character varying, text),
  clear_processed_webhook_payloads(interval),
  release_expired_ai_holds()
TO moleculestudio_app;

-- -----------------------------------------------------------------------------
-- Assertions. has_*_privilege() includes table-level grants, PUBLIC, inherited (membership) privileges, ownership and superuser
-- status, so every bypass path is caught, not only the statements above.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad   TEXT;
  v_owner OID;
BEGIN
  -- ai_credit_holds: SELECT everywhere, INSERT on six columns, nothing else.
  SELECT string_agg(format('%s on %s expected=%s actual=%s', x.priv, x.col, x.expected, x.actual), '; ') INTO v_bad
  FROM (
    SELECT p.priv, a.attname::text AS col,
           CASE
             WHEN p.priv = 'SELECT' THEN true
             WHEN p.priv = 'INSERT'
               THEN a.attname::text = ANY (ARRAY['user_id', 'reference_id', 'operation_type', 'amount', 'expires_at', 'delivery_tracking_enabled'])
             ELSE false
           END AS expected,
           has_column_privilege('moleculestudio_app', 'public.ai_credit_holds', a.attname::text, p.priv) AS actual
    FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(priv)
    JOIN pg_attribute a ON a.attrelid = 'public.ai_credit_holds'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  ) x WHERE x.expected IS DISTINCT FROM x.actual;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'column privileges on ai_credit_holds differ from the contract: %', v_bad USING ERRCODE = '42501'; END IF;
  IF has_table_privilege('moleculestudio_app', 'public.ai_credit_holds', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'no table-level write privilege on ai_credit_holds' USING ERRCODE = '42501';
  END IF;

  -- user_balances: SELECT, INSERT of (user_id, balance) only; never UPDATE/DELETE/TRUNCATE.
  SELECT string_agg(format('%s on %s expected=%s actual=%s', x.priv, x.col, x.expected, x.actual), '; ') INTO v_bad
  FROM (
    SELECT p.priv, a.attname::text AS col,
           CASE WHEN p.priv = 'SELECT' THEN true
                WHEN p.priv = 'INSERT' THEN a.attname::text = ANY (ARRAY['user_id', 'balance'])
                ELSE false END AS expected,
           has_column_privilege('moleculestudio_app', 'public.user_balances', a.attname::text, p.priv) AS actual
    FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(priv)
    JOIN pg_attribute a ON a.attrelid = 'public.user_balances'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  ) x WHERE x.expected IS DISTINCT FROM x.actual;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'column privileges on user_balances differ from the contract: %', v_bad USING ERRCODE = '42501'; END IF;
  IF has_table_privilege('moleculestudio_app', 'public.user_balances', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') THEN
    RAISE EXCEPTION 'no table-level write privilege on user_balances' USING ERRCODE = '42501';
  END IF;

  -- policy tables: read only
  IF has_table_privilege('moleculestudio_app', 'public.credit_packages', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
     OR has_table_privilege('moleculestudio_app', 'public.ledger_policy', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
     OR has_any_column_privilege('moleculestudio_app', 'public.credit_packages', 'INSERT,UPDATE')
     OR has_any_column_privilege('moleculestudio_app', 'public.ledger_policy', 'INSERT,UPDATE')
     OR NOT has_table_privilege('moleculestudio_app', 'public.credit_packages', 'SELECT')
     OR NOT has_table_privilege('moleculestudio_app', 'public.ledger_policy', 'SELECT') THEN
    RAISE EXCEPTION 'policy tables must be SELECT-only for moleculestudio_app' USING ERRCODE = '42501';
  END IF;

  -- ledger: no write of any kind
  IF has_table_privilege('moleculestudio_app', 'public.credit_ledger_transactions', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
     OR has_any_column_privilege('moleculestudio_app', 'public.credit_ledger_transactions', 'INSERT,UPDATE') THEN
    RAISE EXCEPTION 'moleculestudio_app must not write the ledger' USING ERRCODE = '42501';
  END IF;

  -- inbox: no INSERT, no payload/eligibility/typed-column/ingested_by write
  SELECT string_agg(a.attname::text, ', ') INTO v_bad
  FROM pg_attribute a WHERE a.attrelid = 'public.lemon_webhook_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND (has_column_privilege('moleculestudio_app', 'public.lemon_webhook_events', a.attname::text, 'INSERT')
         OR (has_column_privilege('moleculestudio_app', 'public.lemon_webhook_events', a.attname::text, 'UPDATE')
             AND a.attname::text <> ALL (ARRAY['status', 'attempts', 'outcome', 'last_error', 'claimed_at', 'processed_at'])));
  IF v_bad IS NOT NULL OR has_table_privilege('moleculestudio_app', 'public.lemon_webhook_events', 'INSERT,DELETE,TRUNCATE,TRIGGER') THEN
    RAISE EXCEPTION 'moleculestudio_app may only move inbox events through states; offending columns: %', coalesce(v_bad, '(table level)') USING ERRCODE = '42501';
  END IF;

  -- functions: execute rights exactly the six narrow operations among all SECURITY DEFINER functions in the schema
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND (has_function_privilege('moleculestudio_app', p.oid, 'EXECUTE') <> (p.oid::regprocedure::text IN (
          'grant_signup_bonus(uuid)', 'credit_verified_purchase(bigint)', 'capture_ai_hold(uuid,character varying)',
          'release_ai_hold(uuid,character varying,text)', 'clear_processed_webhook_payloads(interval)', 'release_expired_ai_holds()'))
         AND (p.prosecdef OR p.proname IN ('post_credit_transaction', 'ledger_provenance_issues')));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'execute rights on definer/ledger functions differ from the contract: %', v_bad USING ERRCODE = '42501'; END IF;

  -- no sequence privileges (all keys are uuid or are assigned inside definer functions)
  SELECT string_agg(c.relname::text, ', ') INTO v_bad FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
    AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('moleculestudio_app', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'moleculestudio_app holds sequence privileges: %', v_bad USING ERRCODE = '42501'; END IF;

  -- ownership and membership
  SELECT c.relowner INTO v_owner FROM pg_class c WHERE c.oid = 'public.ai_credit_holds'::regclass;
  IF pg_has_role('moleculestudio_app', v_owner, 'USAGE') THEN
    RAISE EXCEPTION 'moleculestudio_app must not own, or be a member of the owner of, ai_credit_holds' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND pg_has_role('moleculestudio_app', c.relowner, 'USAGE'))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND pg_has_role('moleculestudio_app', p.proowner, 'USAGE')) THEN
    RAISE EXCEPTION 'moleculestudio_app owns (or is a member of the owner of) an object in the schema' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moleculestudio_app'
             AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'moleculestudio_app must not have SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'moleculestudio_app') THEN
    RAISE EXCEPTION 'moleculestudio_app must not be a member of any role' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles o WHERE o.rolname IN ('moleculestudio_ack', 'moleculestudio_webhook')
             AND (pg_has_role('moleculestudio_app', o.oid, 'MEMBER') OR pg_has_role(o.oid, 'moleculestudio_app'::regrole, 'MEMBER'))) THEN
    RAISE EXCEPTION 'moleculestudio_app and the ack/webhook roles must not be members of one another' USING ERRCODE = '42501';
  END IF;

  -- automatic grants for future objects: none naming this role or PUBLIC (pg_default_acl, any schema, any creator)
  SELECT string_agg(format('defaclrole=%s ns=%s type=%s', d.defaclrole::regrole, d.defaclnamespace, d.defaclobjtype), '; ') INTO v_bad
  FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
  WHERE a.grantee = 0 OR a.grantee = 'moleculestudio_app'::regrole;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'automatic grants exist for PUBLIC or moleculestudio_app: %', v_bad USING ERRCODE = '42501'; END IF;
END
$$;

COMMIT;
