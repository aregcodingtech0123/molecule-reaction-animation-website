-- =============================================================================
-- STAGED V7 CONTRACT ARTIFACT — step S2 — not applied by the migration runner — NOT production-approved
-- Staged as database/staged/phase-2c-v7/021_v4_delivery_guard_and_reconciliation.sql; source draft phase-2c-step-5-2-2-migration-021-draft-v4.sql (sha256 3f1d0879230172f3…, MANIFEST.json).
-- Purpose: write-once delivery guards, review amendments, reconciliation read functions (SQL draft v4).
-- Execution status, three separate facts:
--   * Disposable PostgreSQL: the V7 verification executed a copy of this file in a disposable PostgreSQL 18.6 test database,
--     with the role prefix moleculestudio_ replaced by v7v_20261109_ (V7 substitution record).
--   * Original role names: this file as staged, with the moleculestudio_ role names, has not been executed anywhere.
--   * Production: not executed in production or in any other non-disposable database; not production-approved.
-- Only comments differ from the source draft; the executable SQL is frozen (MANIFEST.json strippedSha256).
-- =============================================================================
-- MoleculeStudio — Phase 2C step 5.2.2: write-once delivery fields with role-aware and insert guards, append-only review
-- records without a goodwill outcome, and the reconciliation read functions (page, deferred, window, windowed deferred,
-- summary) with the four-guard status contract, a bounded grace period and a lossless cursor column.
--
-- Supersedes the v3 and v2 drafts (kept unchanged; v2 and v3 were executed only in disposable verification databases:
-- 686 and 341 recorded results). When written, this V4 text had not been executed; V7 later executed a role-substituted
-- copy of it (see the execution status above).
--
-- CHANGES IN v4 (design finalisation; exercised by V7 on a role-substituted copy, see the execution status above)
--   HORIZON ABOVE XMIN  a fifth condition inside the existing guard negative_horizon_age: p_horizon > pg_snapshot_xmin of the
--                  reader's current snapshot. An honest horizon is the snapshot xmin captured at run start; the xmin of any later
--                  snapshot can only be equal or larger (the oldest transaction still in progress never moves backwards), so an
--                  honest horizon never exceeds it. A horizon above it was not obtained from a snapshot of this cluster (fabricated,
--                  from another cluster, or from a restored copy) and would treat an in-progress writer as finished. NO new status
--                  code is added: the status set stays the seven documented codes, so CLI exit-code mapping is unchanged.
--                  LIMIT (stated, not hidden): a fabricated horizon between the run-start xmin and the present xmin cannot be
--                  detected in SQL; the CLI must derive the horizon itself, once, and reuse it.
--   FINAL ASSERTION  the migration now fails unless all five read functions contain the new condition.
--   UNCHANGED (deliberately): the four mandatory guards (negative_horizon_age, reader_transaction_has_xid,
--                  age_reference_behind_snapshot, transaction_began_before_run), the 64-bit horizon_span, horizon_out_of_range,
--                  txn_started_at and its client contract, exact microsecond text cursors, per-page autocommit, the hourly scope
--                  (t + grace, t + 24h], grace bounds 5 min..24 h, limit 1..500, fail-closed single status row, no partial output.
--                  End-to-end horizon-age behaviour was NEVER verified (test H3-7 was BLOCKED in the V3 run); that remains true.
--   DEPENDENCY     021 applies without 022, but its meaning relies on settled_at being final: apply 022 before the reconciliation
--                  CLI is adopted. The runner applies 021 before 022 when both are pending (file-name order).
--
--
-- CHANGES IN v3 (each traced to executed evidence in the complete verification report)
--   HORIZON RANGE  a new guard computes the horizon span in full 64-bit xid8 arithmetic,
--                  span = xmax(current snapshot) - p_horizon. span < 0 (a horizon from the future, including values that the
--                  32-bit age() wraps to a large POSITIVE age, evidence E-13a-diag) -> negative_horizon_age; span > 2^31 - 1 (a
--                  horizon too old for age() to measure) -> NEW status horizon_out_of_range. Both fail before any row.
--   TXN REUSE      SQL alone cannot detect an explicit transaction reused across pages on a quiet cluster (evidence E-9a, E-9c).
--                  Every status row now carries txn_started_at (exact UTC text of transaction_timestamp()). MANDATORY CLIENT
--                  CONTRACT: each page's txn_started_at must be strictly later than the previous page's; equal means the same
--                  transaction was reused -> abort the run, print nothing.
--   HOURLY SCOPE   documented coverage corrected to (t + grace, t + 24h] (evidence G-5a).
--   FREEZE BLOCK   the optional, commented-out settlement freeze is REMOVED from 021: settlement integrity is now enforced by
--                  migration 022 (ledger and settlement security), which must be applied before this one is adopted.
--
-- STATUS OF THIS FILE
--   * Staged in database/staged/phase-2c-v7/, outside database/init: the migration runner does not apply it. Moving it into
--     database/init is a later, separately approved step (Step 7.3); until then do not copy it there.
--   * Execution status: see the banner at the top of this file. It has not been executed under the original role names,
--     in production, or in any non-disposable database.
--   * The read functions are production-named, production-columned variants of the harness verified earlier (PostgreSQL
--     18.6, clone tables). They differ from it (see the package v2, section 10.2) and must be re-verified.
--
-- CHANGES FROM v1 (each is explained in the package v2)
--   F-L  the INSERT guard is no longer a "proposed addition": it is part of the write-once design; the UPDATE guard is now
--        role-aware (only the acknowledgement role or the table owner may record the first attempt).
--   F-I  grace is bounded: at least 5 minutes, at most 24 hours; anything else, including infinity, is rejected.
--   F-O  'goodwill_credited' is NOT an allowed review outcome until migration 022 exists.
--        Staging note: 022 does not implement goodwill either (its header says "023 or later"). The RAISE message in this file
--        that says "Goodwill is not implemented (migration 022)" is executable text and is left unchanged (known wording defect).
--   F-D  every paged function returns cursor_settled_at, an exact UTC text form of settled_at (microseconds).
--   F-B  an OPTIONAL settlement-freeze trigger is included as a COMMENTED-OUT block (section G); approving this file does
--        not enable it.
--   NEW  the summary function, the windowed deferred listing and the hourly "recent" scope (which is the window function
--        with CLI-computed bounds) are specified instead of left as placeholders.
--
-- RUNNER CONVENTIONS (services/auth-billing-service/scripts/lib/migrator.mjs)
--   * Number 021, not legacy: wrapped in ONE transaction with its schema_migrations row; a line consisting only of BEGIN;
--     COMMIT; ROLLBACK; or START TRANSACTION; is refused (none here). Forward-only and checksummed.
--   * Written to be re-runnable: an existing object is verified or the file fails loudly (final assertion block).
--
-- WHAT THIS FILE DOES NOT DO
--   * It adds neither answer_delivery_attempted_at nor delivery_tracking_enabled: migration 019 already did. It protects them.
--   * It creates no role and no GRANT (roles: the S3 and S6 role files; the application role's column grants: the S7 and
--     S10 files). It creates no index. It touches no ledger, balance, post_credit_transaction() or settlement
--     constraint. It has no SECURITY DEFINER function. It has no review/amend/goodwill WRITE function. Goodwill is not in
--     022 either ("023 or later") and is out of scope.
--
-- LOCKS: CREATE TRIGGER on ai_credit_holds takes SHARE ROW EXCLUSIVE (blocks reservations/captures until commit); every lock
-- wait is bounded by lock_timeout below, and no trigger DDL here takes ACCESS EXCLUSIVE on that table. Run off-peak.
-- =============================================================================

SET LOCAL lock_timeout = '3s';

-- -----------------------------------------------------------------------------
-- A. Preconditions: fail loudly if 019 / 020 are not in the state this file builds on.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.ai_credit_holds') IS NULL OR to_regclass('public.ai_delivery_gap_reviews') IS NULL THEN
    RAISE EXCEPTION '021 requires migrations 019 and 020: ai_credit_holds and ai_delivery_gap_reviews must exist'
      USING ERRCODE = '55000';
  END IF;

  IF (SELECT count(*)
      FROM pg_attribute a
      WHERE a.attrelid = 'public.ai_credit_holds'::regclass
        AND NOT a.attisdropped
        AND ((a.attname = 'delivery_tracking_enabled'    AND a.atttypid = 'boolean'::regtype     AND a.attnotnull)
          OR (a.attname = 'answer_delivery_attempted_at' AND a.atttypid = 'timestamptz'::regtype AND NOT a.attnotnull))) <> 2 THEN
    RAISE EXCEPTION '021 requires the two columns added by migration 019 on ai_credit_holds'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_credit_holds'::regclass
                   AND conname = 'ai_credit_holds_delivery_attempt_consistent'
                   AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION '021 requires the validated constraint ai_credit_holds_delivery_attempt_consistent (migrations 019 and 020)'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_delivery_gap_reviews'::regclass
                   AND conname = 'ai_delivery_gap_reviews_outcome' AND contype = 'c') THEN
    RAISE EXCEPTION '021 requires the constraint ai_delivery_gap_reviews_outcome (migration 020)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- B. ai_credit_holds: the delivery fields become write-once, and the first recording is role-aware.
--
-- ONE trigger function, TWO triggers. Which protects what:
--
--   trg_ai_credit_holds_delivery_insert_guard   BEFORE INSERT ... WHEN (NEW.answer_delivery_attempted_at IS NOT NULL)
--       PROTECTS INSERT. A hold must be born with answer_delivery_attempted_at NULL, for every role including the owner.
--       An acknowledgement exists only as an UPDATE of a captured reservation. Fires also for INSERT ... SELECT, COPY and
--       INSERT ... ON CONFLICT. (It cannot judge delivery_tracking_enabled: whether the service promised tracking is not
--       visible to the database. The flag is protected by column grants at INSERT and is immutable afterwards.)
--
--   trg_ai_credit_holds_delivery_write_once     BEFORE UPDATE OF delivery_tracking_enabled, answer_delivery_attempted_at
--                                               ... WHEN (either value changes)
--       PROTECTS UPDATE. (1) delivery_tracking_enabled can never change. (2) answer_delivery_attempted_at can go from NULL
--       to a value ONCE and can then never be cleared or overwritten. (3) The NULL -> value step may be taken only by the
--       acknowledgement role (moleculestudio_ack) or by a role that is, or is a member of, the owner of the table. The
--       application role is neither, so even if a broad UPDATE grant were ever restored (finding F-A) it still could not
--       record an acknowledgement.
--
-- WHY THE ROLE TEST IS RELIABLE WITHOUT SECURITY DEFINER: the function is SECURITY INVOKER, so current_user inside it is the
-- role executing the statement. It changes only through SET ROLE (needs membership, which the design forbids) or inside a
-- SECURITY DEFINER function (the only one, post_credit_transaction(), does not touch this table). The function pins
-- search_path to "public, pg_temp" (pg_catalog stays implicitly first), so a caller cannot shadow current_user's companions
-- pg_has_role() or the catalog with a temporary object. The owner and superusers can bypass any trigger (DISABLE TRIGGER,
-- session_replication_role = replica needs superuser): this is a guard, and the privilege boundary remains the column grants.
-- The role name is a project constant (design decision A-2). A deployment that renames the role must change this function.
--
-- It fires only when one of the two columns is targeted AND changes, so settlement updates (status, settled_at, ledger_id,
-- settle_reason) never run it, and the money path is unaffected.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_delivery_attempt_rewrite()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.answer_delivery_attempted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ai_credit_holds.answer_delivery_attempted_at cannot be set when a reservation is created'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.delivery_tracking_enabled IS DISTINCT FROM OLD.delivery_tracking_enabled THEN
    RAISE EXCEPTION 'ai_credit_holds.delivery_tracking_enabled is fixed when the reservation is created'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.answer_delivery_attempted_at IS NOT NULL
     AND NEW.answer_delivery_attempted_at IS DISTINCT FROM OLD.answer_delivery_attempted_at THEN
    RAISE EXCEPTION 'ai_credit_holds.answer_delivery_attempted_at is write-once'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.answer_delivery_attempted_at IS NULL AND NEW.answer_delivery_attempted_at IS NOT NULL THEN
    IF current_user::text <> 'moleculestudio_ack'
       AND NOT pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
      RAISE EXCEPTION 'only the acknowledgement role (or the table owner) may record a delivery attempt'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION prevent_delivery_attempt_rewrite() IS
  'Trigger function for ai_credit_holds. INSERT: the acknowledgement timestamp must be NULL. UPDATE: delivery_tracking_enabled is fixed; answer_delivery_attempted_at goes from NULL to a value once, by the acknowledgement role or the table owner only. A guard, not a boundary against the table owner. Records an attempt; never proves the client received the answer.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.ai_credit_holds'::regclass
                   AND tgname = 'trg_ai_credit_holds_delivery_write_once') THEN
    CREATE TRIGGER trg_ai_credit_holds_delivery_write_once
      BEFORE UPDATE OF delivery_tracking_enabled, answer_delivery_attempted_at ON ai_credit_holds
      FOR EACH ROW
      WHEN (OLD.delivery_tracking_enabled IS DISTINCT FROM NEW.delivery_tracking_enabled
            OR OLD.answer_delivery_attempted_at IS DISTINCT FROM NEW.answer_delivery_attempted_at)
      EXECUTE FUNCTION prevent_delivery_attempt_rewrite();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.ai_credit_holds'::regclass
                   AND tgname = 'trg_ai_credit_holds_delivery_insert_guard') THEN
    CREATE TRIGGER trg_ai_credit_holds_delivery_insert_guard
      BEFORE INSERT ON ai_credit_holds
      FOR EACH ROW
      WHEN (NEW.answer_delivery_attempted_at IS NOT NULL)
      EXECUTE FUNCTION prevent_delivery_attempt_rewrite();
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- C. ai_delivery_gap_reviews: bounded evidence, a corrected outcome name, NO goodwill outcome, and an enforced pairing.
--
-- 020 cannot be edited (checksummed). Its rows are append-only, so the legacy outcome 'acknowledgement_outage' stays allowed
-- by the outcome constraint FOREVER; a legacy row reads as 'acknowledgement_unrecorded' with evidence 'none'.
-- 'goodwill_credited' (allowed by 020) is REMOVED from the allowed list: the goodwill operation (migration 022) does not
-- exist, and the database cannot know whether any credit was posted, so the label would only let an owner record "credit
-- granted" by hand. Migration 022 must re-add it together with its own mechanism. If a review row with that outcome already
-- exists, this file STOPS with an explanatory error rather than rewriting or hiding it.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = 'public.ai_delivery_gap_reviews'::regclass
                   AND attname = 'evidence_code' AND NOT attisdropped) THEN
    -- A constant default is stored in the catalog (no table rewrite). Existing rows (none are expected) read 'none'.
    ALTER TABLE ai_delivery_gap_reviews ADD COLUMN evidence_code VARCHAR(32) NOT NULL DEFAULT 'none';
  END IF;
END
$$;

COMMENT ON COLUMN ai_delivery_gap_reviews.evidence_code IS
  'Bounded evidence behind the outcome. A code states what was looked at, never that the answer reached or did not reach the user. No free text.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_delivery_gap_reviews'::regclass
                   AND conname = 'ai_delivery_gap_reviews_evidence_code') THEN
    ALTER TABLE ai_delivery_gap_reviews
      ADD CONSTRAINT ai_delivery_gap_reviews_evidence_code
      CHECK (evidence_code IN ('none', 'log_unrecorded_event', 'log_probe_unresolved_event', 'log_capture_failed_event',
                               'user_report_not_received', 'user_report_received', 'cluster_pattern'));
  END IF;
END
$$;

-- Outcome constraint swap. Drift-aware. Pre-state (020): four labels including goodwill_credited. Post-state (021 v2):
-- acknowledgement_unrecorded, acknowledgement_outage (legacy), confirmed_withheld, inconclusive; no goodwill_credited.
-- Any other shape (including the v1 draft's shape, which allowed both) is drift, and the migration stops.
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.ai_delivery_gap_reviews'::regclass AND conname = 'ai_delivery_gap_reviews_outcome';

  IF position('acknowledgement_unrecorded' IN v_def) > 0 THEN
    IF position('goodwill_credited' IN v_def) > 0 OR position('acknowledgement_outage' IN v_def) = 0
       OR position('confirmed_withheld' IN v_def) = 0 OR position('inconclusive' IN v_def) = 0 THEN
      RAISE EXCEPTION 'ai_delivery_gap_reviews_outcome has drifted from the 021 definition: %', v_def USING ERRCODE = '55000';
    END IF;
  ELSE
    IF position('acknowledgement_outage' IN v_def) = 0 OR position('confirmed_withheld' IN v_def) = 0
       OR position('inconclusive' IN v_def) = 0 OR position('goodwill_credited' IN v_def) = 0 THEN
      RAISE EXCEPTION 'ai_delivery_gap_reviews_outcome has drifted from the 020 definition: %', v_def USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM ai_delivery_gap_reviews WHERE outcome = 'goodwill_credited') THEN
      RAISE EXCEPTION '021 cannot remove goodwill_credited: a review with that outcome exists. Goodwill is not implemented (migration 022); decide with the owner what that row means before continuing.'
        USING ERRCODE = '55000';
    END IF;
    ALTER TABLE ai_delivery_gap_reviews DROP CONSTRAINT ai_delivery_gap_reviews_outcome;
    ALTER TABLE ai_delivery_gap_reviews
      ADD CONSTRAINT ai_delivery_gap_reviews_outcome
      CHECK (outcome IN ('acknowledgement_unrecorded', 'acknowledgement_outage', 'confirmed_withheld', 'inconclusive'));
  END IF;
END
$$;

-- Outcome / evidence pairing. NOT VALID on purpose: enforced for every NEW row; a legacy row (outcome 'acknowledgement_outage',
-- evidence 'none') is exempt. The legacy label is therefore not in this list, so no new row can use it. DO NOT run
-- VALIDATE CONSTRAINT on this while a legacy row exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_delivery_gap_reviews'::regclass
                   AND conname = 'ai_delivery_gap_reviews_outcome_evidence') THEN
    ALTER TABLE ai_delivery_gap_reviews
      ADD CONSTRAINT ai_delivery_gap_reviews_outcome_evidence
      CHECK (
        (outcome = 'acknowledgement_unrecorded' AND evidence_code = 'log_unrecorded_event')
        OR (outcome = 'confirmed_withheld' AND evidence_code IN ('log_probe_unresolved_event', 'log_capture_failed_event'))
        OR outcome = 'inconclusive'
      ) NOT VALID;
  END IF;
END
$$;

COMMENT ON TABLE ai_delivery_gap_reviews IS
  'Owner-only, append-only: one bounded conclusion per reviewed delivery-attempt gap. Never changes credits and never records a goodwill credit (not implemented). A gap does not prove the answer was lost, and a recorded attempt does not prove it was received. Corrections go in ai_delivery_gap_review_amendments.';

-- -----------------------------------------------------------------------------
-- D. ai_delivery_gap_review_amendments: corrections to a completed review. Never reopens it; never edits it.
--
-- The effective conclusion is the highest amendment_no for the reservation, or the review row if there is none. Neither the
-- legacy label nor any goodwill outcome can be produced through an amendment. The number is capped at 20. Gap-free numbering
-- is the job of the future amend function (it serialises on the review row); the primary key already forbids a duplicate.
-- The columns other than the key mirror the review table (the earlier design named only the key and the cap: decision U-12).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_delivery_gap_review_amendments (
  user_id       UUID         NOT NULL,
  reference_id  VARCHAR(255) NOT NULL,
  amendment_no  SMALLINT     NOT NULL,
  outcome       VARCHAR(32)  NOT NULL,
  evidence_code VARCHAR(32)  NOT NULL,
  reviewer      VARCHAR(32)  NOT NULL,
  amended_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, reference_id, amendment_no),
  FOREIGN KEY (user_id, reference_id) REFERENCES ai_delivery_gap_reviews (user_id, reference_id) ON DELETE RESTRICT,
  CONSTRAINT ai_delivery_gap_review_amendments_number
    CHECK (amendment_no BETWEEN 1 AND 20),
  CONSTRAINT ai_delivery_gap_review_amendments_outcome
    CHECK (outcome IN ('acknowledgement_unrecorded', 'confirmed_withheld', 'inconclusive')),
  CONSTRAINT ai_delivery_gap_review_amendments_evidence_code
    CHECK (evidence_code IN ('none', 'log_unrecorded_event', 'log_probe_unresolved_event', 'log_capture_failed_event',
                             'user_report_not_received', 'user_report_received', 'cluster_pattern')),
  CONSTRAINT ai_delivery_gap_review_amendments_reviewer
    CHECK (reviewer ~ '^[a-z0-9._-]{2,32}$'),
  CONSTRAINT ai_delivery_gap_review_amendments_outcome_evidence
    CHECK (
      (outcome = 'acknowledgement_unrecorded' AND evidence_code = 'log_unrecorded_event')
      OR (outcome = 'confirmed_withheld' AND evidence_code IN ('log_probe_unresolved_event', 'log_capture_failed_event'))
      OR outcome = 'inconclusive'
    )
);

COMMENT ON TABLE ai_delivery_gap_review_amendments IS
  'Owner-only, append-only corrections to a completed delivery-gap review. A review is never reopened or edited; the highest amendment_no is the effective conclusion. Never changes credits; cannot record a goodwill credit.';

REVOKE ALL ON ai_delivery_gap_review_amendments FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- E. Append-only guard for both record tables (row UPDATE/DELETE and statement TRUNCATE). Error class 55000 like the ledger
-- guard. A guard, not a boundary against the owner; a tamper check that reports disabled triggers is a future read-only
-- function, not part of this draft.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_review_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

COMMENT ON FUNCTION prevent_review_mutation() IS
  'Trigger function: refuses UPDATE, DELETE and TRUNCATE on the delivery-gap review and amendment tables. A guard, not a boundary against the table owner.';

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['ai_delivery_gap_reviews', 'ai_delivery_gap_review_amendments']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgrelid = format('public.%I', v_table)::regclass
                     AND tgname = 'trg_' || v_table || '_append_only') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_review_mutation()',
        'trg_' || v_table || '_append_only', v_table);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgrelid = format('public.%I', v_table)::regclass
                     AND tgname = 'trg_' || v_table || '_no_truncate') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION prevent_review_mutation()',
        'trg_' || v_table || '_no_truncate', v_table);
    END IF;
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- F. Reconciliation read functions (read-only; STABLE; SECURITY INVOKER; owner-only).
--
-- THE CONTRACT (design v5, unchanged; enforced inside the one SQL statement of every function below):
--   * Exactly ONE row with row_kind = 'status' per call, always, including for an empty page.
--   * Data rows (row_kind 'candidate' / 'deferred') only when status_code = 'ok'. The summary function returns ONE row
--     (row_kind 'status') whose counts are NULL, not zero, unless the status is 'ok'.
--   * Seven status codes, first match wins:
--       invalid_parameter | reader_transaction_has_xid | transaction_began_before_run
--       | age_reference_behind_snapshot | negative_horizon_age | horizon_out_of_range | ok
--     negative_horizon_age now also covers a horizon AHEAD of the current snapshot in 64-bit terms (span < 0), which the 32-bit
--     age() alone can wrap to a positive value, and (v4) a horizon above the reader's snapshot xmin; horizon_out_of_range covers a
--     span above 2^31 - 1.
--   * txn_started_at (status row only) is the exact start time of the transaction that ran the page. The client MUST abort the
--     run unless every page's value is strictly later than the previous page's (autocommit per page). SQL cannot enforce this.
--     All FOUR guards are in EVERY function below: reader_has_xid (pg_current_xact_id_if_assigned() IS NOT NULL),
--     began_before_run (transaction_timestamp() < p_as_of), snapshot_xmax_age < 0 (age_reference_behind_snapshot) and
--     horizon_age < 0 (negative_horizon_age). None may be removed, weakened or turned into a warning.
--   * The caller (CLI) MUST: call each page as its own single-statement autocommit transaction on a direct (non-pooled)
--     connection that holds no transaction id; reuse the SAME p_as_of and p_horizon on every page; treat any status other
--     than 'ok', a missing or duplicated status row, or an SQL error as a failed run and discard every earlier page.
--   * The row predicate is the reviewed text, character for character. Do not "simplify" it:
--         NOT (age(h.xmin) BETWEEN 1 AND age(((p_horizon::text::numeric % 4294967296)::text)::xid))
--     and its complement for the deferred listings:
--         age(h.xmin) BETWEEN 1 AND age(((p_horizon::text::numeric % 4294967296)::text)::xid)
--   * The MATERIALIZED CTEs are load-bearing: the guards run exactly once per call and are shared by the status row and the
--     data rows. Removing MATERIALIZED can allow duplicate evaluation (regression test M-RD-12).
--   * p_limit is REJECTED outside 1..500 (not clamped). The functions return up to p_limit + 1 data rows: the extra row only
--     tells the caller that another page exists and must never be printed or used as the cursor.
--   * p_grace is REJECTED outside [5 minutes, 24 hours] (not clamped) and NULL is rejected. "infinity" and "-infinity"
--     (PostgreSQL 17 and later) fail the bounds; on earlier versions they and "NaN" are input errors before the call.
--     The 24-hour maximum is a PROPOSED correction (finding F-I), not a verified project decision: it needs approval.
--     The CLI default of 15 minutes is applied by the CLI only when the caller omitted the value; the functions have no
--     parameter defaults, so an omitted argument is an "undefined function" error and an explicit NULL is invalid_parameter.
--   * TIMESTAMP CURSOR: cursor_settled_at is an exact UTC text form of settled_at with six fractional digits
--     ('YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), independent of the session's TimeZone and DateStyle. The caller passes it back
--     UNCHANGED as the p_after_settled_at argument, cast ($n::timestamptz). Nothing that crosses to the caller as a
--     pagination value may be converted to a JavaScript Date or reconstructed through a date library (package v2, section 4).
--   * No e-mail, token, prompt or answer is returned.
-- -----------------------------------------------------------------------------

-- F.1 normal scan: captured, tracked, no recorded attempt, not reviewed, past the grace, writer finished before the run.
CREATE OR REPLACE FUNCTION delivery_attempt_gaps_to_review(
  p_as_of              TIMESTAMPTZ,
  p_horizon            XID8,
  p_grace              INTERVAL,
  p_limit              INTEGER,
  p_after_settled_at   TIMESTAMPTZ,
  p_after_user_id      UUID,
  p_after_reference_id TEXT
)
RETURNS TABLE (
  row_kind              TEXT,
  status_code           TEXT,
  horizon_age           INTEGER,
  reader_has_xid        BOOLEAN,
  snapshot_xmax_age     INTEGER,
  reference_id          TEXT,
  user_id               UUID,
  amount                INTEGER,
  operation_type        TEXT,
  created_at            TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ,
  ledger_id             BIGINT,
  minutes_since_settled INTEGER,
  writer                XID,
  cursor_settled_at     TEXT,
  txn_started_at        TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH g AS MATERIALIZED (
    SELECT
      age(((p_horizon::text::numeric % 4294967296)::text)::xid)                                          AS horizon_age,
      pg_snapshot_xmax(pg_current_snapshot())::text::numeric - p_horizon::text::numeric                    AS horizon_span,
      p_horizon > pg_snapshot_xmin(pg_current_snapshot())                                                  AS horizon_above_xmin,
      pg_current_xact_id_if_assigned() IS NOT NULL                                                         AS reader_has_xid,
      transaction_timestamp() < p_as_of                                                                    AS began_before_run,
      age(((pg_snapshot_xmax(pg_current_snapshot())::text::numeric % 4294967296)::text)::xid)             AS snapshot_xmax_age,
      coalesce(p_as_of IS NULL OR p_horizon IS NULL OR p_grace IS NULL OR p_limit IS NULL
               OR p_grace < interval '5 minutes'
               OR p_grace > interval '24 hours'
               OR p_limit NOT BETWEEN 1 AND 500
               OR (p_after_settled_at IS NULL) <> (p_after_user_id IS NULL)
               OR (p_after_settled_at IS NULL) <> (p_after_reference_id IS NULL)
               OR p_as_of > clock_timestamp(), true)                                                       AS bad_param
  ), s AS MATERIALIZED (
    SELECT g.horizon_age, g.reader_has_xid, g.snapshot_xmax_age,
           CASE WHEN g.bad_param OR g.horizon_age IS NULL THEN 'invalid_parameter'
                WHEN g.reader_has_xid                     THEN 'reader_transaction_has_xid'
                WHEN g.began_before_run                   THEN 'transaction_began_before_run'
                WHEN g.snapshot_xmax_age < 0              THEN 'age_reference_behind_snapshot'
                WHEN g.horizon_age < 0 OR g.horizon_span < 0 OR g.horizon_above_xmin THEN 'negative_horizon_age'
                WHEN g.horizon_span > 2147483647           THEN 'horizon_out_of_range'
                ELSE 'ok' END AS status_code
    FROM g
  )
  SELECT 'status', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
         NULL::text, NULL::uuid, NULL::integer, NULL::text, NULL::timestamptz, NULL::timestamptz,
         NULL::bigint, NULL::integer, NULL::xid, NULL::text,
         to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM s
  UNION ALL
  SELECT * FROM (
    SELECT 'candidate', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
           h.reference_id::text, h.user_id, h.amount, h.operation_type::text, h.created_at, h.settled_at,
           h.ledger_id, floor(extract(epoch FROM (p_as_of - h.settled_at)) / 60)::integer, h.xmin,
           to_char(h.settled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           NULL::text
    FROM s
    CROSS JOIN ai_credit_holds h
    LEFT JOIN ai_delivery_gap_reviews r ON r.user_id = h.user_id AND r.reference_id = h.reference_id
    WHERE s.status_code = 'ok'
      AND h.status = 'captured'
      AND h.delivery_tracking_enabled
      AND h.answer_delivery_attempted_at IS NULL
      AND h.settled_at < p_as_of - p_grace
      AND r.reference_id IS NULL
      AND NOT (age(h.xmin) BETWEEN 1 AND age(((p_horizon::text::numeric % 4294967296)::text)::xid))
      AND (p_after_settled_at IS NULL
           OR (h.settled_at, h.user_id, h.reference_id) > (p_after_settled_at, p_after_user_id, p_after_reference_id))
    ORDER BY h.settled_at, h.user_id, h.reference_id
    LIMIT p_limit::bigint + 1
  ) page
$$;

COMMENT ON FUNCTION delivery_attempt_gaps_to_review(TIMESTAMPTZ, XID8, INTERVAL, INTEGER, TIMESTAMPTZ, UUID, TEXT) IS
  'Read-only, one page of captured tracked reservations with no recorded delivery attempt that no review covers and whose writing transaction finished before the run. Always one status row; data rows only when status_code is ok. A listed row is a candidate for review, not proof that the answer was lost.';

-- F.2 deferred listing: the same rows, except that the writing transaction is in [horizon, latest assigned id]. NOT confirmed
-- gaps; the next run re-examines them. Same status contract, same cursor, same limits.
CREATE OR REPLACE FUNCTION delivery_attempt_deferred_to_review(
  p_as_of              TIMESTAMPTZ,
  p_horizon            XID8,
  p_grace              INTERVAL,
  p_limit              INTEGER,
  p_after_settled_at   TIMESTAMPTZ,
  p_after_user_id      UUID,
  p_after_reference_id TEXT
)
RETURNS TABLE (
  row_kind              TEXT,
  status_code           TEXT,
  horizon_age           INTEGER,
  reader_has_xid        BOOLEAN,
  snapshot_xmax_age     INTEGER,
  reference_id          TEXT,
  user_id               UUID,
  amount                INTEGER,
  operation_type        TEXT,
  created_at            TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ,
  ledger_id             BIGINT,
  minutes_since_settled INTEGER,
  writer                XID,
  cursor_settled_at     TEXT,
  txn_started_at        TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH g AS MATERIALIZED (
    SELECT
      age(((p_horizon::text::numeric % 4294967296)::text)::xid)                                          AS horizon_age,
      pg_snapshot_xmax(pg_current_snapshot())::text::numeric - p_horizon::text::numeric                    AS horizon_span,
      p_horizon > pg_snapshot_xmin(pg_current_snapshot())                                                  AS horizon_above_xmin,
      pg_current_xact_id_if_assigned() IS NOT NULL                                                         AS reader_has_xid,
      transaction_timestamp() < p_as_of                                                                    AS began_before_run,
      age(((pg_snapshot_xmax(pg_current_snapshot())::text::numeric % 4294967296)::text)::xid)             AS snapshot_xmax_age,
      coalesce(p_as_of IS NULL OR p_horizon IS NULL OR p_grace IS NULL OR p_limit IS NULL
               OR p_grace < interval '5 minutes'
               OR p_grace > interval '24 hours'
               OR p_limit NOT BETWEEN 1 AND 500
               OR (p_after_settled_at IS NULL) <> (p_after_user_id IS NULL)
               OR (p_after_settled_at IS NULL) <> (p_after_reference_id IS NULL)
               OR p_as_of > clock_timestamp(), true)                                                       AS bad_param
  ), s AS MATERIALIZED (
    SELECT g.horizon_age, g.reader_has_xid, g.snapshot_xmax_age,
           CASE WHEN g.bad_param OR g.horizon_age IS NULL THEN 'invalid_parameter'
                WHEN g.reader_has_xid                     THEN 'reader_transaction_has_xid'
                WHEN g.began_before_run                   THEN 'transaction_began_before_run'
                WHEN g.snapshot_xmax_age < 0              THEN 'age_reference_behind_snapshot'
                WHEN g.horizon_age < 0 OR g.horizon_span < 0 OR g.horizon_above_xmin THEN 'negative_horizon_age'
                WHEN g.horizon_span > 2147483647           THEN 'horizon_out_of_range'
                ELSE 'ok' END AS status_code
    FROM g
  )
  SELECT 'status', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
         NULL::text, NULL::uuid, NULL::integer, NULL::text, NULL::timestamptz, NULL::timestamptz,
         NULL::bigint, NULL::integer, NULL::xid, NULL::text,
         to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM s
  UNION ALL
  SELECT * FROM (
    SELECT 'deferred', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
           h.reference_id::text, h.user_id, h.amount, h.operation_type::text, h.created_at, h.settled_at,
           h.ledger_id, floor(extract(epoch FROM (p_as_of - h.settled_at)) / 60)::integer, h.xmin,
           to_char(h.settled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           NULL::text
    FROM s
    CROSS JOIN ai_credit_holds h
    LEFT JOIN ai_delivery_gap_reviews r ON r.user_id = h.user_id AND r.reference_id = h.reference_id
    WHERE s.status_code = 'ok'
      AND h.status = 'captured'
      AND h.delivery_tracking_enabled
      AND h.answer_delivery_attempted_at IS NULL
      AND h.settled_at < p_as_of - p_grace
      AND r.reference_id IS NULL
      AND age(h.xmin) BETWEEN 1 AND age(((p_horizon::text::numeric % 4294967296)::text)::xid)
      AND (p_after_settled_at IS NULL
           OR (h.settled_at, h.user_id, h.reference_id) > (p_after_settled_at, p_after_user_id, p_after_reference_id))
    ORDER BY h.settled_at, h.user_id, h.reference_id
    LIMIT p_limit::bigint + 1
  ) page
$$;

COMMENT ON FUNCTION delivery_attempt_deferred_to_review(TIMESTAMPTZ, XID8, INTERVAL, INTEGER, TIMESTAMPTZ, UUID, TEXT) IS
  'Read-only, one page of reservations that would be gap candidates but whose writing transaction had not finished when the run started. NOT confirmed gaps: the next run re-examines them. Same status contract as delivery_attempt_gaps_to_review.';

-- F.3 window scan: the normal candidates whose settled_at lies in the half-open window [p_since, p_until), at most 24 hours.
-- p_since and p_until are required. THIS FUNCTION IS ALSO THE "HOURLY RECENT" SCOPE: the caller passes p_until = the run's
-- p_as_of and p_since = p_as_of - 24 hours (computed in SQL, never in JavaScript). A reservation settled at t is covered by the
-- runs whose as_of lies in (t + grace, t + 24h] (inclusive at t + 24h because the window includes since). It never replaces the
-- normal scan; the daily full scan is the safety net after missed hourly runs.
CREATE OR REPLACE FUNCTION delivery_attempt_gaps_in_window(
  p_as_of              TIMESTAMPTZ,
  p_horizon            XID8,
  p_since              TIMESTAMPTZ,
  p_until              TIMESTAMPTZ,
  p_grace              INTERVAL,
  p_limit              INTEGER,
  p_after_settled_at   TIMESTAMPTZ,
  p_after_user_id      UUID,
  p_after_reference_id TEXT
)
RETURNS TABLE (
  row_kind              TEXT,
  status_code           TEXT,
  horizon_age           INTEGER,
  reader_has_xid        BOOLEAN,
  snapshot_xmax_age     INTEGER,
  reference_id          TEXT,
  user_id               UUID,
  amount                INTEGER,
  operation_type        TEXT,
  created_at            TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ,
  ledger_id             BIGINT,
  minutes_since_settled INTEGER,
  writer                XID,
  cursor_settled_at     TEXT,
  txn_started_at        TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH g AS MATERIALIZED (
    SELECT
      age(((p_horizon::text::numeric % 4294967296)::text)::xid)                                          AS horizon_age,
      pg_snapshot_xmax(pg_current_snapshot())::text::numeric - p_horizon::text::numeric                    AS horizon_span,
      p_horizon > pg_snapshot_xmin(pg_current_snapshot())                                                  AS horizon_above_xmin,
      pg_current_xact_id_if_assigned() IS NOT NULL                                                         AS reader_has_xid,
      transaction_timestamp() < p_as_of                                                                    AS began_before_run,
      age(((pg_snapshot_xmax(pg_current_snapshot())::text::numeric % 4294967296)::text)::xid)             AS snapshot_xmax_age,
      coalesce(p_as_of IS NULL OR p_horizon IS NULL OR p_grace IS NULL OR p_limit IS NULL
               OR p_since IS NULL OR p_until IS NULL
               OR p_until <= p_since
               OR p_until > p_since + interval '24 hours'
               OR p_grace < interval '5 minutes'
               OR p_grace > interval '24 hours'
               OR p_limit NOT BETWEEN 1 AND 500
               OR (p_after_settled_at IS NULL) <> (p_after_user_id IS NULL)
               OR (p_after_settled_at IS NULL) <> (p_after_reference_id IS NULL)
               OR p_as_of > clock_timestamp(), true)                                                       AS bad_param
  ), s AS MATERIALIZED (
    SELECT g.horizon_age, g.reader_has_xid, g.snapshot_xmax_age,
           CASE WHEN g.bad_param OR g.horizon_age IS NULL THEN 'invalid_parameter'
                WHEN g.reader_has_xid                     THEN 'reader_transaction_has_xid'
                WHEN g.began_before_run                   THEN 'transaction_began_before_run'
                WHEN g.snapshot_xmax_age < 0              THEN 'age_reference_behind_snapshot'
                WHEN g.horizon_age < 0 OR g.horizon_span < 0 OR g.horizon_above_xmin THEN 'negative_horizon_age'
                WHEN g.horizon_span > 2147483647           THEN 'horizon_out_of_range'
                ELSE 'ok' END AS status_code
    FROM g
  )
  SELECT 'status', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
         NULL::text, NULL::uuid, NULL::integer, NULL::text, NULL::timestamptz, NULL::timestamptz,
         NULL::bigint, NULL::integer, NULL::xid, NULL::text,
         to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM s
  UNION ALL
  SELECT * FROM (
    SELECT 'candidate', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
           h.reference_id::text, h.user_id, h.amount, h.operation_type::text, h.created_at, h.settled_at,
           h.ledger_id, floor(extract(epoch FROM (p_as_of - h.settled_at)) / 60)::integer, h.xmin,
           to_char(h.settled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           NULL::text
    FROM s
    CROSS JOIN ai_credit_holds h
    LEFT JOIN ai_delivery_gap_reviews r ON r.user_id = h.user_id AND r.reference_id = h.reference_id
    WHERE s.status_code = 'ok'
      AND h.status = 'captured'
      AND h.delivery_tracking_enabled
      AND h.answer_delivery_attempted_at IS NULL
      AND h.settled_at >= p_since
      AND h.settled_at <  p_until
      AND h.settled_at < p_as_of - p_grace
      AND r.reference_id IS NULL
      AND NOT (age(h.xmin) BETWEEN 1 AND age(((p_horizon::text::numeric % 4294967296)::text)::xid))
      AND (p_after_settled_at IS NULL
           OR (h.settled_at, h.user_id, h.reference_id) > (p_after_settled_at, p_after_user_id, p_after_reference_id))
    ORDER BY h.settled_at, h.user_id, h.reference_id
    LIMIT p_limit::bigint + 1
  ) page
$$;

COMMENT ON FUNCTION delivery_attempt_gaps_in_window(TIMESTAMPTZ, XID8, TIMESTAMPTZ, TIMESTAMPTZ, INTERVAL, INTEGER, TIMESTAMPTZ, UUID, TEXT) IS
  'Read-only, one page of the normal candidates whose settled_at lies in the half-open window [p_since, p_until), at most 24 hours. Also the hourly recent scope (p_until = run as_of, p_since = as_of minus 24 hours). Never replaces the normal scan. Same status contract as delivery_attempt_gaps_to_review.';

-- F.4 windowed deferred listing: exactly the window function with the complement of the xid predicate. A SEPARATE function
-- (decision U-3). Same window rules, same four guards on every page, same cursor, same fixed run-start as_of and horizon. A row
-- cannot disappear between pages except by being acknowledged or reviewed: its xmin and the fixed horizon do not change.
CREATE OR REPLACE FUNCTION delivery_attempt_deferred_in_window(
  p_as_of              TIMESTAMPTZ,
  p_horizon            XID8,
  p_since              TIMESTAMPTZ,
  p_until              TIMESTAMPTZ,
  p_grace              INTERVAL,
  p_limit              INTEGER,
  p_after_settled_at   TIMESTAMPTZ,
  p_after_user_id      UUID,
  p_after_reference_id TEXT
)
RETURNS TABLE (
  row_kind              TEXT,
  status_code           TEXT,
  horizon_age           INTEGER,
  reader_has_xid        BOOLEAN,
  snapshot_xmax_age     INTEGER,
  reference_id          TEXT,
  user_id               UUID,
  amount                INTEGER,
  operation_type        TEXT,
  created_at            TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ,
  ledger_id             BIGINT,
  minutes_since_settled INTEGER,
  writer                XID,
  cursor_settled_at     TEXT,
  txn_started_at        TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH g AS MATERIALIZED (
    SELECT
      age(((p_horizon::text::numeric % 4294967296)::text)::xid)                                          AS horizon_age,
      pg_snapshot_xmax(pg_current_snapshot())::text::numeric - p_horizon::text::numeric                    AS horizon_span,
      p_horizon > pg_snapshot_xmin(pg_current_snapshot())                                                  AS horizon_above_xmin,
      pg_current_xact_id_if_assigned() IS NOT NULL                                                         AS reader_has_xid,
      transaction_timestamp() < p_as_of                                                                    AS began_before_run,
      age(((pg_snapshot_xmax(pg_current_snapshot())::text::numeric % 4294967296)::text)::xid)             AS snapshot_xmax_age,
      coalesce(p_as_of IS NULL OR p_horizon IS NULL OR p_grace IS NULL OR p_limit IS NULL
               OR p_since IS NULL OR p_until IS NULL
               OR p_until <= p_since
               OR p_until > p_since + interval '24 hours'
               OR p_grace < interval '5 minutes'
               OR p_grace > interval '24 hours'
               OR p_limit NOT BETWEEN 1 AND 500
               OR (p_after_settled_at IS NULL) <> (p_after_user_id IS NULL)
               OR (p_after_settled_at IS NULL) <> (p_after_reference_id IS NULL)
               OR p_as_of > clock_timestamp(), true)                                                       AS bad_param
  ), s AS MATERIALIZED (
    SELECT g.horizon_age, g.reader_has_xid, g.snapshot_xmax_age,
           CASE WHEN g.bad_param OR g.horizon_age IS NULL THEN 'invalid_parameter'
                WHEN g.reader_has_xid                     THEN 'reader_transaction_has_xid'
                WHEN g.began_before_run                   THEN 'transaction_began_before_run'
                WHEN g.snapshot_xmax_age < 0              THEN 'age_reference_behind_snapshot'
                WHEN g.horizon_age < 0 OR g.horizon_span < 0 OR g.horizon_above_xmin THEN 'negative_horizon_age'
                WHEN g.horizon_span > 2147483647           THEN 'horizon_out_of_range'
                ELSE 'ok' END AS status_code
    FROM g
  )
  SELECT 'status', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
         NULL::text, NULL::uuid, NULL::integer, NULL::text, NULL::timestamptz, NULL::timestamptz,
         NULL::bigint, NULL::integer, NULL::xid, NULL::text,
         to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM s
  UNION ALL
  SELECT * FROM (
    SELECT 'deferred', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
           h.reference_id::text, h.user_id, h.amount, h.operation_type::text, h.created_at, h.settled_at,
           h.ledger_id, floor(extract(epoch FROM (p_as_of - h.settled_at)) / 60)::integer, h.xmin,
           to_char(h.settled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           NULL::text
    FROM s
    CROSS JOIN ai_credit_holds h
    LEFT JOIN ai_delivery_gap_reviews r ON r.user_id = h.user_id AND r.reference_id = h.reference_id
    WHERE s.status_code = 'ok'
      AND h.status = 'captured'
      AND h.delivery_tracking_enabled
      AND h.answer_delivery_attempted_at IS NULL
      AND h.settled_at >= p_since
      AND h.settled_at <  p_until
      AND h.settled_at < p_as_of - p_grace
      AND r.reference_id IS NULL
      AND age(h.xmin) BETWEEN 1 AND age(((p_horizon::text::numeric % 4294967296)::text)::xid)
      AND (p_after_settled_at IS NULL
           OR (h.settled_at, h.user_id, h.reference_id) > (p_after_settled_at, p_after_user_id, p_after_reference_id))
    ORDER BY h.settled_at, h.user_id, h.reference_id
    LIMIT p_limit::bigint + 1
  ) page
$$;

COMMENT ON FUNCTION delivery_attempt_deferred_in_window(TIMESTAMPTZ, XID8, TIMESTAMPTZ, TIMESTAMPTZ, INTERVAL, INTEGER, TIMESTAMPTZ, UUID, TEXT) IS
  'Read-only, one page of deferred reservations (writing transaction not finished when the run started) whose settled_at lies in [p_since, p_until), at most 24 hours. NOT confirmed gaps. Same status contract as delivery_attempt_gaps_in_window.';

-- F.5 summary: ONE row (row_kind 'status') with counts that partition the captured, tracked reservations in scope.
-- Scope: p_since and p_until both NULL = every such reservation ("full"); both set = the window [p_since, p_until) of at most
-- 24 hours ("window"); exactly one set is invalid_parameter. Each reservation falls in exactly ONE bucket, by precedence:
--   acknowledged   an attempt is recorded (a normal turn)
--   reviewed       no attempt, but a review row exists (amended_count is the reviewed ones that also have an amendment)
--   within_grace   no attempt, not reviewed, settled_at >= p_as_of - p_grace (not yet eligible)
--   deferred       the rest, writing transaction not finished when the run started (the complement of the reviewed predicate)
--   candidate      the rest (the reviewed predicate)
-- total_count = the sum of those five buckets (a property the verification checks). When the status is not 'ok' every count and
-- both oldest_* values are NULL, never zero. The counting cost on a production-sized table is UNMEASURED.
CREATE OR REPLACE FUNCTION delivery_attempt_gap_summary(
  p_as_of     TIMESTAMPTZ,
  p_horizon   XID8,
  p_grace     INTERVAL,
  p_since     TIMESTAMPTZ,
  p_until     TIMESTAMPTZ
)
RETURNS TABLE (
  row_kind                    TEXT,
  status_code                 TEXT,
  horizon_age                 INTEGER,
  reader_has_xid              BOOLEAN,
  snapshot_xmax_age           INTEGER,
  scope_kind                  TEXT,
  total_count                 BIGINT,
  candidate_count             BIGINT,
  deferred_count              BIGINT,
  within_grace_count          BIGINT,
  reviewed_count              BIGINT,
  amended_count               BIGINT,
  acknowledged_count          BIGINT,
  oldest_candidate_settled_at TIMESTAMPTZ,
  oldest_deferred_settled_at  TIMESTAMPTZ,
  txn_started_at              TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH g AS MATERIALIZED (
    SELECT
      age(((p_horizon::text::numeric % 4294967296)::text)::xid)                                          AS horizon_age,
      pg_snapshot_xmax(pg_current_snapshot())::text::numeric - p_horizon::text::numeric                    AS horizon_span,
      p_horizon > pg_snapshot_xmin(pg_current_snapshot())                                                  AS horizon_above_xmin,
      pg_current_xact_id_if_assigned() IS NOT NULL                                                         AS reader_has_xid,
      transaction_timestamp() < p_as_of                                                                    AS began_before_run,
      age(((pg_snapshot_xmax(pg_current_snapshot())::text::numeric % 4294967296)::text)::xid)             AS snapshot_xmax_age,
      coalesce(p_as_of IS NULL OR p_horizon IS NULL OR p_grace IS NULL
               OR p_grace < interval '5 minutes'
               OR p_grace > interval '24 hours'
               OR (p_since IS NULL) <> (p_until IS NULL)
               OR (p_since IS NOT NULL AND (p_until <= p_since OR p_until > p_since + interval '24 hours'))
               OR p_as_of > clock_timestamp(), true)                                                       AS bad_param
  ), s AS MATERIALIZED (
    SELECT g.horizon_age, g.reader_has_xid, g.snapshot_xmax_age,
           CASE WHEN g.bad_param OR g.horizon_age IS NULL THEN 'invalid_parameter'
                WHEN g.reader_has_xid                     THEN 'reader_transaction_has_xid'
                WHEN g.began_before_run                   THEN 'transaction_began_before_run'
                WHEN g.snapshot_xmax_age < 0              THEN 'age_reference_behind_snapshot'
                WHEN g.horizon_age < 0 OR g.horizon_span < 0 OR g.horizon_above_xmin THEN 'negative_horizon_age'
                WHEN g.horizon_span > 2147483647           THEN 'horizon_out_of_range'
                ELSE 'ok' END AS status_code
    FROM g
  )
  SELECT 'status', s.status_code, s.horizon_age, s.reader_has_xid, s.snapshot_xmax_age,
         CASE WHEN p_since IS NULL AND p_until IS NULL THEN 'full'
              WHEN p_since IS NOT NULL AND p_until IS NOT NULL THEN 'window' END,
         CASE WHEN s.status_code = 'ok' THEN a.total_count END,
         CASE WHEN s.status_code = 'ok' THEN a.candidate_count END,
         CASE WHEN s.status_code = 'ok' THEN a.deferred_count END,
         CASE WHEN s.status_code = 'ok' THEN a.within_grace_count END,
         CASE WHEN s.status_code = 'ok' THEN a.reviewed_count END,
         CASE WHEN s.status_code = 'ok' THEN a.amended_count END,
         CASE WHEN s.status_code = 'ok' THEN a.acknowledged_count END,
         CASE WHEN s.status_code = 'ok' THEN a.oldest_candidate_settled_at END,
         CASE WHEN s.status_code = 'ok' THEN a.oldest_deferred_settled_at END,
         to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM s
  CROSS JOIN LATERAL (
    SELECT
      count(*)                                                                            AS total_count,
      count(*) FILTER (WHERE NOT x.acked AND NOT x.reviewed AND x.past_grace AND x.candidate_xid) AS candidate_count,
      count(*) FILTER (WHERE NOT x.acked AND NOT x.reviewed AND x.past_grace AND x.deferred)      AS deferred_count,
      count(*) FILTER (WHERE NOT x.acked AND NOT x.reviewed AND NOT x.past_grace)                 AS within_grace_count,
      count(*) FILTER (WHERE NOT x.acked AND x.reviewed)                                          AS reviewed_count,
      count(*) FILTER (WHERE NOT x.acked AND x.reviewed AND x.amended)                            AS amended_count,
      count(*) FILTER (WHERE x.acked)                                                             AS acknowledged_count,
      min(x.settled_at) FILTER (WHERE NOT x.acked AND NOT x.reviewed AND x.past_grace AND x.candidate_xid) AS oldest_candidate_settled_at,
      min(x.settled_at) FILTER (WHERE NOT x.acked AND NOT x.reviewed AND x.past_grace AND x.deferred)      AS oldest_deferred_settled_at
    FROM (
      SELECT h.settled_at,
             h.answer_delivery_attempted_at IS NOT NULL AS acked,
             r.reference_id IS NOT NULL AS reviewed,
             (r.reference_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM ai_delivery_gap_review_amendments m
                          WHERE m.user_id = h.user_id AND m.reference_id = h.reference_id)) AS amended,
             (h.settled_at < p_as_of - p_grace) AS past_grace,
             (NOT (age(h.xmin) BETWEEN 1 AND age(((p_horizon::text::numeric % 4294967296)::text)::xid))) AS candidate_xid,
             (age(h.xmin) BETWEEN 1 AND age(((p_horizon::text::numeric % 4294967296)::text)::xid)) AS deferred
      FROM ai_credit_holds h
      LEFT JOIN ai_delivery_gap_reviews r ON r.user_id = h.user_id AND r.reference_id = h.reference_id
      WHERE s.status_code = 'ok'
        AND h.status = 'captured'
        AND h.delivery_tracking_enabled
        AND (p_since IS NULL OR (h.settled_at >= p_since AND h.settled_at < p_until))
    ) x
  ) a
$$;

COMMENT ON FUNCTION delivery_attempt_gap_summary(TIMESTAMPTZ, XID8, INTERVAL, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Read-only, one row: counts of captured tracked reservations in scope by exclusive bucket (acknowledged, reviewed, within grace, deferred, candidate), NULL counts unless status_code is ok. Deferred and unreviewed rows are counted separately and never hidden.';

REVOKE ALL ON FUNCTION delivery_attempt_gaps_to_review(TIMESTAMPTZ, XID8, INTERVAL, INTEGER, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery_attempt_deferred_to_review(TIMESTAMPTZ, XID8, INTERVAL, INTEGER, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery_attempt_gaps_in_window(TIMESTAMPTZ, XID8, TIMESTAMPTZ, TIMESTAMPTZ, INTERVAL, INTEGER, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery_attempt_deferred_in_window(TIMESTAMPTZ, XID8, TIMESTAMPTZ, TIMESTAMPTZ, INTERVAL, INTEGER, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delivery_attempt_gap_summary(TIMESTAMPTZ, XID8, INTERVAL, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- G. (v3) The optional settlement-freeze block of v2 was removed: settlement integrity (final settled state, exact capture link,
-- no future settled_at) is enforced by migration 022's trg_ai_credit_holds_settlement_guard for every role.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- H. Final assertions: the migration fails (and rolls back as a whole) unless every object it owns has the expected shape.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  -- 1. Triggers: present, enabled, bound to the intended function.
  SELECT string_agg(t.trg, ', ') INTO v_bad
  FROM (VALUES
    ('ai_credit_holds',                     'trg_ai_credit_holds_delivery_write_once',                  'prevent_delivery_attempt_rewrite'),
    ('ai_credit_holds',                     'trg_ai_credit_holds_delivery_insert_guard',                'prevent_delivery_attempt_rewrite'),
    ('ai_delivery_gap_reviews',             'trg_ai_delivery_gap_reviews_append_only',                  'prevent_review_mutation'),
    ('ai_delivery_gap_reviews',             'trg_ai_delivery_gap_reviews_no_truncate',                  'prevent_review_mutation'),
    ('ai_delivery_gap_review_amendments',   'trg_ai_delivery_gap_review_amendments_append_only',        'prevent_review_mutation'),
    ('ai_delivery_gap_review_amendments',   'trg_ai_delivery_gap_review_amendments_no_truncate',        'prevent_review_mutation')
  ) AS t(tbl, trg, fn)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger g
    JOIN pg_proc p ON p.oid = g.tgfoid
    WHERE g.tgrelid = format('public.%I', t.tbl)::regclass
      AND g.tgname = t.trg
      AND g.tgenabled = 'O'
      AND p.proname = t.fn
      AND p.pronamespace = 'public'::regnamespace);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '021: trigger missing, disabled or bound to the wrong function: %', v_bad USING ERRCODE = '55000';
  END IF;

  -- 2. The seven new functions exist once each, are SECURITY INVOKER and pin search_path.
  IF (SELECT count(*) FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('prevent_delivery_attempt_rewrite', 'prevent_review_mutation', 'delivery_attempt_gaps_to_review',
                          'delivery_attempt_deferred_to_review', 'delivery_attempt_gaps_in_window',
                          'delivery_attempt_deferred_in_window', 'delivery_attempt_gap_summary')
        AND NOT p.prosecdef
        AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']) <> 7 THEN
    RAISE EXCEPTION '021: the seven new functions must exist once each, SECURITY INVOKER, with search_path pinned to public, pg_temp'
      USING ERRCODE = '55000';
  END IF;

  -- 3. The five read functions are STABLE and not executable by PUBLIC.
  IF (SELECT count(*) FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('delivery_attempt_gaps_to_review', 'delivery_attempt_deferred_to_review', 'delivery_attempt_gaps_in_window',
                          'delivery_attempt_deferred_in_window', 'delivery_attempt_gap_summary')
        AND p.provolatile = 's'
        AND NOT has_function_privilege('public', p.oid, 'EXECUTE')) <> 5 THEN
    RAISE EXCEPTION '021: the five read functions must be STABLE and not executable by PUBLIC' USING ERRCODE = '55000';
  END IF;

  -- 4. Both record tables are owner-only.
  IF has_table_privilege('public', 'public.ai_delivery_gap_reviews', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('public', 'public.ai_delivery_gap_review_amendments', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION '021: the review and amendment tables must grant nothing to PUBLIC' USING ERRCODE = '55000';
  END IF;

  -- 5. Review table: evidence column shape, the three constraints, and no goodwill outcome.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = 'public.ai_delivery_gap_reviews'::regclass AND a.attname = 'evidence_code'
                   AND NOT a.attisdropped AND a.attnotnull
                   AND format_type(a.atttypid, a.atttypmod) = 'character varying(32)') THEN
    RAISE EXCEPTION '021: ai_delivery_gap_reviews.evidence_code must be VARCHAR(32) NOT NULL' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'public.ai_delivery_gap_reviews'::regclass
        AND conname IN ('ai_delivery_gap_reviews_evidence_code', 'ai_delivery_gap_reviews_outcome_evidence', 'ai_delivery_gap_reviews_outcome')
        AND contype = 'c') <> 3 THEN
    RAISE EXCEPTION '021: ai_delivery_gap_reviews is missing a constraint' USING ERRCODE = '55000';
  END IF;
  IF position('acknowledgement_unrecorded' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                                               WHERE conrelid = 'public.ai_delivery_gap_reviews'::regclass
                                                 AND conname = 'ai_delivery_gap_reviews_outcome')) = 0
     OR position('goodwill_credited' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                                         WHERE conrelid = 'public.ai_delivery_gap_reviews'::regclass
                                           AND conname = 'ai_delivery_gap_reviews_outcome')) > 0 THEN
    RAISE EXCEPTION '021: ai_delivery_gap_reviews_outcome must allow acknowledgement_unrecorded and must not allow goodwill_credited' USING ERRCODE = '55000';
  END IF;

  -- 6. Amendments table: the key, the foreign key and the five checks.
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'public.ai_delivery_gap_review_amendments'::regclass
        AND ((contype = 'p') OR (contype = 'f')
             OR (contype = 'c' AND conname IN ('ai_delivery_gap_review_amendments_number', 'ai_delivery_gap_review_amendments_outcome',
                                               'ai_delivery_gap_review_amendments_evidence_code', 'ai_delivery_gap_review_amendments_reviewer',
                                               'ai_delivery_gap_review_amendments_outcome_evidence')))) <> 7 THEN
    RAISE EXCEPTION '021: ai_delivery_gap_review_amendments does not have its key, foreign key and five checks' USING ERRCODE = '55000';
  END IF;

  -- 7. The hold table gained no column from this file.
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.ai_credit_holds'::regclass AND attnum > 0 AND NOT attisdropped) <> 12 THEN
    RAISE EXCEPTION '021: ai_credit_holds must still have exactly 12 columns' USING ERRCODE = '55000';
  END IF;

  -- 8. (v4) all five read functions carry the horizon-above-xmin condition.
  IF (SELECT count(*) FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('delivery_attempt_gaps_to_review', 'delivery_attempt_deferred_to_review', 'delivery_attempt_gaps_in_window',
                          'delivery_attempt_deferred_in_window', 'delivery_attempt_gap_summary')
        AND position('horizon_above_xmin' IN p.prosrc) > 0) <> 5 THEN
    RAISE EXCEPTION '021: the horizon-above-xmin guard is missing from a read function' USING ERRCODE = '55000';
  END IF;
END
$$;
