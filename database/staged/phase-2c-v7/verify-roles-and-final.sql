-- =============================================================================
-- STAGED V7 CONTRACT ARTIFACT — step verification (S3 roles_created, S10 final) — not applied by the migration runner — NOT production-approved
-- Staged as database/staged/phase-2c-v7/verify-roles-and-final.sql; source draft phase-2c-step-5-2-2-migration-021-deployment-role-draft-v7.sql (sha256 a88de6de1299c86a…, MANIFEST.json).
-- Purpose: V (draft V7): read-only verification of ALL service roles, NO DDL, NO GRANT.
-- Execution status, three separate facts:
--   * Disposable PostgreSQL: the V7 verification executed a copy of this file in a disposable PostgreSQL 18.6 test database,
--     with the role prefix moleculestudio_ replaced by v7v_20261109_ (V7 substitution record).
--   * Original role names: this file as staged, with the moleculestudio_ role names, has not been executed anywhere.
--   * Production: not executed in production or in any other non-disposable database; not production-approved.
-- Only comments differ from the source draft; the executable SQL is frozen (MANIFEST.json strippedSha256).
-- =============================================================================
-- Staged as verify-roles-and-final.sql (source draft name migration-021-deployment-role-draft-v7.sql). Why the draft kept that name but no longer creates or grants:
-- D-12 forbids a combined create+grant script. The V3 file of this name created the ack and webhook roles AND granted
-- privileges. In V4 those responsibilities are separate, explicitly ordered files:
--     W1 webhook-role-creation   W2 webhook-role-privileges   A1 ack-role-creation   A2 ack-role-deployment (privileges)
--     R  app-role-sql-correction (restrictions on the application role)
-- and THIS file only VERIFIES the combined result. It changes nothing: every statement is a SELECT inside a READ ONLY
-- transaction; a failed check raises an exception (so a deployment script stops), and a report is printed at the end.
--
-- V5 CORRECTION (failure F-2 of the V4 disposable verification): ledger_reconciliation() was removed from the EXECUTE-matrix name list.
-- It is an existing SECURITY INVOKER function (migration 008/009) that is deliberately executable by PUBLIC; executing it as the webhook or
-- ack role fails 42501 on user_balances, so it exposes nothing. The v4 text treated that as a violation and made the final stage unpassable.
--
-- V6 CORRECTION (failure F-2b of the V5 disposable verification): the V4/V5 final stage did not detect an UNEXPECTED READ privilege held
-- by the webhook or acknowledgement role on a relation outside its contract (executed: SELECT on credit_ledger_transactions granted to
-- moleculestudio_webhook -> V5 PASSED). It checked ledger WRITES, user_balances, holds and the inbox columns only, while the grant
-- scripts W2/A2 had a general 'reaches other relations' assertion that the final stage lacked. V6 adds the same general assertion
-- to the final stage: the webhook role may reach only lemon_webhook_events, the acknowledgement role only ai_credit_holds.
-- Nothing else differs from V5 (V5 = V4 + removal of ledger_reconciliation from the EXECUTE-matrix list).
--
-- V7 CORRECTION (findings of the V6 final verification, fixture family X-V6-*: SEVEN dangerous states were NOT detected by V6). V6 compared the
-- webhook and acknowledgement roles with their contract only column by column on the contract relation and, in a general assertion, for OTHER relations
-- with the table privileges SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER. So these passed: DELETE or TRUNCATE on the contract relation
-- (webhook on lemon_webhook_events, ack on ai_credit_holds); SELECT of an ack column outside its nine; USAGE on a sequence (USAGE is not one of the table
-- privileges that general assertion lists); and ANY sequence privilege of the application role (finding F1-17).
-- V7 adds, in the final stage:
--   (a) NO privilege of any kind (USAGE, SELECT, UPDATE) on any sequence for the application, webhook and acknowledgement roles;
--   (b) NO table-level privilege at all for the webhook role on lemon_webhook_events and for the acknowledgement role on ai_credit_holds
--       (their privileges are column-level only, as granted by the W2 and A2 drafts);
--   (c) the acknowledgement role can SELECT exactly its nine columns and no other.
-- Nothing else differs from V6 (V6 = V4 + removal of ledger_reconciliation from the EXECUTE-matrix list + the general contract assertion).
--
-- Execution status: see the banner above. Run it after EACH stage and at the end:
--     SET moleculestudio.verify_stage = 'roles_created';   -- after W1 and A1: attributes, memberships, ownership only
--     SET moleculestudio.verify_stage = 'final';           -- default: everything, including privilege matrices
-- Run as any role that can read the catalogs (the schema owner is typical). No password and no connection string appears here.
--
-- What it proves for each role (webhook, ack, app):
--   attributes (LOGIN, not SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS), memberships (none, none between service roles),
--   ownership (owns nothing in schema public, is not a member of an owner), default ACLs (no automatic grants to PUBLIC or to a
--   service role), exact table/column privilege matrices on the sensitive tables, exact EXECUTE rights on every function that is
--   SECURITY DEFINER or touches the ledger, PUBLIC exposure, and definer-function hygiene (owner, pinned search_path).
-- What it does NOT prove: that the passwords/connection strings are isolated per component (an operational property, see the
-- deployment document), that pg_hba.conf requires password authentication, or that a superuser/owner cannot bypass a guard.
-- =============================================================================

BEGIN READ ONLY;

DO $$
DECLARE
  v_stage   TEXT := coalesce(nullif(current_setting('moleculestudio.verify_stage', true), ''), 'final');
  v_roles   TEXT[] := ARRAY['moleculestudio_app', 'moleculestudio_webhook', 'moleculestudio_ack'];
  v_role    TEXT;
  v_bad     TEXT;
  v_owner   OID;
BEGIN
  IF v_stage NOT IN ('roles_created', 'final') THEN
    RAISE EXCEPTION 'moleculestudio.verify_stage must be roles_created or final (got %)', v_stage USING ERRCODE = '22023';
  END IF;

  FOREACH v_role IN ARRAY v_roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      RAISE EXCEPTION 'role % does not exist', v_role USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role
               AND (NOT rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'role % must be LOGIN and have no SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS', v_role USING ERRCODE = '42501';
    END IF;
    -- NOINHERIT is created for new roles (W1, A1) but NOT enforced here: with no memberships (checked below) INHERIT has no
    -- effect, and failing a deployment on a pre-existing INHERIT application role would block it for no security gain. The
    -- report at the end prints the attribute.
    IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = v_role::regrole) THEN
      RAISE EXCEPTION 'role % must not be a member of any role', v_role USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = v_role::regrole) THEN
      RAISE EXCEPTION 'role % must not have members', v_role USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = v_role::regrole)
       OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proowner = v_role::regrole)
       OR EXISTS (SELECT 1 FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typowner = v_role::regrole) THEN
      RAISE EXCEPTION 'role % owns an object in schema public', v_role USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND d.datdba = v_role::regrole)
       OR has_database_privilege(v_role, current_database(), 'CREATE')
       OR has_schema_privilege(v_role, 'public', 'CREATE') THEN
      RAISE EXCEPTION 'role % can create objects in the database or schema, or owns the database', v_role USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- automatic grants for future objects: none for PUBLIC or any service role
  SELECT string_agg(format('definer=%s ns=%s type=%s', d.defaclrole::regrole, d.defaclnamespace, d.defaclobjtype), '; ') INTO v_bad
  FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
  WHERE a.grantee = 0 OR a.grantee IN ('moleculestudio_app'::regrole, 'moleculestudio_webhook'::regrole, 'moleculestudio_ack'::regrole);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'automatic grants exist for PUBLIC or a service role: %', v_bad USING ERRCODE = '42501'; END IF;

  IF v_stage = 'roles_created' THEN
    -- a freshly created role holds no table privilege yet
    SELECT string_agg(r.rolname || ':' || c.relname, ', ') INTO v_bad
    FROM pg_roles r, pg_class c
    WHERE r.rolname = ANY (v_roles) AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND r.rolname IN ('moleculestudio_webhook', 'moleculestudio_ack')
      AND (has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR has_any_column_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'));
    IF v_bad IS NOT NULL AND current_setting('moleculestudio.verify_allow_existing_grants', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'roles_created stage: privileges already present (re-run of a later stage?): % (set moleculestudio.verify_allow_existing_grants = on to ignore)', v_bad USING ERRCODE = '55000';
    END IF;
    RETURN;
  END IF;

  ------------------------------------------------------------------ final stage ------------------------------------------
  SELECT c.relowner INTO v_owner FROM pg_class c WHERE c.oid = 'public.credit_ledger_transactions'::regclass;
  -- one owner for the ledger, the holds, the inbox, the balances and the policy tables
  IF (SELECT count(DISTINCT c.relowner) FROM pg_class c WHERE c.oid IN
        ('public.credit_ledger_transactions'::regclass, 'public.ai_credit_holds'::regclass, 'public.lemon_webhook_events'::regclass,
         'public.user_balances'::regclass, 'public.credit_packages'::regclass, 'public.ledger_policy'::regclass)) <> 1 THEN
    RAISE EXCEPTION 'the ledger, holds, inbox, balances and policy tables must share one owner' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid = v_owner AND rolname = ANY (v_roles)) THEN
    RAISE EXCEPTION 'a service role owns the ledger tables' USING ERRCODE = '42501';
  END IF;

  -- ledger: nobody but the owner writes it
  FOREACH v_role IN ARRAY v_roles LOOP
    IF has_table_privilege(v_role, 'public.credit_ledger_transactions', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
       OR has_any_column_privilege(v_role, 'public.credit_ledger_transactions', 'INSERT,UPDATE') THEN
      RAISE EXCEPTION '% can write the ledger', v_role USING ERRCODE = '42501';
    END IF;
    IF has_table_privilege(v_role, 'public.credit_packages', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
       OR has_table_privilege(v_role, 'public.ledger_policy', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
       OR has_any_column_privilege(v_role, 'public.credit_packages', 'INSERT,UPDATE')
       OR has_any_column_privilege(v_role, 'public.ledger_policy', 'INSERT,UPDATE') THEN
      RAISE EXCEPTION '% can write the policy tables', v_role USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF has_table_privilege('public', 'public.credit_ledger_transactions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('public', 'public.ai_credit_holds', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('public', 'public.lemon_webhook_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('public', 'public.user_balances', 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
     OR has_table_privilege('public', 'public.credit_packages', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('public', 'public.ledger_policy', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'PUBLIC holds a privilege on a sensitive table' USING ERRCODE = '42501';
  END IF;

  -- user_balances: webhook and ack have nothing; app has SELECT and INSERT(user_id, balance)
  IF has_any_column_privilege('moleculestudio_webhook', 'public.user_balances', 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('moleculestudio_ack', 'public.user_balances', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'webhook/ack reach user_balances' USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(a.attname::text, ', ') INTO v_bad FROM pg_attribute a
  WHERE a.attrelid = 'public.user_balances'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND (has_column_privilege('moleculestudio_app', 'public.user_balances', a.attname::text, 'UPDATE')
         OR (has_column_privilege('moleculestudio_app', 'public.user_balances', a.attname::text, 'INSERT') AND a.attname::text <> ALL (ARRAY['user_id', 'balance'])));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'app has excess user_balances column privileges: %', v_bad USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_balances'::regclass AND tgname = 'trg_user_balances_insert_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'trg_user_balances_insert_guard missing or disabled' USING ERRCODE = '55000';
  END IF;

  -- holds: app SELECT + 6-column INSERT, ack 9-column SELECT + 1-column UPDATE, webhook nothing
  IF has_any_column_privilege('moleculestudio_webhook', 'public.ai_credit_holds', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'webhook reaches ai_credit_holds' USING ERRCODE = '42501';
  END IF;
  IF has_any_column_privilege('moleculestudio_app', 'public.ai_credit_holds', 'UPDATE') THEN
    RAISE EXCEPTION 'app can UPDATE ai_credit_holds' USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(a.attname::text, ', ') INTO v_bad FROM pg_attribute a
  WHERE a.attrelid = 'public.ai_credit_holds'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND ((has_column_privilege('moleculestudio_ack', 'public.ai_credit_holds', a.attname::text, 'UPDATE') AND a.attname::text <> 'answer_delivery_attempted_at')
         OR has_column_privilege('moleculestudio_ack', 'public.ai_credit_holds', a.attname::text, 'INSERT'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'ack has excess ai_credit_holds privileges: %', v_bad USING ERRCODE = '42501'; END IF;

  -- inbox: webhook = SELECT(id, body_sha256, status) + INSERT(15 columns); app = SELECT + UPDATE(6); ack nothing
  IF has_any_column_privilege('moleculestudio_ack', 'public.lemon_webhook_events', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'ack reaches the inbox' USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(a.attname::text, ', ') INTO v_bad FROM pg_attribute a
  WHERE a.attrelid = 'public.lemon_webhook_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND (has_column_privilege('moleculestudio_webhook', 'public.lemon_webhook_events', a.attname::text, 'UPDATE')
         OR has_column_privilege('moleculestudio_webhook', 'public.lemon_webhook_events', a.attname::text, 'REFERENCES')
         OR (has_column_privilege('moleculestudio_webhook', 'public.lemon_webhook_events', a.attname::text, 'SELECT') AND a.attname::text <> ALL (ARRAY['id', 'body_sha256', 'status']))
         OR (has_column_privilege('moleculestudio_webhook', 'public.lemon_webhook_events', a.attname::text, 'INSERT')
             AND a.attname::text <> ALL (ARRAY['body_sha256', 'event_name', 'provider_order_id', 'payload', 'eligible', 'order_store_id', 'order_test_mode', 'order_variant_id',
                                                'order_currency', 'order_total_cents', 'order_subtotal_cents', 'order_item_price_cents', 'buyer_user_id', 'buyer_email', 'pending_order_id'])));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'webhook inbox privileges exceed the contract: %', v_bad USING ERRCODE = '42501'; END IF;
  SELECT string_agg(a.attname::text, ', ') INTO v_bad FROM pg_attribute a
  WHERE a.attrelid = 'public.lemon_webhook_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND (has_column_privilege('moleculestudio_app', 'public.lemon_webhook_events', a.attname::text, 'INSERT')
         OR (has_column_privilege('moleculestudio_app', 'public.lemon_webhook_events', a.attname::text, 'UPDATE')
             AND a.attname::text <> ALL (ARRAY['status', 'attempts', 'outcome', 'last_error', 'claimed_at', 'processed_at'])));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'app inbox privileges exceed the contract: %', v_bad USING ERRCODE = '42501'; END IF;

  -- (v6) the webhook and acknowledgement roles reach NOTHING outside their contract relation (any privilege, table or column level)
  SELECT string_agg(r.rolname || ' -> ' || c.relname, ', ') INTO v_bad
  FROM pg_roles r, pg_class c
  WHERE r.rolname IN ('moleculestudio_webhook', 'moleculestudio_ack') AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND NOT ((r.rolname = 'moleculestudio_webhook' AND c.relname = 'lemon_webhook_events') OR (r.rolname = 'moleculestudio_ack' AND c.relname = 'ai_credit_holds'))
    AND (has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR (c.relkind <> 'S' AND has_any_column_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'webhook/ack reach relations outside their contract: %', v_bad USING ERRCODE = '42501'; END IF;

  -- (v7a) no sequence privilege of any kind for any service role
  SELECT string_agg(r.rolname || ' -> ' || c.relname, ', ') INTO v_bad FROM pg_roles r, pg_class c
  WHERE r.rolname IN ('moleculestudio_app', 'moleculestudio_webhook', 'moleculestudio_ack') AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
    AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(r.oid, c.oid, 'USAGE,SELECT,UPDATE') ELSE false END;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'service roles hold sequence privileges: %', v_bad USING ERRCODE = '42501'; END IF;

  -- (v7b) the contract relations carry column-level privileges only: no table-level privilege of any kind
  IF has_table_privilege('moleculestudio_webhook', 'public.lemon_webhook_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('moleculestudio_ack', 'public.ai_credit_holds', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'webhook/ack hold a table-level privilege on their contract relation (their privileges must be column-level only)' USING ERRCODE = '42501';
  END IF;

  -- (v7c) the acknowledgement role can SELECT exactly its nine columns
  SELECT string_agg(a.attname::text, ', ') INTO v_bad FROM pg_attribute a
  WHERE a.attrelid = 'public.ai_credit_holds'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('moleculestudio_ack', 'public.ai_credit_holds', a.attnum, 'SELECT')
    AND a.attname::text <> ALL (ARRAY['user_id', 'reference_id', 'status', 'amount', 'operation_type', 'created_at', 'expires_at', 'delivery_tracking_enabled', 'answer_delivery_attempted_at']);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'ack can SELECT columns outside its contract: %', v_bad USING ERRCODE = '42501'; END IF;

  -- review tables: owner only
  FOREACH v_role IN ARRAY v_roles LOOP
    IF has_any_column_privilege(v_role, 'public.ai_delivery_gap_reviews', 'SELECT,INSERT,UPDATE,REFERENCES')
       OR has_any_column_privilege(v_role, 'public.ai_delivery_gap_review_amendments', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION '% reaches the owner-only review tables', v_role USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- functions: EXECUTE matrix for every SECURITY DEFINER function and every ledger/reconciliation function
  SELECT string_agg(format('%s %s app=%s webhook=%s ack=%s public=%s', p.oid::regprocedure, CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END,
                           has_function_privilege('moleculestudio_app', p.oid, 'EXECUTE'), has_function_privilege('moleculestudio_webhook', p.oid, 'EXECUTE'),
                           has_function_privilege('moleculestudio_ack', p.oid, 'EXECUTE'), has_function_privilege('public', p.oid, 'EXECUTE')), '; ') INTO v_bad
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND (p.prosecdef OR p.proname IN ('post_credit_transaction', 'ledger_provenance_issues') OR p.proname LIKE 'delivery\_attempt\_%')
    AND (
         has_function_privilege('public', p.oid, 'EXECUTE')
         OR has_function_privilege('moleculestudio_webhook', p.oid, 'EXECUTE')
         OR has_function_privilege('moleculestudio_ack', p.oid, 'EXECUTE')
         OR (has_function_privilege('moleculestudio_app', p.oid, 'EXECUTE') <> (p.oid::regprocedure::text IN (
              'grant_signup_bonus(uuid)', 'credit_verified_purchase(bigint)', 'capture_ai_hold(uuid,character varying)',
              'release_ai_hold(uuid,character varying,text)', 'clear_processed_webhook_payloads(interval)', 'release_expired_ai_holds()'))));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'EXECUTE matrix violated: %', v_bad USING ERRCODE = '42501'; END IF;

  -- definer hygiene: owner = table owner, search_path pinned with pg_temp last
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
    AND (p.proowner <> v_owner
         OR NOT (coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'SECURITY DEFINER hygiene violated (owner or search_path): %', v_bad USING ERRCODE = '42501'; END IF;

  -- guards present and enabled
  SELECT string_agg(t.trg, ', ') INTO v_bad
  FROM (VALUES ('ai_credit_holds', 'trg_ai_credit_holds_settlement_guard'), ('ai_credit_holds', 'trg_ai_credit_holds_delivery_write_once'),
               ('ai_credit_holds', 'trg_ai_credit_holds_delivery_insert_guard'), ('user_balances', 'trg_user_balances_insert_guard')) AS t(tbl, trg)
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = format('public.%I', t.tbl)::regclass AND g.tgname = t.trg AND g.tgenabled = 'O');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'guard trigger missing or disabled: %', v_bad USING ERRCODE = '55000'; END IF;
END
$$;

-- Report (human readable; the checks above already failed the run if anything was wrong).
SELECT r.rolname, r.rolcanlogin AS login, r.rolinherit AS inherit,
       (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid) AS memberships,
       has_table_privilege(r.oid, 'public.credit_ledger_transactions', 'INSERT') AS can_insert_ledger,
       has_function_privilege(r.oid, 'public.post_credit_transaction(uuid,integer,credit_transaction_type,character varying,character varying)', 'EXECUTE') AS can_post_credit
FROM pg_roles r WHERE r.rolname IN ('moleculestudio_app', 'moleculestudio_webhook', 'moleculestudio_ack') ORDER BY r.rolname;

COMMIT;
