-- Rename created_at → detected_at in sheet_diffs to match application code.
-- The original migration (024) created the column as created_at, but the
-- ingest code has always written to detected_at.
ALTER TABLE sheet_diffs RENAME COLUMN created_at TO detected_at;
