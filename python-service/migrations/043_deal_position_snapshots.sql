-- 043_deal_position_snapshots.sql
-- Track IB position snapshots for M&A account (U22596909).
-- Used to gate outcome detection and surface "Owned" flag in morning report.

CREATE TABLE IF NOT EXISTS deal_position_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date DATE NOT NULL,
    ticker VARCHAR(20) NOT NULL,
    account VARCHAR(20) NOT NULL DEFAULT 'U22596909',
    position_qty NUMERIC(18,4) NOT NULL,
    avg_cost NUMERIC(12,4),
    sec_type VARCHAR(10) DEFAULT 'STK',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (snapshot_date, ticker, account, sec_type)
);

CREATE INDEX IF NOT EXISTS idx_dps_ticker ON deal_position_snapshots (ticker);
CREATE INDEX IF NOT EXISTS idx_dps_date ON deal_position_snapshots (snapshot_date DESC);
