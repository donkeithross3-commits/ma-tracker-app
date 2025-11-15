-- Migration 017: Add performance indexes for intelligence system queries
-- Purpose: Speed up intelligence deals listing and filtering

-- Index on deal_intelligence for pending/watchlist filtering
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_tier_status_ticker
ON deal_intelligence(deal_tier, deal_status, target_ticker)
WHERE target_ticker IS NOT NULL;

-- Index on deal_intelligence for sorting by confidence and date
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_confidence_date
ON deal_intelligence(confidence_score DESC, first_detected_at DESC);

-- Index on deal_sources for batch fetching by deal_id
CREATE INDEX IF NOT EXISTS idx_deal_sources_deal_id
ON deal_sources(deal_id);

-- Index on deal_history for EDGAR cross-reference lookup
CREATE INDEX IF NOT EXISTS idx_deal_history_deal_id_type
ON deal_history(deal_id, change_type, changed_at DESC);

-- Index on rumor_watch_list for active ticker lookups
CREATE INDEX IF NOT EXISTS idx_rumor_watch_list_active_ticker
ON rumor_watch_list(ticker)
WHERE is_active = TRUE;

-- Index on staged_deals for duplicate detection
CREATE INDEX IF NOT EXISTS idx_staged_deals_ticker_status
ON staged_deals(target_ticker, status)
WHERE target_ticker IS NOT NULL;

-- Note: These indexes will speed up:
-- 1. Intelligence deals filtering by tier/status/ticker
-- 2. Sorting by confidence score and date
-- 3. Batch fetching sources and history
-- 4. Watch list filtering
-- 5. EDGAR duplicate detection
