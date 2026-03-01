-- Migration 049: Algo trade P&L history
-- Two tables: positions (aggregate view) + fills (per-execution detail)
-- Agent position_store.json is the source of truth; PostgreSQL is the historical archive.
-- Sync is fire-and-forget with idempotent upserts (ON CONFLICT ... DO UPDATE).

CREATE TABLE IF NOT EXISTS algo_positions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id         VARCHAR(100) NOT NULL,          -- e.g. "bmc_risk_1709000000"
    user_id             VARCHAR(100) NOT NULL,           -- from WebSocket auth
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
    strategy_type       VARCHAR(50) DEFAULT 'risk_manager',
    parent_strategy     VARCHAR(100) DEFAULT '',         -- "bmc_spy", "bmc_slv"

    -- Instrument (top-level for indexed queries)
    symbol              VARCHAR(20) NOT NULL,
    sec_type            VARCHAR(10) DEFAULT 'OPT',
    strike              NUMERIC(12,4),
    expiry              VARCHAR(20),                     -- YYYYMMDD from IB
    right_type          VARCHAR(5),                      -- C / P

    -- Entry
    entry_price         NUMERIC(12,6),
    entry_quantity      INTEGER,
    entry_time          TIMESTAMPTZ,

    -- Exit
    exit_reason         VARCHAR(50),                     -- risk_exit / expired_worthless / manual_close
    closed_at           TIMESTAMPTZ,

    -- Denormalized P&L (computed at upsert time from fill_log)
    total_gross_pnl     NUMERIC(14,4),
    total_commission    NUMERIC(10,4) DEFAULT 0,
    total_net_pnl       NUMERIC(14,4),
    multiplier          INTEGER DEFAULT 100,

    -- Model lineage (top-level for indexed queries)
    model_version       VARCHAR(100),

    -- Flexible nested data (stored as-is from agent)
    lineage             JSONB DEFAULT '{}',
    risk_config         JSONB DEFAULT '{}',
    runtime_state       JSONB DEFAULT '{}',

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    agent_created_at    FLOAT,                           -- epoch from position_store

    UNIQUE (user_id, position_id)
);

CREATE INDEX IF NOT EXISTS idx_algo_pos_user_status ON algo_positions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_algo_pos_user_created ON algo_positions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_algo_pos_symbol ON algo_positions (symbol);
CREATE INDEX IF NOT EXISTS idx_algo_pos_model ON algo_positions (model_version);
CREATE INDEX IF NOT EXISTS idx_algo_pos_user_symbol ON algo_positions (user_id, symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS algo_fills (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id         VARCHAR(100) NOT NULL,           -- logical FK
    user_id             VARCHAR(100) NOT NULL,
    fill_index          INTEGER NOT NULL DEFAULT 0,      -- order within fill_log

    fill_time           TIMESTAMPTZ,
    order_id            INTEGER,
    exec_id             VARCHAR(100),
    level               VARCHAR(30) NOT NULL,            -- entry / trailing / expired_worthless
    qty_filled          INTEGER,
    avg_price           NUMERIC(12,6),
    remaining_qty       INTEGER,
    pnl_pct             NUMERIC(8,4),

    -- Execution analytics
    commission          NUMERIC(10,4),
    realized_pnl_ib     NUMERIC(14,4),
    fill_exchange       VARCHAR(20),
    slippage            NUMERIC(10,6),
    last_liquidity      INTEGER,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, position_id, fill_index)
);

CREATE INDEX IF NOT EXISTS idx_algo_fills_position ON algo_fills (user_id, position_id);
CREATE INDEX IF NOT EXISTS idx_algo_fills_time ON algo_fills (fill_time DESC);
