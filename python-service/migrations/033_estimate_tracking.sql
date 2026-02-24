-- Migration 033: Estimate tracking tables
-- Tracks daily sheet + AI estimate snapshots, deal outcomes, and accuracy scoring

-- Table 1: deal_estimate_snapshots — Daily Snapshot
-- One row per deal per day. Captures both sheet and AI estimates plus market data.
CREATE TABLE IF NOT EXISTS deal_estimate_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date       DATE NOT NULL,
    ticker              VARCHAR(10) NOT NULL,

    -- Google Sheet Estimates
    sheet_prob_success          NUMERIC(6,4),
    sheet_prob_higher_offer     NUMERIC(6,4),
    sheet_offer_bump_premium    NUMERIC(6,4),
    sheet_break_price           NUMERIC(12,4),
    sheet_implied_downside      NUMERIC(10,4),
    sheet_return_risk_ratio     NUMERIC(10,4),

    -- Our AI Estimates
    ai_prob_success             NUMERIC(6,4),
    ai_prob_higher_offer        NUMERIC(6,4),
    ai_break_price              NUMERIC(12,4),
    ai_implied_downside         NUMERIC(10,4),

    -- Grade Comparison
    sheet_vote_risk             VARCHAR(50),
    sheet_finance_risk          VARCHAR(50),
    sheet_legal_risk            VARCHAR(50),
    sheet_investable            TEXT,

    ai_vote_grade               VARCHAR(10),
    ai_finance_grade            VARCHAR(10),
    ai_legal_grade              VARCHAR(10),
    ai_regulatory_grade         VARCHAR(10),
    ai_mac_grade                VARCHAR(10),
    ai_investable_assessment    VARCHAR(20),

    -- Market Data at Snapshot Time
    deal_price                  NUMERIC(12,4),
    current_price               NUMERIC(12,4),
    gross_spread_pct            NUMERIC(8,4),
    annualized_yield_pct        NUMERIC(8,4),
    days_to_close               INTEGER,

    -- Pre-computed Divergences
    prob_success_divergence     NUMERIC(6,4),    -- ai - sheet (positive = AI more cautious)
    grade_mismatches            INTEGER DEFAULT 0,
    has_investable_mismatch     BOOLEAN DEFAULT FALSE,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_estimate_snapshot UNIQUE (snapshot_date, ticker)
);

CREATE INDEX IF NOT EXISTS idx_est_date ON deal_estimate_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_est_ticker ON deal_estimate_snapshots (ticker, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_est_divergent ON deal_estimate_snapshots (snapshot_date)
    WHERE grade_mismatches > 0 OR has_investable_mismatch = TRUE;


-- Table 2: deal_outcomes — What Actually Happened
-- Populated when deals close, break, or are withdrawn. Manual entry confirmed by PM.
CREATE TABLE IF NOT EXISTS deal_outcomes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker                  VARCHAR(10) NOT NULL UNIQUE,

    -- Outcome
    outcome                 VARCHAR(20) NOT NULL,
    -- Values: closed_at_deal, closed_higher, broke, withdrawn, extended, renegotiated
    outcome_date            DATE,
    outcome_price           NUMERIC(12,4),

    -- Original Deal Terms
    original_deal_price     NUMERIC(12,4),
    announced_date          DATE,
    original_acquiror       TEXT,

    -- Competing Bid Details
    had_competing_bid       BOOLEAN DEFAULT FALSE,
    final_acquiror          TEXT,
    final_price             NUMERIC(12,4),
    bump_over_original_pct  NUMERIC(6,4),

    -- Timing
    days_to_outcome         INTEGER,
    was_extended            BOOLEAN DEFAULT FALSE,
    extension_count         INTEGER DEFAULT 0,

    -- What Drove the Outcome
    primary_risk_factor     VARCHAR(30),     -- which risk factor materialized (if broke)
    outcome_notes           TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Table 3: estimate_accuracy_scores — Accuracy Metrics
-- Computed when an outcome is recorded. Measures how well each estimator performed.
CREATE TABLE IF NOT EXISTS estimate_accuracy_scores (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker                  VARCHAR(10) NOT NULL,
    scored_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Tracking Period
    days_tracked            INTEGER,
    first_estimate_date     DATE,
    last_estimate_date      DATE,
    outcome                 VARCHAR(20),

    -- Probability Accuracy (Brier Score)
    -- Brier = mean of (predicted_prob - actual_outcome)^2
    -- Lower is better. 0 = perfect, 0.25 = coin flip, 1.0 = always wrong
    sheet_prob_success_brier    NUMERIC(8,6),
    ai_prob_success_brier       NUMERIC(8,6),
    prob_success_winner         VARCHAR(10),   -- 'sheet', 'ai', 'tie'

    sheet_prob_higher_brier     NUMERIC(8,6),
    ai_prob_higher_brier        NUMERIC(8,6),

    -- Break Price Accuracy (only for broke deals)
    sheet_break_price_error_pct NUMERIC(8,4),   -- (predicted - actual) / actual
    ai_break_price_error_pct    NUMERIC(8,4),

    -- Grade Accuracy
    -- For the risk factor that actually caused the outcome:
    -- Did our grades correctly identify it as elevated risk?
    sheet_identified_risk       BOOLEAN,
    ai_identified_risk          BOOLEAN,

    -- Aggregate
    sheet_score                 NUMERIC(5,2),   -- Composite accuracy 0-100
    ai_score                    NUMERIC(5,2),
    overall_winner              VARCHAR(10),

    CONSTRAINT uq_accuracy UNIQUE (ticker, scored_at)
);
