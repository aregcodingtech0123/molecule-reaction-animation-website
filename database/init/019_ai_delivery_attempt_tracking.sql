-- =============================================================================
-- MoleculeStudio — durable delivery-attempt tracking on AI reservations (Phase 2C step 5.2)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: old code never reads or writes the new columns, and its named-column
-- INSERT gets the default.
--
-- A captured reservation looks the same whether or not the BFF went on to return the answer. Nothing could tell a normal
-- turn from one where the capture committed but the answer was withheld, or where the BFF died after the capture.
-- These two fields record the normal case, so that its absence becomes the signal:
--
--   delivery_tracking_enabled     set when the reservation is created, only if its BFF promised to acknowledge. Every
--                                 existing row reads as false, so history can never look like a missing acknowledgement.
--   answer_delivery_attempted_at  the BFF reached the point of returning the answer, after authoritative confirmation of
--                                 the capture. An attempt only: not the client's receipt, nor that it rendered or was read.
--
-- NOT touched: the ledger, balances, post_credit_transaction(), the status column, the settlement constraints, and any
-- reconciliation function. Nothing writes these columns yet, and this migration sets no value on any row.
--
-- Locks: ADD COLUMN takes ACCESS EXCLUSIVE, briefly. A constant default is stored in the catalog, so the table is not
-- rewritten. NOT VALID skips the scan of existing rows; migration 020 validates it in its own transaction, under a lock
-- that does not block writes. lock_timeout makes this fail rather than queue every reservation behind it while it waits;
-- the runner then rolls the whole file back and it can simply be run again.
--
-- No index: the runner's transaction rules out CREATE INDEX CONCURRENTLY, and a plain build would block reservations.
-- =============================================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE ai_credit_holds
  ADD COLUMN IF NOT EXISTS delivery_tracking_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS answer_delivery_attempted_at TIMESTAMPTZ;

COMMENT ON COLUMN ai_credit_holds.delivery_tracking_enabled IS
  'Set when the reservation is created, only if its BFF promised to acknowledge. Historical rows are false and are never treated as missing an acknowledgement.';

COMMENT ON COLUMN ai_credit_holds.answer_delivery_attempted_at IS
  'The BFF reached the point of returning the answer after authoritative capture confirmation. A server-side attempt: it does not prove the client received, rendered or read the answer.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_credit_holds_delivery_attempt_consistent'
      AND conrelid = 'ai_credit_holds'::regclass
  ) THEN
    ALTER TABLE ai_credit_holds
      ADD CONSTRAINT ai_credit_holds_delivery_attempt_consistent
      CHECK (answer_delivery_attempted_at IS NULL OR (status = 'captured' AND delivery_tracking_enabled))
      NOT VALID;
  END IF;
END
$$;
