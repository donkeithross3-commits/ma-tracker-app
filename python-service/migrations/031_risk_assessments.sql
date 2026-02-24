-- 031_risk_assessments.sql
-- Tables for the morning risk assessment engine.

CREATE TABLE IF NOT EXISTS deal_risk_assessments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_date DATE NOT NULL,
    ticker          VARCHAR(10) NOT NULL,
    overall_risk_score      NUMERIC(4,2),
    overall_risk_level      VARCHAR(20),
    overall_risk_summary    TEXT,
    regulatory_score        NUMERIC(4,2),
    regulatory_detail       TEXT,
    vote_score              NUMERIC(4,2),
    vote_detail             TEXT,
    financing_score         NUMERIC(4,2),
    financing_detail        TEXT,
    legal_score             NUMERIC(4,2),
    legal_detail            TEXT,
    timing_score            NUMERIC(4,2),
    timing_detail           TEXT,
    mac_score               NUMERIC(4,2),
    mac_detail              TEXT,
    market_score            NUMERIC(4,2),
    market_detail           TEXT,
    competing_bid_score     NUMERIC(4,2),
    competing_bid_detail    TEXT,
    deal_price              NUMERIC(12,4),
    current_price           NUMERIC(12,4),
    gross_spread_pct        NUMERIC(8,4),
    annualized_yield_pct    NUMERIC(8,4),
    days_to_close           INTEGER,
    probability_of_success  NUMERIC(5,2),
    has_new_filing          BOOLEAN DEFAULT FALSE,
    has_new_halt            BOOLEAN DEFAULT FALSE,
    has_spread_change       BOOLEAN DEFAULT FALSE,
    has_risk_change         BOOLEAN DEFAULT FALSE,
    needs_attention         BOOLEAN DEFAULT FALSE,
    attention_reason        TEXT,
    input_data              JSONB,
    ai_response             JSONB,
    model_used              VARCHAR(50),
    tokens_used             INTEGER,
    processing_time_ms      INTEGER,
    run_id                  UUID,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_risk_assessment UNIQUE (assessment_date, ticker)
);

CREATE INDEX idx_risk_date ON deal_risk_assessments (assessment_date DESC);
CREATE INDEX idx_risk_ticker ON deal_risk_assessments (ticker, assessment_date DESC);
CREATE INDEX idx_risk_attention ON deal_risk_assessments (assessment_date, needs_attention) WHERE needs_attention = TRUE;
CREATE INDEX idx_risk_run ON deal_risk_assessments (run_id);

CREATE TABLE IF NOT EXISTS risk_assessment_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date        DATE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'running',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    duration_ms     INTEGER,
    total_deals     INTEGER DEFAULT 0,
    assessed_deals  INTEGER DEFAULT 0,
    failed_deals    INTEGER DEFAULT 0,
    flagged_deals   INTEGER DEFAULT 0,
    changed_deals   INTEGER DEFAULT 0,
    total_tokens    INTEGER DEFAULT 0,
    total_cost_usd  NUMERIC(8,4),
    summary         TEXT,
    error           TEXT,
    triggered_by    VARCHAR(50) DEFAULT 'scheduler',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_run_date ON risk_assessment_runs (run_date DESC);

CREATE TABLE IF NOT EXISTS risk_factor_changes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id       UUID NOT NULL REFERENCES deal_risk_assessments(id),
    ticker              VARCHAR(10) NOT NULL,
    change_date         DATE NOT NULL,
    factor              VARCHAR(30) NOT NULL,
    old_score           NUMERIC(4,2),
    new_score           NUMERIC(4,2),
    old_level           VARCHAR(20),
    new_level           VARCHAR(20),
    direction           VARCHAR(10),
    magnitude           NUMERIC(4,2),
    explanation         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_changes_ticker ON risk_factor_changes (ticker, change_date DESC);
CREATE INDEX idx_changes_date ON risk_factor_changes (change_date DESC);
CREATE INDEX idx_changes_worsened ON risk_factor_changes (change_date, direction) WHERE direction = 'worsened';
