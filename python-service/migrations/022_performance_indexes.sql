-- Performance Optimization: Add indexes for frequently queried columns
-- Created: 2025-11-17
-- Purpose: Speed up EDGAR/Intelligence grid queries by 5-10x

-- 1. Staged deals - frequently filtered by status and sorted by date
CREATE INDEX IF NOT EXISTS idx_staged_deals_status_date
ON staged_deals(status, detected_at DESC);

-- 2. EDGAR filings - frequently filtered by date and relevance
CREATE INDEX IF NOT EXISTS idx_edgar_filings_date_relevant
ON edgar_filings(filing_date DESC, is_ma_relevant);

-- 3. EDGAR filings - for date range queries
CREATE INDEX IF NOT EXISTS idx_edgar_filings_filing_date
ON edgar_filings(filing_date DESC);

-- 4. Intelligence deals - frequently filtered by tier and sorted by date
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_tier_date
ON deal_intelligence(deal_tier, first_detected_at DESC);

-- 5. Intelligence deals - for status queries
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_status
ON deal_intelligence(deal_status);

-- 6. Watch list - ticker lookups
CREATE INDEX IF NOT EXISTS idx_watch_list_ticker
ON rumor_watch_list(ticker);

-- 7. Halt events - frequently queried by time
CREATE INDEX IF NOT EXISTS idx_halt_events_time
ON halt_events(halt_time DESC);

-- 8. Deal sources - frequently joined on deal_id
CREATE INDEX IF NOT EXISTS idx_deal_sources_deal_id
ON deal_sources(deal_id, detected_at DESC);

-- Analyze tables to update statistics for query planner
ANALYZE staged_deals;
ANALYZE edgar_filings;
ANALYZE deal_intelligence;
ANALYZE rumor_watch_list;
ANALYZE halt_events;
ANALYZE deal_sources;
