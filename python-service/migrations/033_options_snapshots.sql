-- 033_options_snapshots.sql
-- Daily options analysis snapshots for deal tickers.

CREATE TABLE IF NOT EXISTS deal_options_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date       DATE NOT NULL,
    ticker              VARCHAR(10) NOT NULL,

    -- Implied volatility
    atm_iv              NUMERIC(8,4),
    atm_iv_30d_avg      NUMERIC(8,4),
    iv_rank_pct         NUMERIC(6,2),
    put_call_ratio      NUMERIC(8,4),

    -- Best covered call
    cc_best_strike      NUMERIC(12,4),
    cc_best_expiry      VARCHAR(10),
    cc_best_premium     NUMERIC(12,4),
    cc_best_ann_yield   NUMERIC(8,4),
    cc_best_cushion_pct NUMERIC(8,4),

    -- Best spread
    spread_best_type    VARCHAR(20),
    spread_best_yield   NUMERIC(8,4),

    -- Volume
    total_call_volume   INTEGER,
    total_put_volume    INTEGER,
    unusual_volume      BOOLEAN DEFAULT FALSE,
    unusual_detail      TEXT,

    -- Optionability
    has_options         BOOLEAN DEFAULT FALSE,
    chain_depth         INTEGER,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_options_snapshot UNIQUE (snapshot_date, ticker)
);

CREATE INDEX IF NOT EXISTS idx_options_snap_date
    ON deal_options_snapshots (snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_options_snap_ticker_date
    ON deal_options_snapshots (ticker, snapshot_date DESC);
