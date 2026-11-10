-- =============================================================================
-- DRAFT — NOT APPLIED — NOT APPROVED — REQUIRES EXPLICIT APPROVAL      (Migration 022 v4: ledger and settlement security)
-- =============================================================================
-- Supersedes migration-022-ledger-security-draft.sql (V3, unchanged). V3 was executed in a disposable database (341 results);
-- THIS V4 TEXT HAS NEVER BEEN PARSED OR EXECUTED BY POSTGRESQL (this task authorised no SQL execution). Treat every statement
-- as unverified until the V4 verification matrix has been run on a disposable database.
--
-- WHAT V4 CHANGES, AND WHY (every item comes from the adversarial review, V4 review document, findings A-xx)
--   A-01  user_balances INSERT guard. The application role could INSERT a user_balances row with an arbitrary balance
--         (008's guard fires only on UPDATE; the column default is 10). New BEFORE INSERT trigger: a non-zero balance is allowed
--         only for the table owner's context (post_credit_transaction() runs as the owner).
--   A-02  credit_verified_purchase(): V3's amount check was `v IN (a, b, c)`; with a NULL candidate and no match the result is
--         NULL, so the refusal was SKIPPED. V4 compares with coalesce(..., false). Also adds the store-id and test-mode checks
--         the service applies at processing (V3 omitted them) and the variant check (D-1).
--   A-03  No JSON is parsed in SQL any more. The trusted ingest component extracts the fields it verified into typed columns of
--         the stored event; the function reads those columns only. This removes the NUL-escape failure of ::jsonb, JSON
--         parser differentials (duplicate keys, escape handling) and the payload dependency of crediting.
--   A-04  credit_verified_purchase(p_event_id) takes ONLY the event id: user and package are derived (variant -> package,
--         custom user id or order e-mail -> user). V3 accepted a caller-chosen user and package.
--   D-5   Policy tables are the authoritative source (credits, prices, variant ids, store id, test-mode rule, signup bonus).
--         The seed values are initial values only; no assertion freezes them.
--   A-05  capture_ai_hold() mirrors the service's terminal debit errors (insufficient credits 'P0001' and duplicate debit
--         '23505') as capture_failed; V3 handled only 'P0001'.
--   A-06  The settlement guard also freezes amount, operation_type, user_id and reference_id of a settled hold.
--   A-07  ledger_provenance_issues(): purchases are checked against the stored event AND its trust (ingested_by, eligible) from
--         a cut-over time; false-negative and false-positive limits are listed in the review.
--   D-9   Index/constraint builds accept PRE-BUILT valid indexes (built out of band with CREATE INDEX CONCURRENTLY, which cannot
--         run inside the migration runner's transaction) and REFUSE an invalid leftover index.
--   D-6   Goodwill is NOT in this migration (023 or later).
--
-- NOT DONE HERE: no grant to any role (app-role v4 and the webhook privileges file do that, in the order of the deployment
-- document); post_credit_transaction() is unchanged; no ADMIN_ADJUSTMENT / REFUND / CREDIT_REFUND / goodwill operation for the
-- application.
--
-- SECURITY DEFINER ANALYSIS (every definer function below)
--   Owner: the migration (schema-owner) role. It must not be a superuser in production if avoidable (definer functions run
--   with its rights). search_path = public, pg_temp on every function (pg_catalog implicitly first). REVOKE ALL FROM PUBLIC;
--   EXECUTE is granted only by app-role v4. No dynamic SQL. No argument chooses a ledger type, sign, amount, provider,
--   reference or (for purchases) user or package.
-- =============================================================================

SET LOCAL lock_timeout = '3s';

-- A. Preconditions ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.ai_credit_holds') IS NULL OR to_regclass('public.credit_ledger_transactions') IS NULL
     OR to_regclass('public.lemon_webhook_events') IS NULL OR to_regclass('public.pending_checkout_orders') IS NULL
     OR to_regclass('public.user_balances') IS NULL THEN
    RAISE EXCEPTION '022 requires migrations 001 to 017' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('post_credit_transaction(uuid,integer,credit_transaction_type,character varying,character varying)') IS NULL
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('post_credit_transaction(uuid,integer,credit_transaction_type,character varying,character varying)')) THEN
    RAISE EXCEPTION '022 requires post_credit_transaction() as SECURITY DEFINER (migration 012)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_credit_holds WHERE ledger_id IS NOT NULL GROUP BY ledger_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION '022: some ledger rows are referenced by more than one hold; resolve by hand first' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_credit_holds h JOIN credit_ledger_transactions l ON l.id = h.ledger_id WHERE l.user_id <> h.user_id) THEN
    RAISE EXCEPTION '022: some holds reference another user''s ledger row; resolve by hand first' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM credit_ledger_transactions WHERE transaction_type = 'SIGNUP_BONUS' GROUP BY user_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION '022: some users have more than one SIGNUP_BONUS row; resolve by hand first' USING ERRCODE = '55000';
  END IF;
  -- informational, not blocking: a balance cache that already disagrees with the ledger is reported by ledger_reconciliation()
END
$$;

-- B. Policy tables: the authoritative source (D-5). Owner-only writes; the application role gets SELECT (app-role v4). ------
CREATE TABLE IF NOT EXISTS ledger_policy (
  singleton            BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  signup_bonus_credits INTEGER     NOT NULL CHECK (signup_bonus_credits > 0),
  lemon_store_id       VARCHAR(32),                             -- NULL = purchases refused (policy_incomplete) until the owner sets it
  allow_test_mode      BOOLEAN     NOT NULL DEFAULT false,
  ingest_cutover_at    TIMESTAMPTZ,                             -- from this moment, events must be ingested by a trusted role to count as a source
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ledger_policy (singleton, signup_bonus_credits) VALUES (true, 10) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS credit_packages (
  package_id       VARCHAR(64) PRIMARY KEY,
  credits          INTEGER     NOT NULL CHECK (credits > 0),
  price_usd_cents  INTEGER     NOT NULL CHECK (price_usd_cents > 0),
  lemon_variant_id VARCHAR(32),                                 -- NULL = package cannot be bought until the owner sets it
  active           BOOLEAN     NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_packages_price_unique   UNIQUE (price_usd_cents),
  CONSTRAINT credit_packages_variant_unique UNIQUE (lemon_variant_id)
);
INSERT INTO credit_packages (package_id, credits, price_usd_cents) VALUES
  ('starter', 50, 500), ('pro', 250, 2000), ('enterprise', 700, 5000)
ON CONFLICT (package_id) DO NOTHING;
REVOKE ALL ON ledger_policy, credit_packages FROM PUBLIC;
COMMENT ON TABLE credit_packages IS 'Authoritative credit catalogue (D-5). Owner-written; readable by the application. A package is purchasable only with lemon_variant_id set and active.';
COMMENT ON TABLE ledger_policy IS 'Authoritative issuance policy (D-5): signup bonus, Lemon store id, test-mode rule, ingest cut-over. Owner-written; readable by the application.';

-- C. user_balances INSERT guard (A-01) ------------------------------------------
CREATE OR REPLACE FUNCTION guard_user_balance_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.balance <> 0
     AND NOT pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
    RAISE EXCEPTION 'user_balances rows are created with balance 0; credits move only through the ledger operations'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_balances'::regclass AND tgname = 'trg_user_balances_insert_guard') THEN
    CREATE TRIGGER trg_user_balances_insert_guard
      BEFORE INSERT ON user_balances FOR EACH ROW WHEN (NEW.balance <> 0)
      EXECUTE FUNCTION guard_user_balance_insert();
  END IF;
END
$$;

-- D. B-2 structure, accepting pre-built valid indexes (D-9) -------------------------
DO $$
DECLARE v_ok BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.credit_ledger_transactions'::regclass AND conname = 'uq_credit_ledger_id_user') THEN
    IF to_regclass('public.uq_credit_ledger_id_user') IS NOT NULL THEN
      SELECT i.indisvalid AND i.indisready AND i.indisunique AND i.indnatts = 2 AND i.indpred IS NULL AND i.indrelid = 'public.credit_ledger_transactions'::regclass
        INTO v_ok FROM pg_index i WHERE i.indexrelid = 'public.uq_credit_ledger_id_user'::regclass;
      IF v_ok IS DISTINCT FROM true OR pg_get_indexdef('public.uq_credit_ledger_id_user'::regclass) NOT LIKE '%(id, user_id)%' THEN
        RAISE EXCEPTION '022: index uq_credit_ledger_id_user exists but is invalid or not on (id, user_id); drop it and rebuild' USING ERRCODE = '55000';
      END IF;
      ALTER TABLE credit_ledger_transactions ADD CONSTRAINT uq_credit_ledger_id_user UNIQUE USING INDEX uq_credit_ledger_id_user;
    ELSE
      ALTER TABLE credit_ledger_transactions ADD CONSTRAINT uq_credit_ledger_id_user UNIQUE (id, user_id);
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_credit_holds'::regclass AND conname = 'ai_credit_holds_ledger_same_user') THEN
    ALTER TABLE ai_credit_holds ADD CONSTRAINT ai_credit_holds_ledger_same_user
      FOREIGN KEY (ledger_id, user_id) REFERENCES credit_ledger_transactions (id, user_id) NOT VALID;
    ALTER TABLE ai_credit_holds VALIDATE CONSTRAINT ai_credit_holds_ledger_same_user;
  END IF;

  IF to_regclass('public.uq_ai_credit_holds_ledger_id') IS NULL THEN
    CREATE UNIQUE INDEX uq_ai_credit_holds_ledger_id ON ai_credit_holds (ledger_id) WHERE ledger_id IS NOT NULL;
  ELSIF NOT (SELECT i.indisvalid AND i.indisready AND i.indisunique FROM pg_index i WHERE i.indexrelid = 'public.uq_ai_credit_holds_ledger_id'::regclass) THEN
    RAISE EXCEPTION '022: index uq_ai_credit_holds_ledger_id is INVALID (failed concurrent build?); drop and rebuild' USING ERRCODE = '55000';
  END IF;

  IF to_regclass('public.uq_credit_ledger_signup_once') IS NULL THEN
    CREATE UNIQUE INDEX uq_credit_ledger_signup_once ON credit_ledger_transactions (user_id) WHERE transaction_type = 'SIGNUP_BONUS';
  ELSIF NOT (SELECT i.indisvalid AND i.indisready AND i.indisunique FROM pg_index i WHERE i.indexrelid = 'public.uq_credit_ledger_signup_once'::regclass) THEN
    RAISE EXCEPTION '022: index uq_credit_ledger_signup_once is INVALID; drop and rebuild' USING ERRCODE = '55000';
  END IF;
END
$$;

-- E. Settlement guard (B-2 + F-B), every role including the owner. A guard, not a boundary against the owner. -------------
CREATE OR REPLACE FUNCTION enforce_hold_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID; v_amount INTEGER; v_type credit_transaction_type; v_ref VARCHAR; v_provider VARCHAR;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'held' THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.settled_at IS DISTINCT FROM OLD.settled_at
       OR NEW.ledger_id IS DISTINCT FROM OLD.ledger_id OR NEW.settle_reason IS DISTINCT FROM OLD.settle_reason
       OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
       OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.reference_id IS DISTINCT FROM OLD.reference_id THEN
      RAISE EXCEPTION 'ai_credit_holds: a settled reservation (%) is final', OLD.status USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'held' AND NEW.settled_at > now() THEN
    RAISE EXCEPTION 'ai_credit_holds: settled_at cannot lie in the future' USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'captured' THEN
    SELECT l.user_id, l.amount, l.transaction_type, l.reference_id, l.provider
      INTO v_user, v_amount, v_type, v_ref, v_provider
    FROM credit_ledger_transactions l WHERE l.id = NEW.ledger_id;
    IF NOT FOUND OR v_user <> NEW.user_id OR v_amount <> -NEW.amount OR v_type <> 'CREDIT_CONSUMPTION'
       OR v_ref IS DISTINCT FROM NEW.reference_id OR v_provider IS NOT NULL THEN
      RAISE EXCEPTION 'ai_credit_holds: a captured reservation must reference its own CREDIT_CONSUMPTION debit of exactly the reserved amount'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ai_credit_holds'::regclass AND tgname = 'trg_ai_credit_holds_settlement_guard') THEN
    CREATE TRIGGER trg_ai_credit_holds_settlement_guard
      BEFORE INSERT OR UPDATE OF status, settled_at, ledger_id, settle_reason, amount, operation_type, user_id, reference_id ON ai_credit_holds
      FOR EACH ROW EXECUTE FUNCTION enforce_hold_settlement();
  END IF;
END
$$;

-- F. Webhook inbox: provenance and typed, ingest-verified fields (A-03, D-1) -----------------------------------------------
ALTER TABLE lemon_webhook_events
  ADD COLUMN IF NOT EXISTS ingested_by            NAME        NOT NULL DEFAULT current_user,
  ADD COLUMN IF NOT EXISTS eligible               BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_store_id         VARCHAR(32),
  ADD COLUMN IF NOT EXISTS order_test_mode        BOOLEAN,
  ADD COLUMN IF NOT EXISTS order_variant_id       VARCHAR(32),
  ADD COLUMN IF NOT EXISTS order_currency         VARCHAR(8),
  ADD COLUMN IF NOT EXISTS order_total_cents      INTEGER,
  ADD COLUMN IF NOT EXISTS order_subtotal_cents   INTEGER,
  ADD COLUMN IF NOT EXISTS order_item_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS buyer_user_id          UUID,
  ADD COLUMN IF NOT EXISTS buyer_email            VARCHAR(320),
  ADD COLUMN IF NOT EXISTS pending_order_id       UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.lemon_webhook_events'::regclass AND conname = 'lemon_webhook_events_eligible_complete') THEN
    ALTER TABLE lemon_webhook_events ADD CONSTRAINT lemon_webhook_events_eligible_complete CHECK (
      NOT eligible OR (event_name = 'order_created' AND provider_order_id IS NOT NULL AND order_store_id IS NOT NULL
                       AND order_test_mode IS NOT NULL AND order_variant_id IS NOT NULL AND order_currency IS NOT NULL
                       AND order_total_cents IS NOT NULL AND order_subtotal_cents IS NOT NULL AND order_item_price_cents IS NOT NULL));
  END IF;
END
$$;
COMMENT ON COLUMN lemon_webhook_events.eligible IS 'Set only by the trusted ingest role, after it verified the signature on the raw body and the origin, variant, currency and amounts. Never writable by the application role.';
COMMENT ON COLUMN lemon_webhook_events.buyer_email IS 'PII; cleared together with payload by clear_processed_webhook_payloads().';

-- G. Narrow operations ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION grant_signup_bonus(p_user_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id BIGINT; v_amount INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
  SELECT id INTO v_id FROM credit_ledger_transactions WHERE user_id = p_user_id AND transaction_type = 'SIGNUP_BONUS';
  IF FOUND THEN RETURN v_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND is_verified AND anonymised_at IS NULL) THEN
    RAISE EXCEPTION 'signup bonus requires an existing, verified, active account' USING ERRCODE = '42501';
  END IF;
  SELECT signup_bonus_credits INTO v_amount FROM ledger_policy WHERE singleton;
  INSERT INTO user_balances (user_id, balance) VALUES (p_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  RETURN post_credit_transaction(p_user_id, v_amount, 'SIGNUP_BONUS', 'signup', NULL);
END;
$$;

-- credit_verified_purchase: the ONLY argument is the stored event. Everything else is derived from the event's trusted columns
-- and the policy tables. Policy failures are returned as outcomes (the service records them as it does today); trust failures
-- (not eligible, not ingested by a trusted role, not claimed) raise 42501.
CREATE OR REPLACE FUNCTION credit_verified_purchase(p_event_id BIGINT)
RETURNS TABLE (o_outcome TEXT, o_ledger_id BIGINT, o_user_id UUID, o_credits INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e RECORD; pol RECORD; pkg RECORD; v_user UUID; v_ref TEXT; v_id BIGINT; v_owner NAME;
BEGIN
  SELECT * INTO e FROM lemon_webhook_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown webhook event' USING ERRCODE = '42501'; END IF;
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = 'public.lemon_webhook_events'::regclass;
  IF NOT e.eligible OR e.ingested_by NOT IN (v_owner, 'moleculestudio_webhook') THEN
    RAISE EXCEPTION 'webhook event is not eligible or was not stored by a trusted ingest role' USING ERRCODE = '42501';
  END IF;
  IF e.event_name <> 'order_created' OR e.status <> 'processing' THEN
    RAISE EXCEPTION 'webhook event is not a claimed order_created event' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO pol FROM ledger_policy WHERE singleton;
  IF pol.lemon_store_id IS NULL THEN RETURN QUERY SELECT 'policy_incomplete'::text, NULL::bigint, NULL::uuid, NULL::integer; RETURN; END IF;
  IF e.order_store_id <> pol.lemon_store_id THEN RETURN QUERY SELECT 'store_mismatch'::text, NULL::bigint, NULL::uuid, NULL::integer; RETURN; END IF;
  IF e.order_test_mode AND NOT pol.allow_test_mode THEN RETURN QUERY SELECT 'test_mode_order'::text, NULL::bigint, NULL::uuid, NULL::integer; RETURN; END IF;
  IF lower(e.order_currency) <> 'usd' THEN RETURN QUERY SELECT 'currency_mismatch'::text, NULL::bigint, NULL::uuid, NULL::integer; RETURN; END IF;

  SELECT cp.* INTO pkg FROM credit_packages cp WHERE cp.lemon_variant_id = e.order_variant_id AND cp.active;
  IF NOT FOUND THEN RETURN QUERY SELECT 'unresolved_package'::text, NULL::bigint, NULL::uuid, NULL::integer; RETURN; END IF;
  -- NULL-safe: a NULL candidate counts as "no match", never as "skip the check" (V3 defect A-02)
  IF NOT (coalesce(pkg.price_usd_cents = e.order_total_cents, false) OR coalesce(pkg.price_usd_cents = e.order_subtotal_cents, false)
          OR coalesce(pkg.price_usd_cents = e.order_item_price_cents, false)) THEN
    RETURN QUERY SELECT 'amount_mismatch'::text, NULL::bigint, NULL::uuid, NULL::integer; RETURN;
  END IF;

  -- user: custom_data.user_id when it names an existing user, else the order e-mail (the service's resolveUserId)
  IF e.buyer_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = e.buyer_user_id) THEN
    v_user := e.buyer_user_id;
  ELSIF e.buyer_email IS NOT NULL THEN
    SELECT u.id INTO v_user FROM users u WHERE lower(u.email) = lower(e.buyer_email);
  END IF;
  IF v_user IS NULL THEN RETURN QUERY SELECT 'missing_user'::text, NULL::bigint, NULL::uuid, NULL::integer; RETURN; END IF;

  -- Lock BEFORE the duplicate lookup (V4 self-review finding V4-14): two different stored events can carry the same order id
  -- (a retried delivery with different bytes has a different body hash). Locking first makes the second caller wait and then see
  -- the committed ledger row, so it returns 'already_processed' instead of failing on the unique reference (23505).
  PERFORM pg_advisory_xact_lock(hashtext(v_user::text));
  v_ref := 'ls_order_' || e.provider_order_id;
  SELECT l.id INTO v_id FROM credit_ledger_transactions l WHERE l.provider = 'lemonsqueezy' AND l.reference_id = v_ref;
  IF FOUND THEN RETURN QUERY SELECT 'already_processed'::text, v_id, v_user, pkg.credits; RETURN; END IF;

  INSERT INTO user_balances (user_id, balance) VALUES (v_user, 0) ON CONFLICT (user_id) DO NOTHING;
  v_id := post_credit_transaction(v_user, pkg.credits, 'CREDIT_PURCHASE', v_ref, 'lemonsqueezy');
  IF e.pending_order_id IS NOT NULL THEN
    UPDATE pending_checkout_orders SET status = 'completed', completed_at = now()
    WHERE pending_checkout_orders.id = e.pending_order_id AND pending_checkout_orders.user_id = v_user AND pending_checkout_orders.status <> 'completed';
  END IF;
  RETURN QUERY SELECT 'credited'::text, v_id, v_user, pkg.credits;
END;
$$;

CREATE OR REPLACE FUNCTION capture_ai_hold(p_user_id UUID, p_reference_id VARCHAR)
RETURNS TABLE (o_outcome TEXT, o_ledger_id BIGINT, o_amount INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE h RECORD; v_ledger BIGINT; v_reason TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
  SELECT * INTO h FROM ai_credit_holds WHERE user_id = p_user_id AND reference_id = p_reference_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::bigint, NULL::integer; RETURN; END IF;
  IF h.status = 'captured' THEN RETURN QUERY SELECT 'already_captured'::text, h.ledger_id, h.amount; RETURN; END IF;
  IF h.status <> 'held' THEN RETURN QUERY SELECT ('not_capturable_' || h.status)::text, NULL::bigint, h.amount; RETURN; END IF;
  IF h.expires_at <= now() THEN
    UPDATE ai_credit_holds SET status = 'expired', settled_at = now(), settle_reason = 'capture_after_expiry'
    WHERE user_id = p_user_id AND reference_id = p_reference_id;
    RETURN QUERY SELECT 'expired_at_capture'::text, NULL::bigint, h.amount; RETURN;
  END IF;
  BEGIN
    v_ledger := post_credit_transaction(p_user_id, -h.amount, 'CREDIT_CONSUMPTION', p_reference_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE IN ('P0001', '23505') THEN                           -- the service's TERMINAL_DEBIT_SQLSTATES (A-05)
      v_reason := CASE WHEN SQLSTATE = 'P0001' THEN 'insufficient_credits_at_capture' ELSE 'db_error_' || SQLSTATE END;
      UPDATE ai_credit_holds SET status = 'capture_failed', settled_at = now(), settle_reason = v_reason
      WHERE user_id = p_user_id AND reference_id = p_reference_id;
      RETURN QUERY SELECT 'capture_failed'::text, NULL::bigint, h.amount; RETURN;
    END IF;
    RAISE;
  END;
  UPDATE ai_credit_holds SET status = 'captured', settled_at = now(), ledger_id = v_ledger
  WHERE user_id = p_user_id AND reference_id = p_reference_id;
  RETURN QUERY SELECT 'captured'::text, v_ledger, h.amount;
END;
$$;

CREATE OR REPLACE FUNCTION release_ai_hold(p_user_id UUID, p_reference_id VARCHAR, p_reason TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE h RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
  SELECT status INTO h FROM ai_credit_holds WHERE user_id = p_user_id AND reference_id = p_reference_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF h.status = 'captured' THEN RETURN 'already_captured'; END IF;
  IF h.status = 'capture_failed' THEN RETURN 'capture_failed'; END IF;
  IF h.status = 'expired' THEN RETURN 'already_expired'; END IF;
  IF h.status = 'released' THEN RETURN 'already_released'; END IF;
  UPDATE ai_credit_holds SET status = 'released', settled_at = now(), settle_reason = left(coalesce(nullif(p_reason, ''), 'released'), 200)
  WHERE user_id = p_user_id AND reference_id = p_reference_id;
  RETURN 'released';
END;
$$;

CREATE OR REPLACE FUNCTION clear_processed_webhook_payloads(p_age INTERVAL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n INTEGER;
BEGIN
  IF p_age IS NULL OR p_age < interval '30 days' THEN RAISE EXCEPTION 'retention below 30 days' USING ERRCODE = '22023'; END IF;
  UPDATE lemon_webhook_events SET payload = NULL, buyer_email = NULL
  WHERE status = 'processed' AND (payload IS NOT NULL OR buyer_email IS NOT NULL) AND processed_at < now() - p_age;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

ALTER FUNCTION release_expired_ai_holds() SECURITY DEFINER;
REVOKE ALL ON FUNCTION grant_signup_bonus(UUID), credit_verified_purchase(BIGINT), capture_ai_hold(UUID, VARCHAR),
  release_ai_hold(UUID, VARCHAR, TEXT), clear_processed_webhook_payloads(INTERVAL), release_expired_ai_holds() FROM PUBLIC;
-- (V3's credit_verified_purchase(BIGINT, UUID, VARCHAR) overload, if V3 was ever applied, must be dropped by the owner:
--  DROP FUNCTION IF EXISTS credit_verified_purchase(BIGINT, UUID, VARCHAR);  -- no real database ever received V3)

-- H. Provenance (read-only, owner-only) --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger_provenance_issues()
RETURNS TABLE (issue TEXT, ledger_id BIGINT, user_id UUID, transaction_type TEXT, amount INTEGER, reference_id TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT x.issue, l.id, l.user_id, l.transaction_type::text, l.amount, l.reference_id::text, l.created_at
  FROM credit_ledger_transactions l
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN l.transaction_type = 'SIGNUP_BONUS' AND l.amount <> (SELECT signup_bonus_credits FROM ledger_policy WHERE singleton) THEN 'signup_bonus_amount'
      WHEN l.transaction_type = 'CREDIT_CONSUMPTION' AND NOT EXISTS (
             SELECT 1 FROM ai_credit_holds h WHERE h.ledger_id = l.id AND h.user_id = l.user_id AND h.status = 'captured'
               AND -h.amount = l.amount AND h.reference_id = l.reference_id) THEN 'consumption_without_capture'
      WHEN l.transaction_type = 'CREDIT_PURCHASE' AND (l.provider IS DISTINCT FROM 'lemonsqueezy'
             OR NOT EXISTS (SELECT 1 FROM credit_packages cp WHERE cp.credits = l.amount)
             OR NOT EXISTS (SELECT 1 FROM lemon_webhook_events e WHERE e.event_name = 'order_created' AND 'ls_order_' || e.provider_order_id = l.reference_id)) THEN 'purchase_without_source'
      WHEN l.transaction_type = 'CREDIT_PURCHASE' AND EXISTS (
             SELECT 1 FROM lemon_webhook_events e, ledger_policy p
             WHERE p.singleton AND e.event_name = 'order_created' AND 'ls_order_' || e.provider_order_id = l.reference_id
               AND p.ingest_cutover_at IS NOT NULL AND e.received_at >= p.ingest_cutover_at
               AND (NOT e.eligible OR e.ingested_by NOT IN (pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.lemon_webhook_events'::regclass)), 'moleculestudio_webhook')))
             AND NOT EXISTS (SELECT 1 FROM lemon_webhook_events e2, ledger_policy p2
                             WHERE p2.singleton AND e2.event_name = 'order_created' AND 'ls_order_' || e2.provider_order_id = l.reference_id AND e2.eligible
                               AND e2.ingested_by IN (pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.lemon_webhook_events'::regclass)), 'moleculestudio_webhook')) THEN 'purchase_event_not_trusted'
      WHEN l.transaction_type IN ('STRIPE_PURCHASE', 'AI_GENERATION_DEDUCTION', 'ADMIN_ADJUSTMENT', 'REFUND', 'CREDIT_REFUND') THEN 'manual_or_legacy_type'
    END AS issue
  ) x
  WHERE x.issue IS NOT NULL
  ORDER BY l.id;
$$;
REVOKE ALL ON FUNCTION ledger_provenance_issues() FROM PUBLIC;

-- I. Final assertions ---------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('grant_signup_bonus', 'credit_verified_purchase', 'capture_ai_hold', 'release_ai_hold', 'clear_processed_webhook_payloads', 'release_expired_ai_holds')
        AND p.prosecdef AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
        AND NOT has_function_privilege('public', p.oid, 'EXECUTE')) <> 6 THEN
    RAISE EXCEPTION '022: the six operations must be SECURITY DEFINER, pinned, and not PUBLIC-executable' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('credit_verified_purchase(bigint,uuid,character varying)') IS NOT NULL THEN
    RAISE EXCEPTION '022: the V3 credit_verified_purchase overload exists and must be dropped' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgenabled = 'O' AND tgname IN ('trg_ai_credit_holds_settlement_guard', 'trg_user_balances_insert_guard')) <> 2 THEN
    RAISE EXCEPTION '022: guard trigger missing or disabled' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_credit_holds_ledger_same_user' AND convalidated)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_credit_ledger_id_user')
     OR (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('uq_ai_credit_holds_ledger_id', 'uq_credit_ledger_signup_once') AND i.indisvalid AND i.indisready AND i.indisunique) <> 2 THEN
    RAISE EXCEPTION '022: B-2 structure missing or invalid' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM credit_packages WHERE credits > 0 AND price_usd_cents > 0) < 1 OR NOT EXISTS (SELECT 1 FROM ledger_policy WHERE singleton AND signup_bonus_credits > 0) THEN
    RAISE EXCEPTION '022: policy tables are empty or invalid' USING ERRCODE = '55000';
  END IF;
  IF has_table_privilege('public', 'public.credit_packages', 'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('public', 'public.ledger_policy', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION '022: policy tables must not be accessible to PUBLIC' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.lemon_webhook_events'::regclass AND NOT attisdropped
        AND attname IN ('ingested_by', 'eligible', 'order_store_id', 'order_test_mode', 'order_variant_id', 'order_currency', 'order_total_cents',
                        'order_subtotal_cents', 'order_item_price_cents', 'buyer_user_id', 'buyer_email', 'pending_order_id')) <> 12 THEN
    RAISE EXCEPTION '022: webhook inbox columns missing' USING ERRCODE = '55000';
  END IF;
END
$$;
