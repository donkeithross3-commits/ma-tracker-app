-- Migration 058: Enrichment status tracking
-- Adds proper tracking of enrichment attempts, failures, and retry eligibility.

BEGIN;

-- Track enrichment status and failure reason per deal
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(30) DEFAULT 'pending'
    CHECK (enrichment_status IN (
        'pending',           -- never attempted
        'enriched',          -- acquirer identified successfully
        'not_ma',            -- filing analyzed, not a real acquisition
        'extraction_failed', -- Claude saw text but couldn't extract (try different filing)
        'sec_failed',        -- SEC fetch failed (503, timeout) — retriable
        'no_filings',        -- deal has no fetchable filing URLs
        'retry_queued'       -- queued for re-enrichment with different strategy
    ));

ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS enrichment_failure_reason TEXT;
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS enrichment_attempts INT DEFAULT 0;
ALTER TABLE research_deals ADD COLUMN IF NOT EXISTS enrichment_last_filing_type VARCHAR(20);  -- which filing type was tried last

-- Backfill from existing data
-- Deals with real acquirer names → enriched
UPDATE research_deals SET enrichment_status = 'enriched', enrichment_attempts = 1
WHERE acquirer_name IS NOT NULL AND acquirer_name != 'Unknown' AND last_enriched IS NOT NULL;

-- Deals attempted (last_enriched set) but still Unknown → extraction_failed
UPDATE research_deals SET enrichment_status = 'extraction_failed', enrichment_attempts = 1
WHERE acquirer_name = 'Unknown' AND last_enriched IS NOT NULL;

-- Deals never attempted → pending
UPDATE research_deals SET enrichment_status = 'pending'
WHERE last_enriched IS NULL AND enrichment_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_research_deals_enrichment_status ON research_deals (enrichment_status);

COMMIT;
