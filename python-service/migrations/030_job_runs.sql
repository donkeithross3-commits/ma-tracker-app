-- 030_job_runs.sql
-- Logging table for APScheduler job executions.

CREATE TABLE IF NOT EXISTS job_runs (
    id              UUID PRIMARY KEY,
    job_id          VARCHAR(100)  NOT NULL,
    job_name        VARCHAR(200)  NOT NULL,
    status          VARCHAR(20)   NOT NULL DEFAULT 'running',
    started_at      TIMESTAMPTZ   NOT NULL,
    finished_at     TIMESTAMPTZ,
    duration_ms     INTEGER,
    result          JSONB,
    error           TEXT,
    triggered_by    VARCHAR(50)   NOT NULL DEFAULT 'scheduler'
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_started
    ON job_runs (job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_runs_status_non_success
    ON job_runs (status)
    WHERE status != 'success';
