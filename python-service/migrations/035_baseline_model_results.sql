-- 035_baseline_model_results.sql
-- Full factorial model comparison: every ticker x every model in a single run.
-- Unlike model_comparison_runs (pairwise A/B), this stores one row per ticker per model.

-- ---------------------------------------------------------------
-- Baseline runs (one row per run)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS baseline_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    models          TEXT[] NOT NULL,          -- e.g. {'claude-sonnet-4-20250514','claude-opus-4-20250514','claude-haiku-3-5-20241022'}
    total_tickers   INTEGER NOT NULL,
    successful      INTEGER NOT NULL DEFAULT 0,
    failed          INTEGER NOT NULL DEFAULT 0,
    total_cost_usd  NUMERIC(10,4) DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'running',  -- running, completed, failed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- ---------------------------------------------------------------
-- Individual results (one row per ticker x model)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS baseline_model_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES baseline_runs(id),
    ticker          VARCHAR(10) NOT NULL,
    model           VARCHAR(60) NOT NULL,

    -- Was this the one randomly selected for blind human review?
    is_presented    BOOLEAN NOT NULL DEFAULT FALSE,

    -- AI response
    response        JSONB,

    -- Token usage & cost
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    cost_usd        NUMERIC(8,6),
    latency_ms      INTEGER,

    -- Extracted quality metrics (denormalized for easy querying)
    probability_of_success  NUMERIC(5,2),
    investable_assessment   VARCHAR(30),
    reasoning_depth         INTEGER,           -- total chars of reasoning

    -- Grades extracted for cross-model comparison
    grade_vote              VARCHAR(5),
    grade_financing         VARCHAR(5),
    grade_legal             VARCHAR(5),
    grade_regulatory        VARCHAR(5),
    grade_mac               VARCHAR(5),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (run_id, ticker, model)
);

CREATE INDEX IF NOT EXISTS idx_baseline_results_run
    ON baseline_model_results (run_id, ticker);

CREATE INDEX IF NOT EXISTS idx_baseline_results_presented
    ON baseline_model_results (run_id, is_presented)
    WHERE is_presented = TRUE;

CREATE INDEX IF NOT EXISTS idx_baseline_runs_date
    ON baseline_runs (run_date DESC);
