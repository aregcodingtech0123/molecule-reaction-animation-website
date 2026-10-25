-- =============================================================================
-- MoleculeStudio — AI daily turn caps (SEC-16)
-- Applied by the migration runner inside one transaction (no BEGIN/COMMIT here).
-- Idempotent: safe to re-run. Backward compatible: indexes only.
--
-- Reserving an AI turn now counts the user's and the whole service's turns in
-- the last 24 h (AI_DAILY_TURNS_PER_USER / AI_DAILY_TURNS_GLOBAL). These indexes
-- keep both counts cheap; they cover every status (each reservation was a model
-- call or an attempt at one).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_ai_credit_holds_user_created
  ON ai_credit_holds (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_credit_holds_created
  ON ai_credit_holds (created_at);
