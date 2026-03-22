-- Migration 059: AI Usage Tracking — unified telemetry for all AI consumption
--
-- Extends api_call_log with auth method, machine, session, account, and provider.
-- Creates ai_usage_sessions table for interactive Claude Code session tracking.
-- Supports multi-account (CAAM) and multi-provider (Codex) future state.

-- Extend api_call_log for unified AI usage tracking
ALTER TABLE api_call_log ADD COLUMN IF NOT EXISTS auth_method VARCHAR(20) DEFAULT 'api_key';
  -- 'api_key' = direct Anthropic SDK call
  -- 'cli_oauth' = claude CLI subprocess (Max subscription, $0)
  -- 'interactive' = interactive Claude Code session

ALTER TABLE api_call_log ADD COLUMN IF NOT EXISTS machine VARCHAR(30);
  -- 'mac', 'droplet', 'gaming-pc', 'garage-pc'

ALTER TABLE api_call_log ADD COLUMN IF NOT EXISTS session_id VARCHAR(80);
  -- Claude Code session UUID (populated for interactive and some CLI calls)

ALTER TABLE api_call_log ADD COLUMN IF NOT EXISTS account_id VARCHAR(50) DEFAULT 'primary';
  -- Subscription account identifier (for CAAM multi-account rotation)

ALTER TABLE api_call_log ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'anthropic';
  -- 'anthropic', 'openai' (future Codex support)

CREATE INDEX IF NOT EXISTS idx_api_call_log_auth_method ON api_call_log (auth_method);
CREATE INDEX IF NOT EXISTS idx_api_call_log_machine ON api_call_log (machine);

-- Session-level aggregate table — populated by the ai_usage_collector script
-- which runs on each machine and parses Claude Code JSONL session files via ccusage.
CREATE TABLE IF NOT EXISTS ai_usage_sessions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id            VARCHAR(80) NOT NULL UNIQUE,
    machine               VARCHAR(30) NOT NULL,
    provider              VARCHAR(20) NOT NULL DEFAULT 'anthropic',
    account_id            VARCHAR(50) DEFAULT 'primary',
    project               VARCHAR(200),         -- project directory path
    agent_persona         VARCHAR(50),           -- ops-deploy, bmc-quant, deal-intel, etc.
    model_primary         VARCHAR(80),           -- most-used model in session
    started_at            TIMESTAMPTZ,
    ended_at              TIMESTAMPTZ,
    input_tokens          BIGINT NOT NULL DEFAULT 0,
    output_tokens         BIGINT NOT NULL DEFAULT 0,
    cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens     BIGINT NOT NULL DEFAULT 0,
    cost_equivalent       NUMERIC(12,4) NOT NULL DEFAULT 0,  -- equivalent API cost in USD
    message_count         INT NOT NULL DEFAULT 0,
    subagent_count        INT NOT NULL DEFAULT 0,
    model_breakdown       JSONB,                -- per-model token counts
    collected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_sessions_started ON ai_usage_sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_sessions_machine ON ai_usage_sessions (machine);
CREATE INDEX IF NOT EXISTS idx_ai_usage_sessions_agent ON ai_usage_sessions (agent_persona);

-- Daily aggregate materialized view for fast dashboard queries
CREATE TABLE IF NOT EXISTS ai_usage_daily (
    date          DATE NOT NULL,
    machine       VARCHAR(30),
    auth_method   VARCHAR(20),
    provider      VARCHAR(20) DEFAULT 'anthropic',
    model         VARCHAR(80),
    source        VARCHAR(50),                    -- call site or 'interactive'
    input_tokens  BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens     BIGINT NOT NULL DEFAULT 0,
    cost_equivalent       NUMERIC(12,4) NOT NULL DEFAULT 0,
    call_count    INT NOT NULL DEFAULT 0,
    PRIMARY KEY (date, COALESCE(machine, ''), COALESCE(auth_method, ''),
                 COALESCE(provider, 'anthropic'), COALESCE(model, ''),
                 COALESCE(source, ''))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_date ON ai_usage_daily (date);
