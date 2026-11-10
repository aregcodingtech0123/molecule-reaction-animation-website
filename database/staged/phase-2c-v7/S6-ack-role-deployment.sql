-- =============================================================================
-- DRAFT — NOT APPLIED — REQUIRES EXPLICIT APPROVAL          (STEP A2: acknowledgement-role PRIVILEGES — GRANTS ONLY)
-- =============================================================================
-- Never executed. Run by hand as the owner of ai_credit_holds, after ack-role-creation-draft-v4.sql. Creates no role, sets no
-- password.
--
-- Precondition  : the role exists with the A1 attributes; migration 019 columns exist (and, for the role-aware trigger to let the
--                 role record an attempt, migration 021 v4 — this file does not require it).
-- Postcondition : USAGE on schema public; SELECT on exactly the nine columns the acknowledgement query reads; UPDATE on exactly
--                 answer_delivery_attempted_at; nothing else; no table-level privilege; no function.
-- Idempotent    : REVOKE ALL first, GRANT, assert.
-- Source of the column list: deliveryAttempt.service.ts (the exact SELECT ... FOR UPDATE and UPDATE statements).
-- Verified before (disposable database, V2 run): P-ack-* tests. This V4 text is unexecuted.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moleculestudio_ack' AND rolcanlogin) THEN
    RAISE EXCEPTION 'run ack-role-creation-draft-v4.sql first (the role must exist and be able to log in)' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.ai_credit_holds'::regclass AND NOT attisdropped
        AND attname IN ('delivery_tracking_enabled', 'answer_delivery_attempted_at')) <> 2 THEN
    RAISE EXCEPTION 'apply migration 019 first' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = 'public.ai_credit_holds'::regclass) IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'run as the owner of ai_credit_holds' USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON ai_credit_holds FROM moleculestudio_ack;
GRANT USAGE ON SCHEMA public TO moleculestudio_ack;
GRANT SELECT (user_id, reference_id, status, amount, operation_type, created_at, expires_at, delivery_tracking_enabled, answer_delivery_attempted_at)
  ON ai_credit_holds TO moleculestudio_ack;
GRANT UPDATE (answer_delivery_attempted_at) ON ai_credit_holds TO moleculestudio_ack;

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(format('%s on %s expected=%s actual=%s', x.priv, x.col, x.expected, x.actual), '; ') INTO v_bad
  FROM (
    SELECT p.priv, a.attname::text AS col,
           CASE WHEN p.priv = 'SELECT' THEN a.attname::text IN ('user_id', 'reference_id', 'status', 'amount', 'operation_type', 'created_at', 'expires_at', 'delivery_tracking_enabled', 'answer_delivery_attempted_at')
                WHEN p.priv = 'UPDATE' THEN a.attname::text = 'answer_delivery_attempted_at'
                ELSE false END AS expected,
           has_column_privilege('moleculestudio_ack', 'public.ai_credit_holds', a.attname::text, p.priv) AS actual
    FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(priv)
    JOIN pg_attribute a ON a.attrelid = 'public.ai_credit_holds'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  ) x WHERE x.expected IS DISTINCT FROM x.actual;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'ack column privileges differ from the contract: %', v_bad USING ERRCODE = '42501'; END IF;
  IF has_table_privilege('moleculestudio_ack', 'public.ai_credit_holds', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'moleculestudio_ack must hold no table-level privilege on ai_credit_holds' USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(c.relname::text, ', ') INTO v_bad FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND c.relname <> 'ai_credit_holds'
    AND (has_table_privilege('moleculestudio_ack', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR (c.relkind <> 'S' AND has_any_column_privilege('moleculestudio_ack', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'moleculestudio_ack reaches other relations: %', v_bad USING ERRCODE = '42501'; END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('moleculestudio_ack', p.oid, 'EXECUTE')
    AND (p.prosecdef OR p.proname LIKE 'delivery_attempt\_%' OR p.proname = 'ledger_provenance_issues');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'moleculestudio_ack can execute: %', v_bad USING ERRCODE = '42501'; END IF;
END
$$;

COMMIT;
