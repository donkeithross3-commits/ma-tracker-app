-- Migration 013: Add matched text excerpt to staged_deals
-- Purpose: Store the exact text snippet from SEC filing that triggered M&A detection
-- This helps users quickly verify why a deal was flagged

-- Add matched_text_excerpt column to staged_deals
ALTER TABLE staged_deals
ADD COLUMN IF NOT EXISTS matched_text_excerpt TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN staged_deals.matched_text_excerpt IS 'Text excerpt from SEC filing showing M&A keywords/language that triggered detection';

-- Create index for text search (useful for debugging/analysis)
CREATE INDEX IF NOT EXISTS idx_staged_deals_matched_text ON staged_deals USING gin(to_tsvector('english', matched_text_excerpt));
