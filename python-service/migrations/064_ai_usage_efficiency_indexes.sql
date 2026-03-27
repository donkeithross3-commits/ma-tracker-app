-- Migration 064: Add indexes for AI usage efficiency queries
-- Supports window functions over (machine, time) and machine×agent grouping.

CREATE INDEX IF NOT EXISTS idx_ai_usage_sessions_machine_time
  ON ai_usage_sessions (machine, COALESCE(started_at, ended_at));

CREATE INDEX IF NOT EXISTS idx_ai_usage_sessions_machine_agent
  ON ai_usage_sessions (machine, agent_persona);
