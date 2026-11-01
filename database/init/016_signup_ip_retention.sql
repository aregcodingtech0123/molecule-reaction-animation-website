-- =============================================================================
-- MoleculeStudio — retention of users.signup_ip (SEO follow-up, docs/seo/PRIVACY_FOLLOWUPS.md §1)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: nothing in the application calls it.
--
-- users.signup_ip is written once at registration ("signup credit abuse heuristics", migration 001) and
-- read by nothing. This function clears it for accounts older than the retention (default 90 days) and
-- returns how many it cleared. It is meant to run once a day from a scheduler with the OWNER connection
-- (`npm run db:purge-signup-ips`):
--   - SECURITY INVOKER: it does nothing the caller could not do with an UPDATE;
--   - EXECUTE is revoked from PUBLIC and not granted to moleculestudio_app, so the web application
--     cannot call it;
--   - a floor of 1 day: a typo cannot clear the addresses of people who signed up today;
--   - search_path pinned like every function since SEC-12.
-- Only the signup_ip column changes (the existing trigger moves updated_at, which nothing reads).
-- No ledger, balance, hold, token or billing row is read or written.
-- =============================================================================

CREATE OR REPLACE FUNCTION purge_signup_ips(p_retention INTERVAL DEFAULT INTERVAL '90 days')
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  cleared INTEGER;
BEGIN
  IF p_retention IS NULL OR p_retention < INTERVAL '1 day' THEN
    RAISE EXCEPTION 'purge_signup_ips: retention must be at least 1 day (got %)', p_retention
      USING ERRCODE = '22023';
  END IF;

  UPDATE users
     SET signup_ip = NULL
   WHERE signup_ip IS NOT NULL
     AND created_at < NOW() - p_retention;
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_signup_ips(INTERVAL) FROM PUBLIC;

COMMENT ON FUNCTION purge_signup_ips(INTERVAL) IS
  'Clears users.signup_ip for accounts older than the retention (default 90 days, minimum 1 day); returns the number of rows cleared. Run daily by the owner connection.';
