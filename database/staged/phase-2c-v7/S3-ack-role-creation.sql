-- =============================================================================
-- DRAFT — NOT APPLIED — REQUIRES EXPLICIT APPROVAL          (STEP A1: create the acknowledgement role — CREATION ONLY)
-- =============================================================================
-- Extra artifact (not in the requested list): D-12 forbids combining creation and privileges, and the requested
-- ack-role-deployment file is the PRIVILEGE step (A2). Never executed.
--
-- Precondition   : the role does not exist, or exists with exactly these attributes. Run as a role allowed to create roles.
-- Postcondition  : moleculestudio_ack exists; LOGIN (production requires it: it connects through ACK_DATABASE_URL); NOINHERIT;
--                  nothing elevated; no membership; no password; no table privilege beyond PUBLIC's.
-- The LOGIN requirement of the earlier deployment draft is preserved: the check below FAILS if the role cannot log in.
-- Credential: password set later, out of band (\password moleculestudio_ack); ACK_DATABASE_URL lives only in the secret store of
-- the component that records delivery attempts. Under TRUST authentication (the disposable test container) a password is not
-- enforced; production authentication must be password-based (scram-sha-256) — checked by the deployment document, not here.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moleculestudio_ack') THEN
    CREATE ROLE moleculestudio_ack WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'moleculestudio_ack';
  IF NOT r.rolcanlogin THEN RAISE EXCEPTION 'moleculestudio_ack must be able to log in' USING ERRCODE = '55000'; END IF;
  IF r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolinherit THEN
    RAISE EXCEPTION 'moleculestudio_ack has unexpected attributes' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
     OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = r.oid AND m.member IN (SELECT oid FROM pg_roles WHERE rolname IN ('moleculestudio_app', 'moleculestudio_webhook'))) THEN
    RAISE EXCEPTION 'moleculestudio_ack must not be a member of any role, nor have the other service roles as members' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner = r.oid) THEN
    RAISE EXCEPTION 'moleculestudio_ack must not own any object' USING ERRCODE = '42501';
  END IF;
END
$$;

COMMIT;
