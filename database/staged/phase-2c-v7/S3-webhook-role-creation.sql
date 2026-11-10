-- =============================================================================
-- DRAFT V6 — NOT APPLIED to any real database — REQUIRES EXPLICIT APPROVAL      (STEP W1: create/verify the webhook ingest role — CREATION AND ATTRIBUTE VERIFICATION ONLY)
-- =============================================================================
-- Supersedes webhook-role-creation-draft-v4.sql (unchanged). Correction for failure F-3 of the V4 disposable verification:
--   V4 asserted, UNCONDITIONALLY, that "a freshly created moleculestudio_webhook must hold no table privilege". Re-running the script after
--   webhook-role-privileges (W2) therefore failed 42501, although its header promised an idempotent re-run.
--
-- THE CONTRACT (explicit):
--   1. IDEMPOTENT: may be run any number of times, before or after W2, in any order with W2. It never alters an existing role.
--   2. If the role does NOT exist it is created: LOGIN NOINHERIT, no elevated attribute, no password. In THAT case (and only then) the script
--      asserts the new role holds no table privilege (a default ACL or a PUBLIC grant that leaks to new roles would show here).
--   3. If the role EXISTS it is only VERIFIED, never overwritten: attributes (LOGIN, NOINHERIT, no SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/
--      BYPASSRLS), no membership in any role, NO MEMBERS at all (a member would inherit the role's privileges; V4 checked only the app and ack
--      roles), and it owns nothing. Any deviation raises 42501 and the whole script rolls back. Privileges are NOT judged here: W2 states and asserts them,
--      and the read-only verification checks the combined result.
--   4. Sets no password, prints none, stores none. Grants nothing.
-- Never executed against a real database. Run by hand as a role allowed to create roles. Set the password out of band afterwards.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  r         pg_roles%ROWTYPE;
  v_created BOOLEAN := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moleculestudio_webhook') THEN
    CREATE ROLE moleculestudio_webhook WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    v_created := true;
  END IF;

  SELECT * INTO r FROM pg_roles WHERE rolname = 'moleculestudio_webhook';

  IF NOT r.rolcanlogin OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolinherit THEN
    RAISE EXCEPTION 'moleculestudio_webhook has unexpected attributes (expected LOGIN NOINHERIT and nothing elevated); the script never alters an existing role' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) THEN
    RAISE EXCEPTION 'moleculestudio_webhook must not be a member of any role' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = r.oid) THEN
    RAISE EXCEPTION 'moleculestudio_webhook must not have members (a member would inherit its privileges)' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = r.oid)
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proowner = r.oid) THEN
    RAISE EXCEPTION 'moleculestudio_webhook must not own any object in schema public' USING ERRCODE = '42501';
  END IF;

  IF v_created THEN
    IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
               AND (has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    OR (c.relkind <> 'S' AND has_any_column_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))) THEN
      RAISE EXCEPTION 'a freshly created moleculestudio_webhook must hold no table privilege (is a default privilege or PUBLIC grant in place?)' USING ERRCODE = '42501';
    END IF;
  END IF;
END
$$;

COMMIT;
