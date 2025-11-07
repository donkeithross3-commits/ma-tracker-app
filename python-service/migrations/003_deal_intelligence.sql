-- Multi-Source M&A Intelligence Platform Schema
-- Migration: 003_deal_intelligence.sql

-- Core deal intelligence table (aggregates information from all sources)
CREATE TABLE IF NOT EXISTS deal_intelligence (
    deal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core deal information
    target_ticker VARCHAR(10),
    target_name VARCHAR(255) NOT NULL,
    acquirer_ticker VARCHAR(10),
    acquirer_name VARCHAR(255),

    -- Deal classification
    deal_tier VARCHAR(20) NOT NULL DEFAULT 'watchlist', -- 'active', 'rumored', 'watchlist'
    deal_status VARCHAR(20) NOT NULL DEFAULT 'rumored', -- 'announced', 'pending_approval', 'in_progress', 'completed', 'terminated'

    -- Deal details
    deal_value DECIMAL(12,2), -- In billions
    deal_type VARCHAR(50), -- 'merger', 'acquisition', 'tender_offer', etc.

    -- Intelligence metadata
    confidence_score DECIMAL(3,2) NOT NULL DEFAULT 0.50, -- 0.00 to 1.00
    source_count INT NOT NULL DEFAULT 0, -- Number of sources mentioning this deal

    -- Timeline
    first_detected_at TIMESTAMP NOT NULL,
    last_updated_source_at TIMESTAMP,
    promoted_to_rumored_at TIMESTAMP,
    promoted_to_active_at TIMESTAMP,
    completed_at TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Indexes for common queries
    CONSTRAINT valid_tier CHECK (deal_tier IN ('active', 'rumored', 'watchlist')),
    CONSTRAINT valid_status CHECK (deal_status IN ('rumored', 'announced', 'pending_approval', 'in_progress', 'completed', 'terminated'))
);

CREATE INDEX idx_deal_intelligence_target_ticker ON deal_intelligence(target_ticker);
CREATE INDEX idx_deal_intelligence_acquirer_ticker ON deal_intelligence(acquirer_ticker);
CREATE INDEX idx_deal_intelligence_tier ON deal_intelligence(deal_tier);
CREATE INDEX idx_deal_intelligence_status ON deal_intelligence(deal_status);
CREATE INDEX idx_deal_intelligence_first_detected ON deal_intelligence(first_detected_at DESC);

-- Source mentions table (tracks each mention across sources)
CREATE TABLE IF NOT EXISTS deal_sources (
    source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deal_intelligence(deal_id) ON DELETE CASCADE,

    -- Source identification
    source_name VARCHAR(50) NOT NULL, -- 'edgar', 'ftc', 'reuters', 'twitter', 'seeking_alpha', etc.
    source_type VARCHAR(20) NOT NULL, -- 'official', 'news', 'social', 'indicator'
    source_url TEXT,

    -- Mention details
    mention_type VARCHAR(30) NOT NULL, -- 'rumor', 'announcement', 'filing', 'clearance', 'corporate_action'
    headline TEXT,
    content_snippet TEXT,

    -- Credibility
    credibility_score DECIMAL(3,2) NOT NULL DEFAULT 0.50,

    -- Extracted structured data (JSON)
    extracted_data JSONB,

    -- Timeline
    source_published_at TIMESTAMP,
    detected_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_source_type CHECK (source_type IN ('official', 'news', 'social', 'indicator'))
);

CREATE INDEX idx_deal_sources_deal_id ON deal_sources(deal_id);
CREATE INDEX idx_deal_sources_source_name ON deal_sources(source_name);
CREATE INDEX idx_deal_sources_detected_at ON deal_sources(detected_at DESC);
CREATE INDEX idx_deal_sources_extracted_data ON deal_sources USING gin(extracted_data);

-- Ticker watchlist with tier management
CREATE TABLE IF NOT EXISTS ticker_watchlist (
    ticker VARCHAR(10) PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,

    -- Watch tier management
    watch_tier VARCHAR(20) NOT NULL DEFAULT 'general', -- 'active', 'rumored', 'general'

    -- Associated deal (if promoted from general)
    active_deal_id UUID REFERENCES deal_intelligence(deal_id),

    -- Timeline
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    promoted_to_rumored_at TIMESTAMP,
    promoted_to_active_at TIMESTAMP,
    last_activity_at TIMESTAMP,

    -- User notes
    notes TEXT,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_watch_tier CHECK (watch_tier IN ('active', 'rumored', 'general'))
);

CREATE INDEX idx_ticker_watchlist_tier ON ticker_watchlist(watch_tier);
CREATE INDEX idx_ticker_watchlist_last_activity ON ticker_watchlist(last_activity_at DESC);

-- Source monitor configuration and state
CREATE TABLE IF NOT EXISTS source_monitors (
    source_name VARCHAR(50) PRIMARY KEY,
    source_type VARCHAR(20) NOT NULL,

    -- Monitoring configuration
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    poll_interval_seconds INT NOT NULL DEFAULT 300, -- 5 minutes default

    -- Source-specific configuration (JSON)
    config JSONB,

    -- State tracking
    last_poll_at TIMESTAMP,
    last_success_at TIMESTAMP,
    last_error_at TIMESTAMP,
    error_count INT NOT NULL DEFAULT 0,
    last_error TEXT,

    -- Statistics
    total_polls INT NOT NULL DEFAULT 0,
    total_deals_found INT NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Insert default source configurations
INSERT INTO source_monitors (source_name, source_type, poll_interval_seconds, config) VALUES
    ('edgar', 'official', 60, '{"rss_url": "https://www.sec.gov/cgi-bin/browse-edgar", "forms": ["8-K", "SC TO", "DEFM14A"]}'),
    ('ftc_early_termination', 'official', 3600, '{"url": "https://www.ftc.gov/legal-library/browse/early-termination-notices"}'),
    ('nasdaq_headlines', 'official', 300, '{"url": "http://www.nasdaqtrader.com/Trader.aspx?id=archiveheadlines&cat_id=105"}'),
    ('nyse_corporate_actions', 'official', 300, '{"url": "https://www.nyse.com/corporate-actions"}'),
    ('reuters_ma', 'news', 600, '{"rss_url": "https://www.reuters.com/legal/mergers-acquisitions/"}'),
    ('seeking_alpha_ma', 'news', 600, '{"url": "https://seekingalpha.com/market-news/m-a"}'),
    ('twitter_open_outcrier', 'social', 300, '{"username": "OpenOutcrier", "url": "https://twitter.com/OpenOutcrier"}'),
    ('quantum_online', 'indicator', 3600, '{"url": "https://www.quantumonline.com/"}'),
    ('alpharank', 'indicator', 3600, '{"url": "https://alpharank.com/"}')
ON CONFLICT (source_name) DO NOTHING;

-- Deal history log (for audit trail)
CREATE TABLE IF NOT EXISTS deal_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deal_intelligence(deal_id) ON DELETE CASCADE,

    -- Change tracking
    change_type VARCHAR(50) NOT NULL, -- 'created', 'tier_promoted', 'status_updated', 'source_added', etc.
    old_value JSONB,
    new_value JSONB,

    -- Context
    triggered_by VARCHAR(50), -- 'system', 'user', 'source_name'
    notes TEXT,

    -- Timestamp
    changed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deal_history_deal_id ON deal_history(deal_id);
CREATE INDEX idx_deal_history_changed_at ON deal_history(changed_at DESC);

-- Link existing staged_deals to deal_intelligence
-- This allows gradual migration from old system to new
ALTER TABLE staged_deals ADD COLUMN IF NOT EXISTS deal_intelligence_id UUID REFERENCES deal_intelligence(deal_id);
CREATE INDEX IF NOT EXISTS idx_staged_deals_intelligence ON staged_deals(deal_intelligence_id);

COMMENT ON TABLE deal_intelligence IS 'Core multi-source M&A deal intelligence aggregation table';
COMMENT ON TABLE deal_sources IS 'Individual source mentions that contribute to deal intelligence';
COMMENT ON TABLE ticker_watchlist IS 'Ticker categorization and watch tier management';
COMMENT ON TABLE source_monitors IS 'Configuration and state for each data source monitor';
COMMENT ON TABLE deal_history IS 'Audit trail for all deal intelligence changes';
