-- Migration 015: Add rejection reason tracking to deal_intelligence (rumored deals)
-- Purpose: Track why rumored deals were rejected to train ML models and improve rumor filtering
-- Mirrors the rejection tracking system from staged_deals

-- Add status column to support rejection workflow
ALTER TABLE deal_intelligence
ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'active';
-- Values: 'active', 'rejected', 'archived'

-- Add rejection tracking columns
ALTER TABLE deal_intelligence
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS rejection_category VARCHAR(50),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100);

-- Add comments explaining the columns
COMMENT ON COLUMN deal_intelligence.review_status IS 'Review status: active (monitoring), rejected (false positive), archived (completed/terminated)';
COMMENT ON COLUMN deal_intelligence.rejection_reason IS 'Free-text explanation of why the rumored deal was rejected (used for ML training)';
COMMENT ON COLUMN deal_intelligence.rejection_category IS 'Structured category: not_rumor, insufficient_evidence, wrong_company, social_media_noise, already_in_production, other';

-- Create index for querying rejected deals
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_review_status ON deal_intelligence(review_status);
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_rejection_category ON deal_intelligence(rejection_category) WHERE rejection_category IS NOT NULL;

-- Create view for rejection analysis (useful for training data)
CREATE OR REPLACE VIEW deal_intelligence_rejection_analysis AS
SELECT
    rejection_category,
    COUNT(*) as rejection_count,
    AVG(confidence_score) as avg_confidence,
    COUNT(DISTINCT target_ticker) as unique_tickers,
    array_agg(DISTINCT deal_tier) as deal_tiers
FROM deal_intelligence
WHERE review_status = 'rejected' AND rejection_category IS NOT NULL
GROUP BY rejection_category
ORDER BY rejection_count DESC;

COMMENT ON VIEW deal_intelligence_rejection_analysis IS 'Aggregated rejection statistics for improving rumor detection algorithms';
