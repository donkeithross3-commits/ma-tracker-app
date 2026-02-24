-- 031_risk_assessments.sql
-- Tables for the morning risk assessment engine.
-- Grade-based system: Low/Medium/High for sheet-aligned factors,
-- 0-10 supplemental scores for factors the sheet doesn't assess.

DROP TABLE IF EXISTS risk_factor_changes CASCADE;
DROP TABLE IF EXISTS deal_risk_assessments CASCADE;
DROP TABLE IF EXISTS morning_reports CASCADE;
DROP TABLE IF EXISTS risk_assessment_runs CASCADE;

-- ---------------------------------------------------------------
-- Run metadata
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- Per-deal assessments
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_risk_assessments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_date DATE NOT NULL,
    ticker          VARCHAR(10) NOT NULL,

    -- Overall risk (kept for backward compat)
    overall_risk_score      NUMERIC(4,2),
    overall_risk_level      VARCHAR(20),
    overall_risk_summary    TEXT,

    -- Grade columns for sheet-aligned factors (Low / Medium / High)
    vote_grade              VARCHAR(10),
    vote_detail             TEXT,
    vote_confidence         NUMERIC(4,2),
    financing_grade         VARCHAR(10),
    financing_detail        TEXT,
    financing_confidence    NUMERIC(4,2),
    legal_grade             VARCHAR(10),
    legal_detail            TEXT,
    legal_confidence        NUMERIC(4,2),
    regulatory_grade        VARCHAR(10),
    regulatory_detail       TEXT,
    regulatory_confidence   NUMERIC(4,2),
    mac_grade               VARCHAR(10),
    mac_detail              TEXT,
    mac_confidence          NUMERIC(4,2),

    -- Supplemental 0-10 scores (factors the sheet does not assess)
    regulatory_score        NUMERIC(4,2),
    vote_score              NUMERIC(4,2),
    financing_score         NUMERIC(4,2),
    legal_score             NUMERIC(4,2),
    timing_score            NUMERIC(4,2),
    timing_detail           TEXT,
    mac_score               NUMERIC(4,2),
    market_score            NUMERIC(4,2),
    market_detail           TEXT,
    competing_bid_score     NUMERIC(4,2),
    competing_bid_detail    TEXT,

    -- Investability
    investable_assessment   VARCHAR(20),
    investable_reasoning    TEXT,

    -- Our probability estimates
    our_prob_success        NUMERIC(6,4),
    our_prob_higher_offer   NUMERIC(6,4),
    our_break_price         NUMERIC(12,4),
    our_implied_downside    NUMERIC(10,4),

    -- Sheet values at assessment time (for audit)
    sheet_vote_risk         VARCHAR(50),
    sheet_finance_risk      VARCHAR(50),
    sheet_legal_risk        VARCHAR(50),
    sheet_investable        TEXT,
    sheet_prob_success      NUMERIC(6,4),

    -- Discrepancies and events
    discrepancies           JSONB,
    overnight_events        JSONB,
    discrepancy_count       INTEGER DEFAULT 0,
    event_count             INTEGER DEFAULT 0,

    -- Deal summary and key risks
    deal_summary            TEXT,
    key_risks               JSONB,
    watchlist_items         JSONB,

    -- Deal metrics from sheet
    deal_price              NUMERIC(12,4),
    current_price           NUMERIC(12,4),
    gross_spread_pct        NUMERIC(8,4),
    annualized_yield_pct    NUMERIC(8,4),
    days_to_close           INTEGER,
    probability_of_success  NUMERIC(5,2),

    -- Event flags
    has_new_filing          BOOLEAN DEFAULT FALSE,
    has_new_halt            BOOLEAN DEFAULT FALSE,
    has_spread_change       BOOLEAN DEFAULT FALSE,
    has_risk_change         BOOLEAN DEFAULT FALSE,
    needs_attention         BOOLEAN DEFAULT FALSE,
    attention_reason        TEXT,

    -- Raw AI data
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

-- ---------------------------------------------------------------
-- Risk factor changes (score & grade change tracking)
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- Morning reports (email / WhatsApp output)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS morning_reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date         DATE NOT NULL UNIQUE,
    run_id              UUID REFERENCES risk_assessment_runs(id),
    executive_summary   TEXT,
    html_body           TEXT,
    whatsapp_summary    TEXT,
    subject_line        TEXT,
    total_deals         INTEGER,
    discrepancy_count   INTEGER,
    event_count         INTEGER,
    flagged_count       INTEGER,
    email_sent          BOOLEAN DEFAULT FALSE,
    email_sent_at       TIMESTAMPTZ,
    whatsapp_sent       BOOLEAN DEFAULT FALSE,
    whatsapp_sent_at    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
