-- Migration 007: Production Deal Tracking and Suggestions System
-- Add bidirectional linking between intelligence and production systems

-- Add production tracking columns to deal_intelligence
ALTER TABLE deal_intelligence
ADD COLUMN IF NOT EXISTS production_deal_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS tracking_status VARCHAR(50) DEFAULT 'monitoring_only',
ADD COLUMN IF NOT EXISTS last_synced_to_production TIMESTAMP,
ADD COLUMN IF NOT EXISTS enhanced_monitoring_enabled BOOLEAN DEFAULT FALSE;

-- Create index for production_deal_id lookups
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_production_id ON deal_intelligence(production_deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_intelligence_tracking_status ON deal_intelligence(tracking_status);

-- Add comments
COMMENT ON COLUMN deal_intelligence.production_deal_id IS 'ID of the corresponding deal in the production Prisma database';
COMMENT ON COLUMN deal_intelligence.tracking_status IS 'Status: monitoring_only, tracking_for_production, synced_to_production, discontinued';
COMMENT ON COLUMN deal_intelligence.last_synced_to_production IS 'Last time deal data was synced to production';
COMMENT ON COLUMN deal_intelligence.enhanced_monitoring_enabled IS 'Whether enhanced research and monitoring is active for this deal';

-- Create production_deal_suggestions table
CREATE TABLE IF NOT EXISTS production_deal_suggestions (
    suggestion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deal_intelligence(deal_id) ON DELETE CASCADE,
    production_deal_id VARCHAR(255) NOT NULL,

    -- Suggestion details
    suggestion_type VARCHAR(50) NOT NULL, -- 'attribute_update', 'risk_change', 'material_event', 'new_information'
    suggested_field VARCHAR(100), -- The field to update (e.g., 'deal_value', 'expected_close_date')
    current_value TEXT, -- Current value in production
    suggested_value TEXT, -- Suggested new value
    confidence_score DECIMAL(3, 2), -- 0.00 to 1.00
    reasoning TEXT NOT NULL, -- Explanation for the suggestion

    -- Source tracking
    source_ids UUID[], -- Array of source_ids that support this suggestion
    source_count INTEGER DEFAULT 0,

    -- Status and review
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'auto_applied'
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    applied_at TIMESTAMP,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for suggestions
CREATE INDEX IF NOT EXISTS idx_suggestions_deal_id ON production_deal_suggestions(deal_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_production_deal_id ON production_deal_suggestions(production_deal_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON production_deal_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_type ON production_deal_suggestions(suggestion_type);
CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON production_deal_suggestions(created_at DESC);

-- Add comments
COMMENT ON TABLE production_deal_suggestions IS 'Suggestions for updating production deals based on intelligence monitoring';
COMMENT ON COLUMN production_deal_suggestions.suggestion_type IS 'Type of suggestion: attribute_update, risk_change, material_event, new_information';
COMMENT ON COLUMN production_deal_suggestions.confidence_score IS 'Confidence level in this suggestion (0.0-1.0)';
COMMENT ON COLUMN production_deal_suggestions.status IS 'Status: pending, accepted, rejected, auto_applied';

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_suggestion_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_suggestion_timestamp
    BEFORE UPDATE ON production_deal_suggestions
    FOR EACH ROW
    EXECUTE FUNCTION update_suggestion_updated_at();
