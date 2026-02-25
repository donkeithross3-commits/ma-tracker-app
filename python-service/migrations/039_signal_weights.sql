-- 039_signal_weights.sql
-- Signal accuracy tracking and dynamic ensemble weights.
-- Idempotent (IF NOT EXISTS safe).

CREATE TABLE IF NOT EXISTS signal_accuracy (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Aggregation period
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    n_deals             INTEGER NOT NULL,

    -- Overall signal accuracy (Brier scores, lower = better)
    options_brier       NUMERIC(8,6),
    sheet_brier         NUMERIC(8,6),
    ai_brier            NUMERIC(8,6),

    -- Per-factor accuracy (JSONB for flexibility)
    factor_accuracy     JSONB,

    -- Derived weights (normalized to sum to 1.0)
    options_weight      NUMERIC(5,4),
    sheet_weight        NUMERIC(5,4),
    ai_weight           NUMERIC(5,4),

    -- Per-factor weights
    factor_weights      JSONB,

    CONSTRAINT uq_signal_accuracy UNIQUE (period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_signal_accuracy_period
    ON signal_accuracy (computed_at DESC);
