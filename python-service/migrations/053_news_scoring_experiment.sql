-- 053: News scoring experiment tables
-- Compare heuristic vs AI scoring for selecting the most relevant news articles
-- per deal ticker for the risk engine's 10-article window.

-- Experiment run metadata
CREATE TABLE IF NOT EXISTS news_scoring_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT,
    total_articles INTEGER,
    methods TEXT[],           -- e.g. ['heuristic_v1', 'heuristic_v2', 'haiku', 'sonnet_judge']
    status VARCHAR(20) DEFAULT 'running',
    total_cost_usd NUMERIC(10,4) DEFAULT 0,
    config JSONB,            -- experiment parameters (prompts, weights, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Per-article per-method scores
CREATE TABLE IF NOT EXISTS news_scoring_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES news_scoring_runs(id),
    article_id UUID NOT NULL,  -- FK to deal_news_articles.id
    ticker VARCHAR(10) NOT NULL,
    method VARCHAR(30) NOT NULL,  -- 'heuristic_v1', 'heuristic_v2', 'haiku', 'sonnet_judge'

    -- Denormalized scores for easy SQL analysis
    relevance_score FLOAT,
    risk_factor VARCHAR(30),
    is_about_deal BOOLEAN,         -- AI methods only
    information_type VARCHAR(30),  -- AI methods only (sonnet judge)
    reasoning TEXT,                -- AI methods only

    -- Full AI response for audit
    raw_response JSONB,

    -- API metrics (AI methods only)
    model VARCHAR(80),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd NUMERIC(10,6),

    -- Source article metadata (denormalized for analysis without joins)
    article_title TEXT,
    article_source VARCHAR(30),
    article_publisher VARCHAR(100),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (run_id, article_id, method)
);

-- Indexes for analysis queries
CREATE INDEX IF NOT EXISTS idx_nsr_run_method ON news_scoring_results(run_id, method);
CREATE INDEX IF NOT EXISTS idx_nsr_ticker ON news_scoring_results(run_id, ticker);
