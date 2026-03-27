-- Migration 061: Canonical broker execution ledger + durable exit reservations

CREATE TABLE IF NOT EXISTS algo_executions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 VARCHAR(100) NOT NULL,
    broker_execution_key    VARCHAR(255) NOT NULL,
    position_id             VARCHAR(100) DEFAULT '',
    strategy_id             VARCHAR(100) DEFAULT '',
    account                 VARCHAR(100) DEFAULT '',
    exec_id                 VARCHAR(100) DEFAULT '',
    order_id                INTEGER,
    perm_id                 BIGINT,
    contract_key            VARCHAR(120) NOT NULL,

    symbol                  VARCHAR(20) DEFAULT '',
    sec_type                VARCHAR(10) DEFAULT 'OPT',
    strike                  NUMERIC(12,6),
    expiry                  VARCHAR(20) DEFAULT '',
    right_type              VARCHAR(5) DEFAULT '',

    side                    VARCHAR(10) DEFAULT '',
    level                   VARCHAR(30) DEFAULT '',
    qty_filled              INTEGER,
    avg_price               NUMERIC(12,6),
    fill_time               TIMESTAMPTZ,
    remaining_qty           INTEGER,
    pnl_pct                 NUMERIC(10,6),

    routing_exchange        VARCHAR(20) DEFAULT '',
    fill_exchange           VARCHAR(20) DEFAULT '',
    last_liquidity          INTEGER,
    slippage                NUMERIC(10,6),
    effective_spread        NUMERIC(10,6),
    pre_trade_snapshot      JSONB,
    post_fill               JSONB DEFAULT '{}',

    commission              NUMERIC(10,4),
    realized_pnl_ib         NUMERIC(14,4),
    source                  VARCHAR(50) DEFAULT '',
    unresolved_position     BOOLEAN NOT NULL DEFAULT FALSE,

    analytics_status        VARCHAR(30) NOT NULL DEFAULT 'provisional',
    degraded_reasons        JSONB DEFAULT '[]',
    finalization_state      JSONB DEFAULT '{}',
    captured_at             TIMESTAMPTZ,
    broker_enriched_at      TIMESTAMPTZ,
    analytics_finalized_at  TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, broker_execution_key)
);

CREATE INDEX IF NOT EXISTS idx_algo_exec_user_position ON algo_executions (user_id, position_id);
CREATE INDEX IF NOT EXISTS idx_algo_exec_user_exec_id ON algo_executions (user_id, exec_id);
CREATE INDEX IF NOT EXISTS idx_algo_exec_contract ON algo_executions (user_id, contract_key, fill_time DESC);
CREATE INDEX IF NOT EXISTS idx_algo_exec_fill_time ON algo_executions (fill_time DESC);

CREATE TABLE IF NOT EXISTS algo_exit_reservations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             VARCHAR(100) NOT NULL,
    reservation_id      VARCHAR(100) NOT NULL,
    strategy_id         VARCHAR(100) DEFAULT '',
    contract_key        VARCHAR(120) NOT NULL,
    symbol              VARCHAR(20) DEFAULT '',
    strike              NUMERIC(12,6),
    expiry              VARCHAR(20) DEFAULT '',
    right_type          VARCHAR(5) DEFAULT '',
    reserved_qty        INTEGER NOT NULL DEFAULT 0,
    order_id            INTEGER,
    perm_id             BIGINT,
    source              VARCHAR(50) DEFAULT '',
    status              VARCHAR(30) DEFAULT '',
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    release_reason      VARCHAR(50) DEFAULT '',
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    released_at         TIMESTAMPTZ,

    UNIQUE (user_id, reservation_id)
);

CREATE INDEX IF NOT EXISTS idx_algo_res_user_contract ON algo_exit_reservations (user_id, contract_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_algo_res_user_active ON algo_exit_reservations (user_id, active, updated_at DESC);
