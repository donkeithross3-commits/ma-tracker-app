-- Migration 019: Add reasoning field to edgar_filings
-- Date: 2025-11-13
-- Description: Add reasoning text field to track why detector accepted/rejected each filing

-- Add reasoning column to store detector's explanation
ALTER TABLE edgar_filings
ADD COLUMN IF NOT EXISTS reasoning TEXT;

-- Add index for common query patterns
CREATE INDEX IF NOT EXISTS idx_edgar_filings_confidence
ON edgar_filings(confidence_score DESC)
WHERE status = 'analyzed';

CREATE INDEX IF NOT EXISTS idx_edgar_filings_filing_date_relevant
ON edgar_filings(filing_date DESC, is_ma_relevant);

-- Add comment
COMMENT ON COLUMN edgar_filings.reasoning IS 'Explanation from detector about why filing was accepted or rejected (e.g., "HIGH CONFIDENCE: 8-K Items [1.01] + 17 keywords + verified target")';
