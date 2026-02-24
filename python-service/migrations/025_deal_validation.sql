-- Migration 025: Deal validation allowlist + is_excluded flag
-- Fixes ghost deals (hidden rows in Google Sheets CSV export)

-- Allowlist table: tracks which tickers are valid vs excluded
CREATE TABLE IF NOT EXISTS deal_allowlist (
    ticker VARCHAR(20) PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | excluded
    source VARCHAR(50) DEFAULT 'manual',            -- manual | ingest_auto
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add is_excluded flag to sheet_rows
ALTER TABLE sheet_rows ADD COLUMN IF NOT EXISTS is_excluded BOOLEAN DEFAULT FALSE;

-- Index for quick lookups on exclusion status
CREATE INDEX IF NOT EXISTS idx_sheet_rows_is_excluded ON sheet_rows(is_excluded) WHERE is_excluded = TRUE;
