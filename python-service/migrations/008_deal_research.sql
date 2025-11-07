-- Deal Research Table
-- Migration: 008_deal_research.sql
-- Stores AI-generated research reports for intelligence deals

CREATE TABLE IF NOT EXISTS deal_research (
    research_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deal_intelligence(deal_id) ON DELETE CASCADE,

    -- Research report (markdown format for human reading)
    report_markdown TEXT,

    -- Extracted structured data (JSON for form pre-population)
    extracted_deal_terms JSONB,

    -- Key extracted fields for quick access
    target_ticker VARCHAR(10),
    go_shop_end_date DATE,
    vote_risk VARCHAR(20),     -- 'low', 'medium', 'high'
    finance_risk VARCHAR(20),  -- 'low', 'medium', 'high'
    legal_risk VARCHAR(20),    -- 'low', 'medium', 'high'

    -- Processing metadata
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,

    CONSTRAINT valid_research_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT valid_vote_risk CHECK (vote_risk IS NULL OR vote_risk IN ('low', 'medium', 'high')),
    CONSTRAINT valid_finance_risk CHECK (finance_risk IS NULL OR finance_risk IN ('low', 'medium', 'high')),
    CONSTRAINT valid_legal_risk CHECK (legal_risk IS NULL OR legal_risk IN ('low', 'medium', 'high'))
);

-- Each deal should have only one research record
CREATE UNIQUE INDEX idx_deal_research_deal_id_unique ON deal_research(deal_id);

CREATE INDEX idx_deal_research_status ON deal_research(status);
CREATE INDEX idx_deal_research_created_at ON deal_research(created_at DESC);
CREATE INDEX idx_deal_research_extracted_data ON deal_research USING gin(extracted_deal_terms);
