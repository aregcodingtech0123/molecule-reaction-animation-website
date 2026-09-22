-- =============================================================================
-- MoleculeStudio — AI credit metering: consumption + refund ledger types
-- Idempotent migration — safe to re-run
--
-- Split from 007 on purpose: PostgreSQL forbids *using* an enum label in the
-- same transaction that added it, and 007 builds an index whose predicate
-- references these labels. 006 must COMMIT before 007 runs.
-- =============================================================================

BEGIN;

-- Metered spend on an AI operation (ATOM_GENERATE, ARCH_RENDER_HD, ...).
-- Distinct from the legacy AI_GENERATION_DEDUCTION label, which is retained so
-- historical rows keep rendering correctly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'credit_transaction_type' AND e.enumlabel = 'CREDIT_CONSUMPTION'
  ) THEN
    ALTER TYPE credit_transaction_type ADD VALUE 'CREDIT_CONSUMPTION';
  END IF;
END
$$;

-- Automatic give-back when an AI operation fails *after* credits were taken.
-- Distinct from the legacy REFUND label, which covered manual payment refunds.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'credit_transaction_type' AND e.enumlabel = 'CREDIT_REFUND'
  ) THEN
    ALTER TYPE credit_transaction_type ADD VALUE 'CREDIT_REFUND';
  END IF;
END
$$;

COMMIT;
