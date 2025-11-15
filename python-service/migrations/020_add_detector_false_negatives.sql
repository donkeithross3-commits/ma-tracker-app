-- Migration 020: Add detector_false_negatives table
-- Date: 2025-11-13
-- Description: Track false negatives from the detector to improve filtering rules

CREATE TABLE IF NOT EXISTS detector_false_negatives (
    false_negative_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id TEXT NOT NULL REFERENCES edgar_filings(filing_id),
    staged_deal_id TEXT REFERENCES staged_deals(staged_deal_id),
    reported_by VARCHAR(255),
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detector_false_negatives_filing_id
ON detector_false_negatives(filing_id);

CREATE INDEX IF NOT EXISTS idx_detector_false_negatives_reported_at
ON detector_false_negatives(reported_at DESC);

COMMENT ON TABLE detector_false_negatives IS 'Tracks filings that were marked as not M&A relevant but actually were (false negatives)';
COMMENT ON COLUMN detector_false_negatives.filing_id IS 'The filing that was incorrectly classified';
COMMENT ON COLUMN detector_false_negatives.staged_deal_id IS 'The staged deal created when the false negative was corrected';
COMMENT ON COLUMN detector_false_negatives.reported_by IS 'User who identified the false negative';
COMMENT ON COLUMN detector_false_negatives.notes IS 'Notes about why this was a false negative';
