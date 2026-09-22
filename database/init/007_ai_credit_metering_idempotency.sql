-- =============================================================================
-- MoleculeStudio — AI credit metering: idempotency guarantee
-- Idempotent migration — safe to re-run
--
-- Requires 006 to have COMMITTED (it adds the enum labels referenced below).
-- =============================================================================

BEGIN;

-- One consumption and at most one refund per operation reference.
--
-- The application also checks for an existing row before posting, but that
-- check races under concurrent requests: two chat turns replayed at the same
-- instant would both see "no row" and both deduct. This index makes the
-- database the final arbiter, so a double-spend surfaces as 23505 instead of
-- silently charging twice.
--
-- Deliberately scoped to the two AI metering labels. A ledger-wide unique
-- index would risk failing against pre-existing rows (for example several
-- SIGNUP_BONUS rows sharing reference_id 'signup'), which is not this
-- migration's business.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_ai_operation
  ON credit_ledger_transactions (user_id, transaction_type, reference_id)
  WHERE reference_id IS NOT NULL
    AND transaction_type IN ('CREDIT_CONSUMPTION', 'CREDIT_REFUND');

COMMENT ON INDEX uq_credit_ledger_ai_operation IS
  'Idempotency guard: one CREDIT_CONSUMPTION and one CREDIT_REFUND per (user, operation reference).';

COMMIT;
