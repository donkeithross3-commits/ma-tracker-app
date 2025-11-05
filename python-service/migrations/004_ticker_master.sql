-- Ticker Master (Security Master) - Full Lifecycle Tracking
-- Migration: 004_ticker_master.sql
-- Purpose: Central registry tracking each ticker from rumor detection through deal close/delisting

-- =============================================================================
-- TICKER MASTER TABLE - Single source of truth for each security
-- =============================================================================

CREATE TABLE IF NOT EXISTS ticker_master (
    ticker VARCHAR(10) PRIMARY KEY,

    -- Company Information
    company_name VARCHAR(255) NOT NULL,
    exchange VARCHAR(20), -- 'NYSE', 'NASDAQ', 'TSX', 'LSE', etc.
    sector VARCHAR(100),
    industry VARCHAR(100),
    market_cap_usd DECIMAL(15,2),

    -- Lifecycle Status Tracking
    lifecycle_status VARCHAR(50) NOT NULL DEFAULT 'normal',
    -- States: 'normal', 'rumored', 'announced', 'pending_close', 'closing', 'closed', 'terminated', 'delisted'

    -- Active Deal Association
    active_deal_id UUID REFERENCES deal_intelligence(deal_id),
    role_in_deal VARCHAR(20), -- 'target', 'acquirer', null

    -- Timeline Milestones
    first_rumor_detected_at TIMESTAMP,
    deal_announced_at TIMESTAMP,
    merger_agreement_signed_at DATE,
    shareholder_vote_scheduled_at DATE,
    shareholder_vote_approved_at DATE,
    regulatory_filed_at TIMESTAMP,
    regulatory_approved_at TIMESTAMP,
    expected_close_date DATE,
    actual_close_date DATE,
    deal_terminated_at TIMESTAMP,
    ticker_delisted_at TIMESTAMP,
    final_trading_date DATE,

    -- Intelligence Accumulation (All knowledge about this ticker)
    intelligence_summary JSONB DEFAULT '{}'::jsonb,
    -- Structure: {
    --   "rumors": [{source, date, summary, credibility}],
    --   "news_mentions": [{source, date, headline, url}],
    --   "filings": [{type, date, url, relevant_sections}],
    --   "regulatory_events": [{agency, event, date}],
    --   "analyst_coverage": [{firm, rating, target_price, date}]
    -- }

    -- Monitoring Metrics
    rumor_count INTEGER DEFAULT 0,
    news_mention_count INTEGER DEFAULT 0,
    edgar_filing_count INTEGER DEFAULT 0,
    regulatory_filing_count INTEGER DEFAULT 0,

    -- Monitoring Configuration
    watch_priority VARCHAR(20) DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
    auto_research_enabled BOOLEAN DEFAULT true,
    edgar_monitoring_enabled BOOLEAN DEFAULT false,
    notification_enabled BOOLEAN DEFAULT false,

    -- EDGAR Tracking
    cik VARCHAR(10), -- SEC Central Index Key
    last_edgar_check_at TIMESTAMP,
    next_edgar_check_at TIMESTAMP,

    -- Research Status
    research_status VARCHAR(50) DEFAULT 'none',
    -- States: 'none', 'pending', 'in_progress', 'completed', 'approved'
    research_completion_pct INTEGER DEFAULT 0,
    research_last_updated_at TIMESTAMP,

    -- Data Quality
    data_quality_score DECIMAL(3,2) DEFAULT 0.50, -- 0.00 to 1.00
    last_verified_at TIMESTAMP,
    verified_by VARCHAR(100),

    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_lifecycle_status CHECK (
        lifecycle_status IN (
            'normal', 'rumored', 'announced', 'pending_close',
            'closing', 'closed', 'terminated', 'delisted'
        )
    ),
    CONSTRAINT valid_role CHECK (role_in_deal IN ('target', 'acquirer') OR role_in_deal IS NULL),
    CONSTRAINT valid_priority CHECK (watch_priority IN ('critical', 'high', 'normal', 'low')),
    CONSTRAINT valid_research_status CHECK (
        research_status IN ('none', 'pending', 'in_progress', 'completed', 'approved')
    )
);

-- Indexes for common query patterns
CREATE INDEX idx_ticker_master_lifecycle_status ON ticker_master(lifecycle_status);
CREATE INDEX idx_ticker_master_active_deal ON ticker_master(active_deal_id) WHERE active_deal_id IS NOT NULL;
CREATE INDEX idx_ticker_master_watch_priority ON ticker_master(watch_priority);
CREATE INDEX idx_ticker_master_edgar_monitoring ON ticker_master(edgar_monitoring_enabled, next_edgar_check_at)
    WHERE edgar_monitoring_enabled = true;
CREATE INDEX idx_ticker_master_research_status ON ticker_master(research_status);
CREATE INDEX idx_ticker_master_expected_close ON ticker_master(expected_close_date)
    WHERE expected_close_date IS NOT NULL;
CREATE INDEX idx_ticker_master_intelligence ON ticker_master USING gin(intelligence_summary);


-- =============================================================================
-- TICKER LIFECYCLE EVENTS - Audit trail of status changes
-- =============================================================================

CREATE TABLE IF NOT EXISTS ticker_lifecycle_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(10) NOT NULL REFERENCES ticker_master(ticker),

    -- Event Details
    event_type VARCHAR(50) NOT NULL,
    -- Types: 'rumor_detected', 'deal_announced', 'regulatory_filed',
    --        'shareholder_vote', 'approval_received', 'deal_closed',
    --        'deal_terminated', 'delisted'

    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,

    -- Event Context
    triggered_by VARCHAR(100), -- 'system', 'edgar_monitor', 'intelligence_monitor', 'user:luis', etc.
    trigger_source VARCHAR(100), -- Specific source that caused this event

    -- Event Data
    event_data JSONB, -- Additional context about the event
    notes TEXT,

    -- Timestamp
    event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_event_type CHECK (
        event_type IN (
            'rumor_detected', 'deal_announced', 'merger_agreement_signed',
            'regulatory_filed', 'shareholder_vote_scheduled', 'shareholder_vote_approved',
            'regulatory_approval', 'deal_closed', 'deal_terminated',
            'delisted', 'status_change', 'manual_update'
        )
    )
);

CREATE INDEX idx_lifecycle_events_ticker ON ticker_lifecycle_events(ticker, event_timestamp DESC);
CREATE INDEX idx_lifecycle_events_type ON ticker_lifecycle_events(event_type);
CREATE INDEX idx_lifecycle_events_timestamp ON ticker_lifecycle_events(event_timestamp DESC);


-- =============================================================================
-- TICKER MONITORING SCHEDULE - Controls when to check various sources
-- =============================================================================

CREATE TABLE IF NOT EXISTS ticker_monitoring_schedule (
    ticker VARCHAR(10) PRIMARY KEY REFERENCES ticker_master(ticker),

    -- Check Frequencies (in seconds)
    edgar_check_interval INTEGER DEFAULT 3600, -- Default: 1 hour
    news_check_interval INTEGER DEFAULT 1800,  -- Default: 30 minutes
    social_check_interval INTEGER DEFAULT 900, -- Default: 15 minutes

    -- Next Check Times
    edgar_next_check TIMESTAMP,
    news_next_check TIMESTAMP,
    social_next_check TIMESTAMP,

    -- Last Check Results
    edgar_last_check TIMESTAMP,
    edgar_last_result VARCHAR(50), -- 'success', 'no_new', 'error'

    news_last_check TIMESTAMP,
    news_last_result VARCHAR(50),

    social_last_check TIMESTAMP,
    social_last_result VARCHAR(50),

    -- Adaptive Monitoring
    auto_adjust_frequency BOOLEAN DEFAULT true,
    -- Adjusts check frequency based on deal stage (more frequent near close)

    -- Metadata
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_monitoring_edgar_next ON ticker_monitoring_schedule(edgar_next_check)
    WHERE edgar_next_check IS NOT NULL;
CREATE INDEX idx_monitoring_news_next ON ticker_monitoring_schedule(news_next_check)
    WHERE news_next_check IS NOT NULL;


-- =============================================================================
-- POPULATE TICKER MASTER from existing deals
-- =============================================================================

-- Migrate target tickers from deal_intelligence
INSERT INTO ticker_master (
    ticker,
    company_name,
    lifecycle_status,
    active_deal_id,
    role_in_deal,
    first_rumor_detected_at,
    deal_announced_at,
    rumor_count,
    watch_priority,
    edgar_monitoring_enabled,
    created_at,
    updated_at
)
SELECT DISTINCT ON (di.target_ticker)
    di.target_ticker,
    di.target_name,
    CASE
        WHEN di.deal_tier = 'active' THEN 'announced'
        WHEN di.deal_tier = 'rumored' THEN 'rumored'
        ELSE 'rumored'
    END,
    di.deal_id,
    'target',
    di.first_detected_at,
    CASE WHEN di.deal_tier = 'active' THEN di.promoted_to_active_at END,
    di.source_count,
    CASE
        WHEN di.deal_tier = 'active' THEN 'critical'
        WHEN di.deal_tier = 'rumored' THEN 'high'
        ELSE 'normal'
    END,
    CASE WHEN di.deal_tier IN ('active', 'rumored') THEN true ELSE false END,
    di.created_at,
    di.updated_at
FROM deal_intelligence di
WHERE di.target_ticker IS NOT NULL
  AND di.target_ticker != ''
  AND di.deal_status NOT IN ('completed', 'terminated')
ORDER BY di.target_ticker, di.first_detected_at DESC
ON CONFLICT (ticker) DO NOTHING;

-- Migrate acquirer tickers from deal_intelligence
INSERT INTO ticker_master (
    ticker,
    company_name,
    lifecycle_status,
    active_deal_id,
    role_in_deal,
    watch_priority,
    edgar_monitoring_enabled,
    created_at,
    updated_at
)
SELECT DISTINCT ON (di.acquirer_ticker)
    di.acquirer_ticker,
    di.acquirer_name,
    'normal', -- Acquirer typically remains trading
    di.deal_id,
    'acquirer',
    'normal',
    false, -- Generally don't monitor acquirer as closely
    di.created_at,
    di.updated_at
FROM deal_intelligence di
WHERE di.acquirer_ticker IS NOT NULL
  AND di.acquirer_ticker != ''
  AND di.deal_status NOT IN ('completed', 'terminated')
  AND di.acquirer_ticker NOT IN (SELECT ticker FROM ticker_master) -- Don't override existing
ORDER BY di.acquirer_ticker, di.first_detected_at DESC
ON CONFLICT (ticker) DO NOTHING;

-- Initialize monitoring schedule for monitored tickers
INSERT INTO ticker_monitoring_schedule (
    ticker,
    edgar_next_check,
    news_next_check
)
SELECT
    ticker,
    NOW() + INTERVAL '5 minutes', -- Start checking soon
    NOW() + INTERVAL '10 minutes'
FROM ticker_master
WHERE edgar_monitoring_enabled = true
ON CONFLICT (ticker) DO NOTHING;


-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to update ticker lifecycle status
CREATE OR REPLACE FUNCTION update_ticker_lifecycle(
    p_ticker VARCHAR(10),
    p_new_status VARCHAR(50),
    p_triggered_by VARCHAR(100),
    p_notes TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_old_status VARCHAR(50);
BEGIN
    -- Get current status
    SELECT lifecycle_status INTO v_old_status
    FROM ticker_master
    WHERE ticker = p_ticker;

    -- Update ticker_master
    UPDATE ticker_master
    SET lifecycle_status = p_new_status,
        updated_at = NOW()
    WHERE ticker = p_ticker;

    -- Log the event
    INSERT INTO ticker_lifecycle_events (
        ticker,
        event_type,
        from_status,
        to_status,
        triggered_by,
        notes
    ) VALUES (
        p_ticker,
        'status_change',
        v_old_status,
        p_new_status,
        p_triggered_by,
        p_notes
    );
END;
$$ LANGUAGE plpgsql;

-- Function to log ticker event
CREATE OR REPLACE FUNCTION log_ticker_event(
    p_ticker VARCHAR(10),
    p_event_type VARCHAR(50),
    p_triggered_by VARCHAR(100),
    p_event_data JSONB DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
    v_current_status VARCHAR(50);
BEGIN
    -- Get current status
    SELECT lifecycle_status INTO v_current_status
    FROM ticker_master
    WHERE ticker = p_ticker;

    -- Insert event
    INSERT INTO ticker_lifecycle_events (
        ticker,
        event_type,
        to_status,
        triggered_by,
        event_data,
        notes
    ) VALUES (
        p_ticker,
        p_event_type,
        v_current_status,
        p_triggered_by,
        p_event_data,
        p_notes
    ) RETURNING event_id INTO v_event_id;

    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE ticker_master IS 'Security master - central registry tracking full lifecycle of each ticker from rumor to delisting';
COMMENT ON COLUMN ticker_master.intelligence_summary IS 'JSONB accumulation of all intelligence: rumors, news, filings, events';
COMMENT ON COLUMN ticker_master.lifecycle_status IS 'Current position in M&A lifecycle';
COMMENT ON COLUMN ticker_master.watch_priority IS 'Monitoring priority: critical (active deals near close), high (rumored), normal, low';

COMMENT ON TABLE ticker_lifecycle_events IS 'Audit trail of all ticker status changes and major events';
COMMENT ON TABLE ticker_monitoring_schedule IS 'Controls monitoring frequency for each ticker based on deal stage';
