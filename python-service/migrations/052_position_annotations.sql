-- 052_position_annotations.sql
-- Add annotation fields to algo_positions for manual intervention tracking.
-- Safe additive migration — no column drops, no type changes.

ALTER TABLE algo_positions
  ADD COLUMN IF NOT EXISTS annotation         TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manual_intervention BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intervention_type   VARCHAR(50) DEFAULT NULL;

-- Partial index: only flagged positions (sparse, fast for dashboard filter)
CREATE INDEX IF NOT EXISTS idx_algo_pos_intervention
  ON algo_positions (user_id, manual_intervention)
  WHERE manual_intervention = TRUE;

-- Backfill: positions closed by IB reconciliation are inherently manual interventions
UPDATE algo_positions
SET manual_intervention = TRUE, intervention_type = 'manual_tws_exit'
WHERE exit_reason = 'reconciliation' AND manual_intervention = FALSE;
