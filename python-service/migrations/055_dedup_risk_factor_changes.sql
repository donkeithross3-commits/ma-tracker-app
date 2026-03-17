-- 055: Remove duplicate risk_factor_changes and add unique constraint
-- Duplicates were created when multiple runs in the same day detected the same change.

-- Keep only the earliest record for each (ticker, factor, change_date, old_level, new_level, direction)
DELETE FROM risk_factor_changes a
USING risk_factor_changes b
WHERE a.ticker = b.ticker
  AND a.factor = b.factor
  AND a.change_date = b.change_date
  AND a.old_level = b.old_level
  AND a.new_level = b.new_level
  AND a.direction = b.direction
  AND a.created_at > b.created_at;

-- Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_factor_changes_dedup
ON risk_factor_changes (ticker, factor, change_date, old_level, new_level, direction);
