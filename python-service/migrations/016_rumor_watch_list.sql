-- Migration 016: Create rumor watch list table
-- Purpose: Track tickers that users want to monitor for M&A rumors
-- These tickers will get special attention for alerts, enhanced monitoring, etc.

CREATE TABLE IF NOT EXISTS rumor_watch_list (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10) NOT NULL,
    company_name VARCHAR(255),
    added_at TIMESTAMP DEFAULT NOW(),
    added_by VARCHAR(100),  -- For future user support
    notes TEXT,  -- Optional notes about why this ticker is being watched
    is_active BOOLEAN DEFAULT TRUE,  -- Allow soft-deletion
    last_checked_at TIMESTAMP,  -- Track when we last checked for rumors
    alert_preferences JSONB,  -- Future: store alert settings per ticker
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Ensure ticker uniqueness (one entry per ticker)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rumor_watch_list_ticker ON rumor_watch_list(ticker) WHERE is_active = TRUE;

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_rumor_watch_list_active ON rumor_watch_list(is_active, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_rumor_watch_list_last_checked ON rumor_watch_list(last_checked_at) WHERE is_active = TRUE;

-- Add comments
COMMENT ON TABLE rumor_watch_list IS 'Tickers users want to monitor for M&A rumors and activity';
COMMENT ON COLUMN rumor_watch_list.ticker IS 'Stock ticker symbol being watched';
COMMENT ON COLUMN rumor_watch_list.alert_preferences IS 'JSON object with alert settings: {"email": true, "push": false, "threshold": 0.7}';
COMMENT ON COLUMN rumor_watch_list.is_active IS 'FALSE when ticker removed from watch list (soft delete for history)';
COMMENT ON COLUMN rumor_watch_list.last_checked_at IS 'Last time we checked this ticker for new rumors/activity';
