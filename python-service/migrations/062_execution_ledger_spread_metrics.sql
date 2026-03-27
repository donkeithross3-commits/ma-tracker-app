-- Migration 062: Persist canonical slippage and effective spread on executions

ALTER TABLE IF EXISTS algo_executions
    ADD COLUMN IF NOT EXISTS slippage NUMERIC(10,6);

ALTER TABLE IF EXISTS algo_executions
    ADD COLUMN IF NOT EXISTS effective_spread NUMERIC(10,6);
