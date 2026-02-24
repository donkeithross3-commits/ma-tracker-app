-- 032_portfolio_edgar_filings.sql
-- Storage for EDGAR filings detected by the portfolio watcher.

CREATE TABLE IF NOT EXISTS portfolio_edgar_filings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker            VARCHAR(10)   NOT NULL,
    accession_number  VARCHAR(100)  NOT NULL,
    filing_type       VARCHAR(50)   NOT NULL,
    company_name      VARCHAR(300),
    filing_date       VARCHAR(20),
    filing_url        TEXT,
    description       TEXT,
    detected_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    UNIQUE (ticker, accession_number)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_edgar_filings_ticker
    ON portfolio_edgar_filings (ticker, detected_at DESC);
