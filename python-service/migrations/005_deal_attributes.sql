-- Deal Attributes Extraction - AI-powered deal term extraction from filings
-- Migration: 005_deal_attributes.sql
-- Purpose: Store structured deal attributes extracted from EDGAR filings for Luis's review

-- =============================================================================
-- DEAL ATTRIBUTES TABLE - Extracted deal terms from filings
-- =============================================================================

CREATE TABLE IF NOT EXISTS deal_attributes (
    attribute_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deal_intelligence(deal_id) ON DELETE CASCADE,

    -- Source Filing Information
    filing_id TEXT REFERENCES edgar_filings(filing_id),
    source_filing_type VARCHAR(20), -- '8-K', 'DEFM14A', 'S-4', 'SC TO-I', etc.
    source_filing_url TEXT,
    extraction_date TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Deal Structure
    deal_structure VARCHAR(50), -- 'cash', 'stock', 'mixed', 'cash_and_stock'
    cash_consideration DECIMAL(15,2), -- Per share cash amount
    stock_consideration DECIMAL(10,4), -- Exchange ratio or shares
    total_deal_value DECIMAL(15,2), -- Total transaction value
    currency VARCHAR(3) DEFAULT 'USD',

    -- Premium Analysis
    premium_to_closing_price DECIMAL(5,2), -- Premium as percentage
    premium_to_30day_avg DECIMAL(5,2),
    premium_to_52week_high DECIMAL(5,2),
    reference_date DATE, -- Date of premium calculation

    -- Closing Conditions
    closing_conditions JSONB, -- Array of conditions
    regulatory_approvals_required TEXT[], -- ['HSR', 'EU Competition', 'CFIUS', etc.]
    shareholder_approval_required BOOLEAN,
    shareholder_vote_threshold DECIMAL(4,2), -- e.g., 66.67 for 2/3 majority

    -- Timeline
    expected_close_date DATE,
    outside_date DATE, -- Date after which either party can terminate
    signing_date DATE,
    announcement_date DATE,

    -- Termination Rights
    termination_fee DECIMAL(15,2),
    termination_fee_pct DECIMAL(5,2), -- As % of deal value
    reverse_termination_fee DECIMAL(15,2), -- Fee if acquirer terminates
    reverse_termination_fee_pct DECIMAL(5,2),

    -- Go-Shop / No-Shop
    go_shop_period_days INTEGER,
    go_shop_end_date DATE,
    no_shop_provision BOOLEAN DEFAULT true,

    -- Collar Provisions (for stock deals)
    has_collar BOOLEAN DEFAULT false,
    collar_floor_price DECIMAL(10,2),
    collar_ceiling_price DECIMAL(10,2),

    -- Financing
    financing_commitment BOOLEAN,
    financing_sources TEXT[], -- ['committed debt financing', 'cash on hand', etc.]
    financing_amount DECIMAL(15,2),

    -- Advisors
    target_financial_advisor VARCHAR(255),
    target_legal_advisor VARCHAR(255),
    acquirer_financial_advisor VARCHAR(255),
    acquirer_legal_advisor VARCHAR(255),

    -- Additional Terms (flexible storage)
    additional_terms JSONB DEFAULT '{}'::jsonb,
    -- Structure: {
    --   "material_adverse_effect_carveouts": [...],
    --   "employee_matters": {...},
    --   "dividend_policy": {...},
    --   "representations_warranties": [...],
    --   "covenants": [...]
    -- }

    -- Extraction Metadata
    extraction_method VARCHAR(50) DEFAULT 'claude_ai', -- 'claude_ai', 'regex', 'manual'
    extraction_confidence DECIMAL(3,2), -- 0.00 to 1.00
    model_version VARCHAR(50), -- e.g., 'claude-sonnet-4-5-20250929'
    tokens_used INTEGER,

    -- Human Review Status
    review_status VARCHAR(50) DEFAULT 'pending_review',
    -- States: 'pending_review', 'in_review', 'approved', 'rejected', 'needs_correction'
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMP,
    review_notes TEXT,

    -- Corrections / Overrides
    corrections JSONB, -- Track human corrections for ML training
    original_extraction JSONB, -- Store original AI extraction before human edits

    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_review_status CHECK (
        review_status IN ('pending_review', 'in_review', 'approved', 'rejected', 'needs_correction')
    ),
    CONSTRAINT valid_deal_structure CHECK (
        deal_structure IN ('cash', 'stock', 'mixed', 'cash_and_stock', 'merger', 'tender_offer')
    )
);

-- Indexes for common query patterns
CREATE INDEX idx_deal_attributes_deal_id ON deal_attributes(deal_id);
CREATE INDEX idx_deal_attributes_filing_id ON deal_attributes(filing_id);
CREATE INDEX idx_deal_attributes_review_status ON deal_attributes(review_status);
CREATE INDEX idx_deal_attributes_extraction_date ON deal_attributes(extraction_date DESC);
CREATE INDEX idx_deal_attributes_additional_terms ON deal_attributes USING gin(additional_terms);

-- =============================================================================
-- EXTRACTION TEMPLATES - Prompts and instructions for different filing types
-- =============================================================================

CREATE TABLE IF NOT EXISTS extraction_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_type VARCHAR(20) NOT NULL UNIQUE, -- '8-K', 'DEFM14A', 'S-4', etc.
    template_name VARCHAR(255) NOT NULL,

    -- Extraction Prompt
    system_prompt TEXT NOT NULL,
    user_prompt_template TEXT NOT NULL, -- Template with {{filing_text}} placeholder

    -- Expected Fields
    expected_fields JSONB, -- List of fields this template should extract
    -- Structure: {"required": ["deal_structure", "total_deal_value"], "optional": [...]}

    -- Validation Rules
    validation_rules JSONB, -- Rules to validate extracted data

    -- Template Metadata
    version VARCHAR(20) DEFAULT '1.0',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100) DEFAULT 'system'
);

-- =============================================================================
-- EXTRACTION HISTORY - Audit trail of all extraction attempts
-- =============================================================================

CREATE TABLE IF NOT EXISTS extraction_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deal_intelligence(deal_id),
    filing_id TEXT REFERENCES edgar_filings(filing_id),

    -- Extraction Details
    extraction_status VARCHAR(50) NOT NULL, -- 'success', 'failed', 'partial'
    error_message TEXT,

    -- What was extracted
    extracted_attributes JSONB,
    extraction_confidence DECIMAL(3,2),

    -- Processing Details
    template_used VARCHAR(50),
    model_version VARCHAR(50),
    tokens_used INTEGER,
    processing_time_ms INTEGER,

    -- Timestamp
    extracted_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_extraction_status CHECK (
        extraction_status IN ('success', 'failed', 'partial', 'skipped')
    )
);

CREATE INDEX idx_extraction_history_deal_id ON extraction_history(deal_id, extracted_at DESC);
CREATE INDEX idx_extraction_history_filing_id ON extraction_history(filing_id);
CREATE INDEX idx_extraction_history_status ON extraction_history(extraction_status);

-- =============================================================================
-- INSERT DEFAULT EXTRACTION TEMPLATES
-- =============================================================================

-- Template for 8-K filings (Item 1.01 - Entry into Material Agreement)
INSERT INTO extraction_templates (
    filing_type,
    template_name,
    system_prompt,
    user_prompt_template,
    expected_fields
) VALUES (
    '8-K',
    'Merger Agreement 8-K Extraction',
    'You are an expert M&A analyst extracting deal terms from SEC filings. Extract structured information about merger and acquisition deals from 8-K filings. Focus on Item 1.01 (Material Definitive Agreement) and Item 2.01 (Completion of Acquisition). Be precise with numbers and dates. If information is not explicitly stated, return null rather than guessing.',
    'Extract the following deal attributes from this 8-K filing:

Filing Text:
{{filing_text}}

Please extract and return a JSON object with these fields:
- deal_structure: "cash", "stock", or "mixed"
- cash_consideration: per share cash amount (number only)
- stock_consideration: exchange ratio (number only)
- total_deal_value: total transaction value in millions
- premium_to_closing_price: premium as percentage
- expected_close_date: expected closing date (YYYY-MM-DD format)
- termination_fee: termination fee amount in millions
- regulatory_approvals_required: array of required approvals
- shareholder_approval_required: boolean
- target_financial_advisor: name of target''s financial advisor
- target_legal_advisor: name of target''s legal counsel
- acquirer_financial_advisor: name of acquirer''s financial advisor
- acquirer_legal_advisor: name of acquirer''s legal counsel

Return only valid JSON. Use null for any field where the information is not available.',
    '{"required": ["deal_structure", "total_deal_value"], "optional": ["cash_consideration", "stock_consideration", "premium_to_closing_price", "expected_close_date", "termination_fee", "regulatory_approvals_required", "shareholder_approval_required"]}'::jsonb
);

-- Template for DEFM14A (Definitive Proxy Statement)
INSERT INTO extraction_templates (
    filing_type,
    template_name,
    system_prompt,
    user_prompt_template,
    expected_fields
) VALUES (
    'DEFM14A',
    'Proxy Statement Extraction',
    'You are an expert M&A analyst extracting comprehensive deal terms from proxy statements. DEFM14A filings contain the most detailed information about merger transactions. Extract all relevant deal terms, conditions, and advisor information. Be thorough and precise.',
    'Extract comprehensive deal attributes from this proxy statement (DEFM14A):

Filing Text:
{{filing_text}}

Extract all available deal terms including structure, consideration, premiums, closing conditions, termination rights, go-shop provisions, collar arrangements, advisors, and timeline. Return a complete JSON object with all identified fields.',
    '{"required": ["deal_structure", "total_deal_value", "premium_to_closing_price", "expected_close_date", "termination_fee"], "optional": ["cash_consideration", "stock_consideration", "premium_to_30day_avg", "premium_to_52week_high", "regulatory_approvals_required", "shareholder_approval_required", "go_shop_period_days", "no_shop_provision", "has_collar"]}'::jsonb
);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to update deal_intelligence with extracted attributes
CREATE OR REPLACE FUNCTION sync_deal_attributes_to_intelligence()
RETURNS TRIGGER AS $$
BEGIN
    -- Update deal_intelligence with approved attribute values
    IF NEW.review_status = 'approved' THEN
        UPDATE deal_intelligence
        SET
            deal_value = COALESCE(NEW.total_deal_value, deal_value),
            deal_type = COALESCE(NEW.deal_structure, deal_type),
            updated_at = NOW()
        WHERE deal_id = NEW.deal_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-sync approved attributes
CREATE TRIGGER trigger_sync_approved_attributes
    AFTER INSERT OR UPDATE OF review_status
    ON deal_attributes
    FOR EACH ROW
    EXECUTE FUNCTION sync_deal_attributes_to_intelligence();

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE deal_attributes IS 'AI-extracted deal terms from SEC filings, pending human review and approval';
COMMENT ON COLUMN deal_attributes.additional_terms IS 'Flexible JSONB storage for deal-specific terms not covered by standard fields';
COMMENT ON COLUMN deal_attributes.corrections IS 'Track human corrections to improve future AI extractions';
COMMENT ON COLUMN deal_attributes.original_extraction IS 'Preserve original AI output before human edits for ML training';

COMMENT ON TABLE extraction_templates IS 'Prompt templates for extracting deal attributes from different filing types';
COMMENT ON TABLE extraction_history IS 'Complete audit trail of all extraction attempts for debugging and improvement';
