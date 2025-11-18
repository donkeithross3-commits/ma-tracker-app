-- Store all articles fetched by monitors (before M&A relevance filtering)
-- Migration: 021_monitor_raw_articles.sql

CREATE TABLE IF NOT EXISTS monitor_raw_articles (
    article_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source identification
    source_name VARCHAR(50) NOT NULL, -- 'reuters_ma', 'seeking_alpha_ma', 'globenewswire_ma', etc.
    source_type VARCHAR(20) NOT NULL, -- 'official', 'news', 'social'

    -- Article content
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    summary TEXT,
    published_at TIMESTAMP,

    -- M&A relevance filtering result
    is_ma_relevant BOOLEAN NOT NULL DEFAULT false,
    relevance_confidence DECIMAL(3,2), -- 0.00 to 1.00
    filter_reason TEXT, -- Why it was/wasn't deemed relevant

    -- Deduplication
    url_hash VARCHAR(64) UNIQUE, -- SHA-256 hash of URL for deduplication

    -- Timestamps
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_source_type CHECK (source_type IN ('official', 'news', 'social', 'indicator'))
);

CREATE INDEX idx_monitor_raw_articles_source_name ON monitor_raw_articles(source_name);
CREATE INDEX idx_monitor_raw_articles_fetched_at ON monitor_raw_articles(fetched_at DESC);
CREATE INDEX idx_monitor_raw_articles_is_ma_relevant ON monitor_raw_articles(is_ma_relevant);
CREATE INDEX idx_monitor_raw_articles_url_hash ON monitor_raw_articles(url_hash);

-- Update source_monitors table to track raw article counts
ALTER TABLE source_monitors
    ADD COLUMN IF NOT EXISTS total_raw_articles_fetched INT NOT NULL DEFAULT 0;

COMMENT ON TABLE monitor_raw_articles IS 'All articles fetched by monitors before M&A relevance filtering. Used for debugging filter performance and identifying false negatives.';
COMMENT ON COLUMN monitor_raw_articles.url_hash IS 'SHA-256 hash of URL to prevent duplicate storage of same article';
COMMENT ON COLUMN monitor_raw_articles.is_ma_relevant IS 'Whether the article passed M&A relevance filter';
COMMENT ON COLUMN monitor_raw_articles.filter_reason IS 'Explanation of why article was/was not deemed M&A-relevant';
