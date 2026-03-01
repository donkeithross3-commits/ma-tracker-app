-- Migration 047: Unified API call log
-- Every Anthropic API call from the system is logged here for cost tracking.
-- Budget.py reads from this table instead of only risk_assessment_runs.

CREATE TABLE IF NOT EXISTS api_call_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    called_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source          VARCHAR(50) NOT NULL,   -- 'risk_engine', 'baseline', 'filing_impact', 'research_refresher', 'edgar_research'
    model           VARCHAR(80) NOT NULL,   -- e.g. 'claude-opus-4-6'
    ticker          VARCHAR(10),            -- deal ticker if applicable
    input_tokens    INT NOT NULL DEFAULT 0,
    output_tokens   INT NOT NULL DEFAULT 0,
    cache_creation_tokens INT NOT NULL DEFAULT 0,
    cache_read_tokens     INT NOT NULL DEFAULT 0,
    cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
    metadata        JSONB                   -- optional extra info (run_id, batch_id, etc.)
);

CREATE INDEX IF NOT EXISTS idx_api_call_log_called_at ON api_call_log (called_at);
CREATE INDEX IF NOT EXISTS idx_api_call_log_source ON api_call_log (source);
