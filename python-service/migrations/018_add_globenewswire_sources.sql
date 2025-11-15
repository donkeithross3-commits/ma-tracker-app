-- Migration 018: Add GlobeNewswire RSS feed monitors
-- Date: 2025-11-13
-- Description: Adds three GlobeNewswire monitors for different RSS feed categories

-- Add GlobeNewswire M&A feed (primary source for announced deals)
INSERT INTO source_monitors (source_name, source_type, poll_interval_seconds, config, is_enabled)
VALUES (
    'globenewswire_ma',
    'news',
    600,  -- Poll every 10 minutes
    '{"feed_category": "ma", "feed_url": "https://www.globenewswire.com/RssFeed/subjectcode/27-Mergers%20And%20Acquisitions"}',
    true
)
ON CONFLICT (source_name) DO UPDATE SET
    config = EXCLUDED.config,
    poll_interval_seconds = EXCLUDED.poll_interval_seconds,
    is_enabled = EXCLUDED.is_enabled;

-- Add GlobeNewswire Corporate Actions feed (strategic reviews, proposals, etc.)
INSERT INTO source_monitors (source_name, source_type, poll_interval_seconds, config, is_enabled)
VALUES (
    'globenewswire_corporate_actions',
    'news',
    900,  -- Poll every 15 minutes (less frequent than M&A feed)
    '{"feed_category": "corporate_actions", "feed_url": "https://www.globenewswire.com/RssFeed/subjectcode/14-Corporate%20Actions"}',
    true
)
ON CONFLICT (source_name) DO UPDATE SET
    config = EXCLUDED.config,
    poll_interval_seconds = EXCLUDED.poll_interval_seconds,
    is_enabled = EXCLUDED.is_enabled;

-- Add GlobeNewswire Executive Changes feed (leadership transitions that may signal M&A)
INSERT INTO source_monitors (source_name, source_type, poll_interval_seconds, config, is_enabled)
VALUES (
    'globenewswire_executive_changes',
    'news',
    1800,  -- Poll every 30 minutes (lowest priority)
    '{"feed_category": "executive_changes", "feed_url": "https://www.globenewswire.com/RssFeed/subjectcode/33-Executive%20Leadership%20and%20Board%20Changes"}',
    true
)
ON CONFLICT (source_name) DO UPDATE SET
    config = EXCLUDED.config,
    poll_interval_seconds = EXCLUDED.poll_interval_seconds,
    is_enabled = EXCLUDED.is_enabled;

-- Add comment describing the monitors
COMMENT ON TABLE source_monitors IS 'Configuration and state for each data source monitor. GlobeNewswire monitors added in migration 018 for official press release coverage.';
