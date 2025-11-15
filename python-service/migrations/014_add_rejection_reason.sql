-- Migration 014: Add rejection reason tracking to staged_deals
-- Purpose: Track why deals were rejected to train ML models and improve false positive filtering
-- This enables continuous improvement of the detection system

-- Add rejection_reason column to staged_deals
ALTER TABLE staged_deals
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add rejection_category column for structured categorization
ALTER TABLE staged_deals
ADD COLUMN IF NOT EXISTS rejection_category VARCHAR(50);

-- Add comments explaining the columns
COMMENT ON COLUMN staged_deals.rejection_reason IS 'Free-text explanation of why the deal was rejected (used for ML training)';
COMMENT ON COLUMN staged_deals.rejection_category IS 'Structured category: not_ma, duplicate, wrong_company, regulatory_only, incomplete, other';

-- Create index for analysis queries
CREATE INDEX IF NOT EXISTS idx_staged_deals_rejection_category ON staged_deals(rejection_category) WHERE rejection_category IS NOT NULL;

-- Create view for rejection analysis (useful for training data)
CREATE OR REPLACE VIEW staged_deals_rejection_analysis AS
SELECT
    rejection_category,
    COUNT(*) as rejection_count,
    AVG(confidence_score) as avg_confidence,
    COUNT(DISTINCT target_ticker) as unique_tickers,
    array_agg(DISTINCT deal_type) as deal_types
FROM staged_deals
WHERE status = 'rejected' AND rejection_category IS NOT NULL
GROUP BY rejection_category
ORDER BY rejection_count DESC;

COMMENT ON VIEW staged_deals_rejection_analysis IS 'Aggregated rejection statistics for improving detection algorithms';
