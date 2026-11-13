-- =============================================================================
-- STAGED V7 CONTRACT ARTIFACT — step S6 (W2) — not applied by the migration runner — NOT production-approved
-- Staged as database/staged/phase-2c-v7/S6-webhook-role-privileges.sql; source draft phase-2c-step-5-2-2-webhook-role-privileges-draft-v4.sql (sha256 3918aa236a844fb4…, MANIFEST.json).
-- Purpose: W2: grant the webhook ingest role its minimum privileges, GRANTS ONLY.
-- Execution status, three separate facts:
--   * Disposable PostgreSQL: the V7 verification executed a copy of this file in a disposable PostgreSQL 18.6 test database,
--     with the role prefix moleculestudio_ replaced by v7v_20261109_ (V7 substitution record).
--   * Original role names: this file as staged, with the moleculestudio_ role names, has not been executed anywhere.
--   * Production: not executed in production or in any other non-disposable database; not production-approved.
-- Only comments differ from the source draft; the executable SQL is frozen (MANIFEST.json strippedSha256).
-- =============================================================================
-- Run by hand as the owner of lemon_webhook_events. It creates no role (S3-webhook-role-creation.sql, draft V6, does),
-- sets no password, and changes no other role.
--
-- Precondition  : migration 022 v4 applied (typed columns, ingested_by, eligible exist); the role exists with the W1 attributes.
-- Postcondition : the role can (a) read id, body_sha256, status of stored events and (b) INSERT an event with exactly the
--                 columns below. It cannot UPDATE or DELETE anything, cannot read the payload or buyer e-mail, cannot write
--                 ingested_by (its column default is current_user, so the database records WHO stored the event), cannot touch
--                 any other table or execute any SECURITY DEFINER function.
-- Idempotent    : REVOKE first, then GRANT, then assert; re-running restores exactly this state.
--
-- THE INGEST STATEMENT THE WEBHOOK COMPONENT MUST USE (production change P-4). The V3 statement
--   INSERT ... ON CONFLICT (body_sha256) DO UPDATE SET body_sha256 = EXCLUDED.body_sha256 RETURNING ..., (xmax = 0)
-- needs UPDATE on body_sha256, which would let a compromised ingest credential rewrite stored hashes. V4 uses
--   INSERT INTO lemon_webhook_events (...) VALUES (...)
--   ON CONFLICT ON CONSTRAINT uq_lemon_webhook_events_body DO NOTHING RETURNING id::text, status;
--   -- if no row returned: SELECT id::text, status FROM lemon_webhook_events WHERE body_sha256 = $1;  (duplicate delivery)
-- (V7 exercised ON CONFLICT ... DO NOTHING with webhook-role sessions on the role-substituted copy (test CC-5g, PASS). The V7
-- results do not record the ON CONSTRAINT <name> form as tested, and nothing was re-verified under the original role names.)
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moleculestudio_webhook') THEN
    RAISE EXCEPTION 'run webhook-role-creation-draft-v4.sql first' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.lemon_webhook_events'::regclass AND NOT attisdropped
        AND attname IN ('ingested_by', 'eligible', 'order_store_id', 'order_test_mode', 'order_variant_id', 'order_currency',
                        'order_total_cents', 'order_subtotal_cents', 'order_item_price_cents', 'buyer_user_id', 'buyer_email', 'pending_order_id')) <> 12 THEN
    RAISE EXCEPTION 'apply migration 022 v4 first (inbox columns missing)' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = 'public.lemon_webhook_events'::regclass) IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'run as the owner of lemon_webhook_events' USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON lemon_webhook_events FROM moleculestudio_webhook;
GRANT USAGE ON SCHEMA public TO moleculestudio_webhook;
GRANT SELECT (id, body_sha256, status) ON lemon_webhook_events TO moleculestudio_webhook;
GRANT INSERT (body_sha256, event_name, provider_order_id, payload, eligible, order_store_id, order_test_mode, order_variant_id,
              order_currency, order_total_cents, order_subtotal_cents, order_item_price_cents, buyer_user_id, buyer_email, pending_order_id)
  ON lemon_webhook_events TO moleculestudio_webhook;

DO $$
DECLARE v_bad TEXT;
BEGIN
  -- column matrix on the inbox
  SELECT string_agg(format('%s on %s expected=%s actual=%s', x.priv, x.col, x.expected, x.actual), '; ') INTO v_bad
  FROM (
    SELECT p.priv, a.attname::text AS col,
           CASE
             WHEN p.priv = 'SELECT' THEN a.attname::text IN ('id', 'body_sha256', 'status')
             WHEN p.priv = 'INSERT' THEN a.attname::text IN ('body_sha256', 'event_name', 'provider_order_id', 'payload', 'eligible', 'order_store_id', 'order_test_mode',
                                                              'order_variant_id', 'order_currency', 'order_total_cents', 'order_subtotal_cents', 'order_item_price_cents',
                                                              'buyer_user_id', 'buyer_email', 'pending_order_id')
             ELSE false END AS expected,
           has_column_privilege('moleculestudio_webhook', 'public.lemon_webhook_events', a.attname::text, p.priv) AS actual
    FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(priv)
    JOIN pg_attribute a ON a.attrelid = 'public.lemon_webhook_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  ) x WHERE x.expected IS DISTINCT FROM x.actual;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'webhook column privileges differ from the contract: %', v_bad USING ERRCODE = '42501'; END IF;

  IF has_table_privilege('moleculestudio_webhook', 'public.lemon_webhook_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'moleculestudio_webhook must hold no table-level privilege on the inbox' USING ERRCODE = '42501';
  END IF;
  -- nothing anywhere else
  SELECT string_agg(c.relname::text, ', ') INTO v_bad FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND c.relname <> 'lemon_webhook_events'
    AND (has_table_privilege('moleculestudio_webhook', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR (c.relkind <> 'S' AND has_any_column_privilege('moleculestudio_webhook', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'moleculestudio_webhook reaches other relations: %', v_bad USING ERRCODE = '42501'; END IF;
  -- no SECURITY DEFINER function, no owner-only read function
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('moleculestudio_webhook', p.oid, 'EXECUTE')
    AND (p.prosecdef OR p.proname LIKE 'delivery_attempt\_%' OR p.proname = 'ledger_provenance_issues');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'moleculestudio_webhook can execute: %', v_bad USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'moleculestudio_webhook')
     OR pg_has_role('moleculestudio_app', 'moleculestudio_webhook', 'MEMBER') OR pg_has_role('moleculestudio_ack', 'moleculestudio_webhook', 'MEMBER') THEN
    RAISE EXCEPTION 'membership involving moleculestudio_webhook' USING ERRCODE = '42501';
  END IF;
END
$$;

COMMIT;
