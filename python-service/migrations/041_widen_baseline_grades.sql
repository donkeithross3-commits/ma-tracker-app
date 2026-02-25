-- 041_widen_baseline_grades.sql
-- Widen grade columns from VARCHAR(5) to VARCHAR(10) to accommodate
-- word-form grades like "Medium", "Low", "High" in addition to letter grades.
-- Also clean up stale baseline runs stuck in 'running' status.

ALTER TABLE baseline_model_results
    ALTER COLUMN grade_vote TYPE VARCHAR(10),
    ALTER COLUMN grade_financing TYPE VARCHAR(10),
    ALTER COLUMN grade_legal TYPE VARCHAR(10),
    ALTER COLUMN grade_regulatory TYPE VARCHAR(10),
    ALTER COLUMN grade_mac TYPE VARCHAR(10);

-- Mark any stale 'running' runs as 'failed'
UPDATE baseline_runs SET status = 'failed', completed_at = NOW()
WHERE status = 'running' AND created_at < NOW() - INTERVAL '1 hour';
