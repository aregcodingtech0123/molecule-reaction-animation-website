-- =============================================================================
-- MoleculeStudio — review records for AI delivery-attempt gaps (Phase 2C step 5.2)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: old code never reads or writes it.
--
-- A gap is a tracked, captured reservation with no recorded delivery attempt. One row here records that the owner looked at
-- one gap and what they concluded. A gap does not prove the answer was lost, so `inconclusive` is a normal result.
--
-- Separate from ai_credit_holds on purpose: the app role has table-level UPDATE there (database/roles/app-role.sql), so a
-- review field on the hold could be set by the service, hiding a gap. A new table gets no grant, so this one is owner-only,
-- as reviewing a Lemon refund is.
--
-- No free text. Details belong in the owner's ticket system, not next to a user id for as long as the row lives. `reviewer`
-- cannot hold an e-mail address.
--
-- The primary key allows one review per reservation. A goodwill credit stays a manual, owner-only decision: when the
-- review row and the credit are written in one transaction, a repeat fails on this key before anything is posted. Nothing
-- here grants, refunds or posts credit, and no later workflow exists yet.
--
-- NOT touched: the ledger, balances, post_credit_transaction(), and any reconciliation function.
--
-- Locks: VALIDATE CONSTRAINT scans the holds under SHARE UPDATE EXCLUSIVE, which does not block reads or writes, so it runs
-- first. The foreign key then takes SHARE ROW EXCLUSIVE on ai_credit_holds, which blocks writes until this commits. It has
-- nothing to check, as the table is new. lock_timeout bounds the wait; a failure rolls the whole file back.
-- =============================================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE ai_credit_holds VALIDATE CONSTRAINT ai_credit_holds_delivery_attempt_consistent;

CREATE TABLE IF NOT EXISTS ai_delivery_gap_reviews (
  user_id      UUID         NOT NULL,
  reference_id VARCHAR(255) NOT NULL,
  outcome      VARCHAR(32)  NOT NULL,
  reviewer     VARCHAR(32)  NOT NULL,
  reviewed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, reference_id),
  FOREIGN KEY (user_id, reference_id) REFERENCES ai_credit_holds (user_id, reference_id) ON DELETE RESTRICT,
  CONSTRAINT ai_delivery_gap_reviews_outcome
    CHECK (outcome IN ('acknowledgement_outage', 'confirmed_withheld', 'inconclusive', 'goodwill_credited')),
  CONSTRAINT ai_delivery_gap_reviews_reviewer
    CHECK (reviewer ~ '^[a-z0-9._-]{2,32}$')
);

COMMENT ON TABLE ai_delivery_gap_reviews IS
  'Owner-only: one bounded conclusion per reviewed delivery-attempt gap. Never changes credits. A gap does not prove the answer was lost.';

REVOKE ALL ON ai_delivery_gap_reviews FROM PUBLIC;
