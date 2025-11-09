-- Migration 010: Trading Halt Monitoring System
-- Creates tables for tracking trading halts and integrating with M&A intelligence

-- Halt events table
CREATE TABLE IF NOT EXISTS halt_events (
    halt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(10) NOT NULL,
    halt_time TIMESTAMP NOT NULL,
    halt_code VARCHAR(10) NOT NULL,
    resumption_time TIMESTAMP,
    exchange VARCHAR(20) NOT NULL,
    company_name VARCHAR(255),
    is_tracked_ticker BOOLEAN DEFAULT FALSE,
    detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Prevent duplicate halt entries
    CONSTRAINT unique_halt_event UNIQUE (ticker, halt_time, halt_code)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_halt_events_ticker ON halt_events(ticker);
CREATE INDEX IF NOT EXISTS idx_halt_events_halt_time ON halt_events(halt_time DESC);
CREATE INDEX IF NOT EXISTS idx_halt_events_tracked ON halt_events(is_tracked_ticker) WHERE is_tracked_ticker = TRUE;
CREATE INDEX IF NOT EXISTS idx_halt_events_detected_at ON halt_events(detected_at DESC);

-- Add halt-specific alert type if not exists
DO $$
BEGIN
    -- This is safe to run multiple times
    ALTER TABLE alert_notifications
    ADD CONSTRAINT alert_type_check
    CHECK (alert_type IN (
        'deal_announcement',
        'deal_update',
        'risk_change',
        'material_event',
        'trading_halt'
    ));
EXCEPTION
    WHEN duplicate_object THEN
        -- Constraint already exists, modify it
        ALTER TABLE alert_notifications DROP CONSTRAINT alert_type_check;
        ALTER TABLE alert_notifications
        ADD CONSTRAINT alert_type_check
        CHECK (alert_type IN (
            'deal_announcement',
            'deal_update',
            'risk_change',
            'material_event',
            'trading_halt'
        ));
END $$;

-- Halt monitor stats view
CREATE OR REPLACE VIEW halt_monitor_stats AS
SELECT
    COUNT(*) as total_halts,
    COUNT(*) FILTER (WHERE is_tracked_ticker = TRUE) as tracked_ticker_halts,
    COUNT(*) FILTER (WHERE halt_code IN ('T1', 'T2', 'M1', 'M2')) as material_news_halts,
    COUNT(DISTINCT ticker) as unique_tickers,
    COUNT(DISTINCT ticker) FILTER (WHERE is_tracked_ticker = TRUE) as unique_tracked_tickers,
    MAX(detected_at) as last_halt_detected,
    COUNT(*) FILTER (WHERE detected_at > NOW() - INTERVAL '1 hour') as halts_last_hour,
    COUNT(*) FILTER (WHERE detected_at > NOW() - INTERVAL '24 hours') as halts_last_24h
FROM halt_events;

-- Comment on halt codes
COMMENT ON COLUMN halt_events.halt_code IS 'T1=News Pending, T2=News Dissemination, M1=NYSE News Pending, M2=NYSE News Dissemination, LUDP=Limit Up/Down Pause';

-- Grant permissions (if using specific database user)
-- GRANT SELECT, INSERT ON halt_events TO your_app_user;
-- GRANT SELECT ON halt_monitor_stats TO your_app_user;
