-- Google Sheet Portfolio Ingestion Tables
-- Migration: 024_sheet_portfolio.sql
-- Created: 2026-02-24
-- Purpose: Support daily ingestion of M&A deal portfolio data from the production
--          Google Sheet. Stores raw text values exactly as they appear in the sheet
--          alongside parsed numeric values for queries. Tracks per-deal detail tabs,
--          row-level diffs between snapshots, and validation issues for reconciliation.

-- 1. sheet_snapshots: one row per daily ingest run
CREATE TABLE IF NOT EXISTS sheet_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date DATE NOT NULL,
    tab_name VARCHAR(50) NOT NULL DEFAULT 'dashboard',
    tab_gid VARCHAR(20) NOT NULL,
    row_count INTEGER,
    content_hash VARCHAR(64),  -- SHA-256 of raw CSV for idempotency
    status VARCHAR(20) NOT NULL DEFAULT 'complete',  -- complete/partial/failed
    error_message TEXT,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(snapshot_date, tab_gid)
);
CREATE INDEX IF NOT EXISTS idx_sheet_snapshots_date ON sheet_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_sheet_snapshots_status ON sheet_snapshots(status);

-- 2. sheet_rows: individual deal rows from dashboard snapshot
-- Stores raw text as-is from sheet + parsed numeric values for queries
CREATE TABLE IF NOT EXISTS sheet_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,

    -- Raw text exactly as appears in sheet
    ticker VARCHAR(20),
    acquiror TEXT,
    announced_date_raw TEXT,      -- "1/7/25"
    close_date_raw TEXT,          -- "6/30/25"
    end_date_raw TEXT,            -- "8/18/26" or empty
    countdown_raw TEXT,           -- "175" or "11/3/1773" (artifact)
    deal_price_raw TEXT,          -- "$15.85"
    current_price_raw TEXT,       -- "$16.73" or "$0.00"
    gross_yield_raw TEXT,         -- "-5.52%"
    price_change_raw TEXT,        -- "6.58%"
    current_yield_raw TEXT,       -- "7.88%" or "#DIV/0!"
    category TEXT,                -- "All-cash", "Cash & Stock", "All-stock", etc
    investable TEXT,              -- Long text or "Yes"/"No"
    go_shop_raw TEXT,             -- "Go Shop ending 12/5/2025" or null
    vote_risk TEXT,               -- "Low", "Medium", "High", or longer descriptions
    finance_risk TEXT,            -- Can be long: "High, some concerned over liquidity..."
    legal_risk TEXT,              -- Can be long: "Medium, significant regulatory approvals required"
    cvr_flag TEXT,                -- "Yes", "No", or descriptive text
    link_to_sheet TEXT,           -- Relative GID link or full URL

    -- Parsed numeric values (null if unparseable)
    announced_date DATE,
    close_date DATE,
    end_date DATE,
    countdown_days INTEGER,       -- null for the 1773 artifact
    deal_price NUMERIC(12,4),
    current_price NUMERIC(12,4),
    gross_yield NUMERIC(10,4),    -- as decimal: -0.0552 not -5.52
    price_change NUMERIC(10,4),   -- as decimal
    current_yield NUMERIC(10,4),  -- null for #DIV/0!

    -- Derived/computed
    deal_tab_gid VARCHAR(20),     -- extracted from link_to_sheet

    -- Full raw row as JSON for future-proofing
    raw_json JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(snapshot_id, row_index)
);
CREATE INDEX IF NOT EXISTS idx_sheet_rows_snapshot ON sheet_rows(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_sheet_rows_ticker ON sheet_rows(ticker);
CREATE INDEX IF NOT EXISTS idx_sheet_rows_category ON sheet_rows(category);

-- 3. sheet_deal_details: parsed per-deal detail tab data
CREATE TABLE IF NOT EXISTS sheet_deal_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    ticker VARCHAR(20) NOT NULL,
    tab_gid VARCHAR(20) NOT NULL,

    -- Deal terms
    category VARCHAR(50),
    cash_per_share NUMERIC(12,4),
    cash_weight NUMERIC(6,4),       -- percentage as decimal
    stock_ratio NUMERIC(12,6),
    stress_test_discount NUMERIC(6,4),
    stock_per_share NUMERIC(12,4),
    stock_weight NUMERIC(6,4),
    dividends_other NUMERIC(12,4),
    dividends_weight NUMERIC(6,4),
    total_price_per_share NUMERIC(12,4),

    -- Current state
    target_current_price NUMERIC(12,4),
    acquiror_current_price NUMERIC(12,4),
    deal_spread NUMERIC(10,4),      -- as decimal
    deal_close_months NUMERIC(6,2),
    expected_irr NUMERIC(10,4),     -- as decimal
    current_spread NUMERIC(10,4),   -- as decimal (from header)
    spread_change NUMERIC(10,4),    -- as decimal (from header)

    -- Hypothetical
    ideal_price NUMERIC(12,4),
    ideal_irr NUMERIC(10,4),

    -- Dates
    today_date DATE,
    announce_date DATE,
    expected_close_date DATE,
    expected_close_note TEXT,        -- e.g. "FY Q1 2027 (6/30/26)"
    outside_date DATE,

    -- Qualitative assessments (all TEXT for flexibility)
    shareholder_vote TEXT,
    premium_attractive TEXT,
    board_approval TEXT,
    voting_agreements TEXT,
    aggressive_shareholders TEXT,
    regulatory_approvals TEXT,
    revenue_mostly_us TEXT,
    reputable_acquiror TEXT,
    target_business_description TEXT,
    mac_clauses TEXT,
    termination_fee TEXT,
    termination_fee_pct NUMERIC(6,4),
    closing_conditions TEXT,
    sellside_pushback TEXT,
    target_marketcap TEXT,
    target_enterprise_value TEXT,
    key_risks_upside TEXT,
    financing_details TEXT,

    -- Risk ratings
    shareholder_risk TEXT,
    financing_risk TEXT,
    legal_risk TEXT,

    -- Boolean flags
    investable_deal TEXT,
    pays_dividend TEXT,
    prefs_or_baby_bonds TEXT,
    has_cvrs TEXT,

    -- CVRs as JSONB array: [{npv, value, probability, payment, deadline, years}, ...]
    cvrs JSONB DEFAULT '[]',

    -- Dividends as JSONB array: [{date, value, paid}, ...]
    dividends JSONB DEFAULT '[]',

    -- Price history as JSONB array: [{date, close}, ...]
    price_history JSONB DEFAULT '[]',

    -- Full raw parsed data for future-proofing
    raw_parsed JSONB,

    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(snapshot_id, ticker)
);
CREATE INDEX IF NOT EXISTS idx_sheet_deal_details_snapshot ON sheet_deal_details(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_sheet_deal_details_ticker ON sheet_deal_details(ticker);

-- 4. sheet_diffs: row-level changes between consecutive snapshots
CREATE TABLE IF NOT EXISTS sheet_diffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    prev_snapshot_id UUID REFERENCES sheet_snapshots(id),
    ticker VARCHAR(20) NOT NULL,
    diff_type VARCHAR(20) NOT NULL,  -- 'added', 'removed', 'modified'
    changed_fields JSONB,             -- {"field": {"old": "X", "new": "Y"}}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sheet_diffs_snapshot ON sheet_diffs(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_sheet_diffs_ticker ON sheet_diffs(ticker);
CREATE INDEX IF NOT EXISTS idx_sheet_diffs_type ON sheet_diffs(diff_type);

-- 5. validation_issues: issues found during reconciliation
CREATE TABLE IF NOT EXISTS validation_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES sheet_snapshots(id) ON DELETE CASCADE,
    sheet_row_id UUID REFERENCES sheet_rows(id) ON DELETE SET NULL,
    ticker VARCHAR(20),
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',  -- error/warning/info
    rule_name VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    field_name VARCHAR(50),
    expected_value TEXT,
    actual_value TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open',  -- open/acknowledged/resolved/false_positive
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_validation_issues_snapshot ON validation_issues(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_validation_issues_ticker ON validation_issues(ticker);
CREATE INDEX IF NOT EXISTS idx_validation_issues_status ON validation_issues(status);
CREATE INDEX IF NOT EXISTS idx_validation_issues_severity ON validation_issues(severity);
