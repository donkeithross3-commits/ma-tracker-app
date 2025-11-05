-- Fix Duplicate Sources Issue
-- Migration: 006_fix_duplicate_sources.sql
-- Purpose: Prevent and clean up duplicate source entries for deals

-- =============================================================================
-- STEP 1: Clean up existing duplicates (keep oldest entry per URL)
-- =============================================================================

-- First, identify and remove duplicate sources (keeping the oldest one for each URL)
DELETE FROM deal_sources
WHERE source_id IN (
    SELECT source_id
    FROM (
        SELECT
            source_id,
            ROW_NUMBER() OVER (
                PARTITION BY deal_id, source_url
                ORDER BY detected_at ASC
            ) as rn
        FROM deal_sources
        WHERE source_url IS NOT NULL
    ) t
    WHERE rn > 1
);

-- =============================================================================
-- STEP 2: Add unique constraint to prevent future duplicates
-- =============================================================================

-- Add unique constraint on (deal_id, source_url) to prevent duplicates
-- This will prevent the same article/source URL from being added twice to a deal
CREATE UNIQUE INDEX idx_deal_sources_unique_url
ON deal_sources(deal_id, source_url)
WHERE source_url IS NOT NULL;

-- =============================================================================
-- STEP 3: Update deal source counts to reflect deduplicated sources
-- =============================================================================

-- Recalculate source_count for all deals after deduplication
UPDATE deal_intelligence di
SET source_count = (
    SELECT COUNT(*)
    FROM deal_sources ds
    WHERE ds.deal_id = di.deal_id
);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON INDEX idx_deal_sources_unique_url IS
'Prevents duplicate sources with the same URL from being added to a deal. Partial index excludes NULL source_url values.';
