-- Widen remaining VARCHAR columns that receive AI-extracted data
-- Several deals still failing with "value too long for type character varying(30)"
-- after migration 060 only widened 4 columns
-- NOTE: Already applied to production DB on 2026-03-27 via direct asyncpg

ALTER TABLE research_deals
    ALTER COLUMN discovery_source TYPE VARCHAR(50),
    ALTER COLUMN target_listing_status TYPE VARCHAR(50),
    ALTER COLUMN target_incorporation TYPE VARCHAR(50),
    ALTER COLUMN shareholder_approval_threshold TYPE VARCHAR(50),
    ALTER COLUMN tax_treatment TYPE VARCHAR(50),
    ALTER COLUMN enrichment_status TYPE VARCHAR(50),
    ALTER COLUMN enrichment_last_filing_type TYPE VARCHAR(50),
    ALTER COLUMN outcome TYPE VARCHAR(50),
    ALTER COLUMN clause_extraction_status TYPE VARCHAR(50),
    ALTER COLUMN market_data_status TYPE VARCHAR(50);
