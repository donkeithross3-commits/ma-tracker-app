-- Persist AI filing impact assessments for feeding into morning risk assessments
CREATE TABLE IF NOT EXISTS portfolio_filing_impacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(20) NOT NULL,
    filing_accession VARCHAR(50),
    filing_type VARCHAR(20),
    filed_at TEXT,
    impact_level VARCHAR(10) NOT NULL DEFAULT 'none',
    summary TEXT,
    key_detail TEXT,
    risk_factor_affected VARCHAR(20),
    grade_change_suggested TEXT,
    action_required BOOLEAN DEFAULT FALSE,
    assessed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pfi_ticker ON portfolio_filing_impacts (ticker);
CREATE INDEX IF NOT EXISTS idx_pfi_assessed ON portfolio_filing_impacts (assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pfi_ticker_date ON portfolio_filing_impacts (ticker, assessed_at DESC);
