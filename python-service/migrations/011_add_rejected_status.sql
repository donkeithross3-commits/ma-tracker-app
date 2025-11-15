-- Add 'rejected' as valid deal_status
-- Migration: 011_add_rejected_status.sql

-- Drop the existing constraint
ALTER TABLE deal_intelligence DROP CONSTRAINT IF EXISTS valid_status;

-- Add new constraint with 'rejected' status
ALTER TABLE deal_intelligence ADD CONSTRAINT valid_status
    CHECK (deal_status IN ('rumored', 'announced', 'pending_approval', 'in_progress', 'completed', 'terminated', 'rejected'));

COMMENT ON CONSTRAINT valid_status ON deal_intelligence IS 'Valid deal statuses including rejected for manually dismissed deals';
