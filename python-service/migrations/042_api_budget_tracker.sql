-- API Budget Tracker
-- Self-tracked Anthropic API budget since there's no balance endpoint.
-- Ledger records balance snapshots and credit additions; costs come from
-- risk_assessment_runs.total_cost_usd (already tracked).

CREATE TABLE IF NOT EXISTS api_budget_ledger (
    id          SERIAL PRIMARY KEY,
    event_type  TEXT NOT NULL CHECK (event_type IN ('balance_set', 'credit_added')),
    amount      NUMERIC(10,4) NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with current known balance (Feb 26, 2026 ~8PM ET)
INSERT INTO api_budget_ledger (event_type, amount, notes)
VALUES ('balance_set', 25.69, 'Initial balance from console screenshot 2026-02-26');
