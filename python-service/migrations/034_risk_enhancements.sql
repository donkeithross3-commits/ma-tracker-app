-- 034_risk_enhancements.sql
-- Token efficiency & model evaluation framework.
-- Adds context hashing, assessment strategies, token tracking, and model comparison support.

-- ---------------------------------------------------------------
-- Columns on deal_risk_assessments
-- ---------------------------------------------------------------
ALTER TABLE deal_risk_assessments
    ADD COLUMN IF NOT EXISTS context_hash VARCHAR(16),
    ADD COLUMN IF NOT EXISTS assessment_strategy VARCHAR(20) DEFAULT 'full',
    ADD COLUMN IF NOT EXISTS change_significance VARCHAR(20),
    ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(8,6);

CREATE INDEX IF NOT EXISTS idx_risk_context_hash
    ON deal_risk_assessments (ticker, context_hash)
    WHERE context_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_risk_strategy
    ON deal_risk_assessments (assessment_date, assessment_strategy);

-- ---------------------------------------------------------------
-- Columns on risk_assessment_runs
-- ---------------------------------------------------------------
ALTER TABLE risk_assessment_runs
    ADD COLUMN IF NOT EXISTS reused_deals INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delta_deals INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS full_deals INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS estimated_savings_usd NUMERIC(8,4) DEFAULT 0;

-- ---------------------------------------------------------------
-- Model comparison runs
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_comparison_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL,
    run_date            DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Models compared
    model_a             VARCHAR(60) NOT NULL,
    model_b             VARCHAR(60) NOT NULL,

    -- Quality metrics
    grade_agreement     INTEGER,          -- 0-5: how many graded factors agree
    prob_success_diff   NUMERIC(6,2),     -- absolute difference in prob estimates
    investable_agree    BOOLEAN,          -- do both agree on investability

    -- Reasoning depth (char count of detail fields)
    reasoning_depth_a   INTEGER,
    reasoning_depth_b   INTEGER,

    -- Cost & performance
    input_tokens_a      INTEGER,
    output_tokens_a     INTEGER,
    cost_usd_a          NUMERIC(8,6),
    latency_ms_a        INTEGER,

    input_tokens_b      INTEGER,
    output_tokens_b     INTEGER,
    cost_usd_b          NUMERIC(8,6),
    latency_ms_b        INTEGER,

    -- Raw responses for inspection
    response_a          JSONB,
    response_b          JSONB,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_comparison_date
    ON model_comparison_runs (run_date DESC);

-- ---------------------------------------------------------------
-- Cost summary view
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW risk_cost_summary AS
SELECT
    assessment_date,
    assessment_strategy,
    model_used,
    COUNT(*)                                    AS deal_count,
    SUM(COALESCE(input_tokens, 0))              AS total_input_tokens,
    SUM(COALESCE(output_tokens, 0))             AS total_output_tokens,
    SUM(COALESCE(cache_read_tokens, 0))         AS total_cache_read_tokens,
    SUM(COALESCE(cost_usd, 0))                  AS total_cost_usd,
    AVG(COALESCE(cost_usd, 0))                  AS avg_cost_per_deal,
    AVG(processing_time_ms)                     AS avg_latency_ms
FROM deal_risk_assessments
WHERE assessment_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY assessment_date, assessment_strategy, model_used
ORDER BY assessment_date DESC, assessment_strategy;
