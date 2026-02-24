-- Fix sheet_deal_details schema to match actual parser output
-- Migration: 024a_fix_deal_details_schema.sql
-- The original 024 schema diverged from what detail_parser.py extracts.
-- Table is empty, safe to drop and recreate.

DROP TABLE IF EXISTS sheet_deal_details;

CREATE TABLE sheet_deal_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    ticker VARCHAR(20) NOT NULL,

    -- Deal identification (from detail tab header)
    target TEXT,
    acquiror TEXT,
    target_current_price NUMERIC(12,4),
    acquiror_current_price NUMERIC(12,4),
    current_spread NUMERIC(10,4),
    spread_change NUMERIC(10,4),

    -- Deal terms
    category VARCHAR(50),
    cash_per_share NUMERIC(12,4),
    cash_pct NUMERIC(6,4),
    stock_ratio TEXT,
    stress_test_discount TEXT,
    stock_per_share NUMERIC(12,4),
    stock_pct NUMERIC(6,4),
    dividends_other NUMERIC(12,4),
    dividends_other_pct NUMERIC(6,4),
    total_price_per_share NUMERIC(12,4),

    -- Spread / IRR
    deal_spread NUMERIC(10,4),
    deal_close_time_months NUMERIC(6,2),
    expected_irr NUMERIC(10,4),

    -- Hypothetical terms
    ideal_price NUMERIC(12,4),
    hypothetical_irr NUMERIC(10,4),
    hypothetical_irr_spread NUMERIC(10,4),

    -- Dates (stored as DATE where parseable)
    todays_date DATE,
    announce_date DATE,
    expected_close_date DATE,
    expected_close_date_note TEXT,
    outside_date DATE,

    -- Qualitative assessments
    shareholder_vote TEXT,
    premium_attractive TEXT,
    board_approval TEXT,
    voting_agreements TEXT,
    aggressive_shareholders TEXT,
    regulatory_approvals TEXT,
    termination_fee TEXT,
    termination_fee_pct NUMERIC(6,4),
    target_marketcap TEXT,
    target_enterprise_value TEXT,

    -- Risk ratings
    shareholder_risk TEXT,
    financing_risk TEXT,
    legal_risk TEXT,

    -- Boolean flags
    investable_deal TEXT,
    pays_dividend TEXT,
    prefs_or_baby_bonds TEXT,
    has_cvrs TEXT,

    -- Structured sub-sections as JSONB
    price_history JSONB DEFAULT '[]',
    cvrs JSONB DEFAULT '[]',
    dividends JSONB DEFAULT '[]',

    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(snapshot_id, ticker)
);
CREATE INDEX IF NOT EXISTS idx_sheet_deal_details_snapshot ON sheet_deal_details(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_sheet_deal_details_ticker ON sheet_deal_details(ticker);
