// ---------------------------------------------------------------------------
// API response types for all /ai-usage endpoints
// ---------------------------------------------------------------------------

export type ProgrammaticRow = {
  day: string;
  auth_method: string;
  source: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  call_count: number;
};

export type InteractiveRow = {
  day: string;
  machine: string;
  agent_persona: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_equivalent: number;
  session_count: number;
  message_count: number;
};

export type Totals = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd?: number | null;
  cost_equivalent?: number | null;
  call_count?: number | null;
  session_count?: number | null;
  message_count?: number | null;
};

export type SummaryResponse = {
  period_days: number;
  since: string;
  programmatic_calls: ProgrammaticRow[];
  interactive_sessions: InteractiveRow[];
  totals: {
    programmatic: Totals;
    interactive: Totals;
  };
};

export type RateWindow = {
  tokens_per_hour: number;
  cost_per_hour: number;
  total_tokens: number;
  total_cost_equivalent: number;
  window_hours: number;
};

export type QuotaHealth = {
  estimated_weekly_equiv: number;
  used_7d: number;
  pct: number;
};

export type BurnRateResponse = {
  rates: Record<string, RateWindow>;
  today: {
    cost_equivalent: number;
    programmatic_calls: number;
    interactive_sessions: number;
  };
  quota_health: QuotaHealth;
  computed_at: string;
};

export type SessionRow = {
  session_id: string;
  machine: string;
  provider: string;
  account_id: string;
  project: string | null;
  agent_persona: string | null;
  model_primary: string | null;
  started_at: string | null;
  ended_at: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_equivalent: number;
  message_count: number;
  subagent_count: number;
  model_breakdown: Record<string, unknown> | null;
  overhead_ratio: number;
};

export type SessionsResponse = {
  sessions: SessionRow[];
  total: number;
  limit: number;
  offset: number;
};

export type Anomaly = {
  type: string;
  severity: "high" | "medium" | "low";
  machine: string | null;
  agent: string | null;
  detail: string;
};

export type PerAgentEfficiency = {
  agent: string;
  machine: string;
  sessions: number;
  total_cost: number;
  avg_overhead_ratio: number;
  is_inefficient: boolean;
};

export type PerSessionEfficiency = {
  session_id: string;
  machine: string;
  agent_persona: string;
  model_primary: string | null;
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cost_equivalent: number;
  overhead_ratio: number;
  is_inefficient: boolean;
};

export type EfficiencyResponse = {
  period_days: number;
  per_session: PerSessionEfficiency[];
  per_agent: PerAgentEfficiency[];
  machine_agent_matrix: Record<string, Record<string, number>>;
  anomalies: Anomaly[];
};

// ---------------------------------------------------------------------------
// Quota budget (for automated workload gating dashboard)
// ---------------------------------------------------------------------------

export type QuotaBudget = {
  can_proceed: boolean;
  recommended_delay_sec: number;
  budget: {
    weekly_limit_equiv: number;
    weekly_used: number;
    weekly_remaining: number;
    weekly_pct: number;
    weekly_resets_at: string;
    hours_until_reset: number;
  };
  pace: {
    current_hourly_rate: number;
    sustainable_hourly_rate: number;
    throttle_factor: number;
  };
  automated_budget: {
    daily_cap_equiv: number;
    daily_used: number;
    daily_remaining: number;
    reserved_for_interactive: number;
  };
  computed_at: string;
};

// ---------------------------------------------------------------------------
// Aggregation types (frontend-computed)
// ---------------------------------------------------------------------------

export type DailyAggregate = {
  day: string;
  interactive_cost: number;
  programmatic_cost: number;
  total_tokens: number;
  sessions: number;
  calls: number;
  overhead_ratio: number;
  cache_creation: number;
};

export type AgentAggregate = {
  agent: string;
  cost: number;
  tokens: number;
  sessions: number;
  messages: number;
};

export type MachineAggregate = {
  machine: string;
  cost: number;
  tokens: number;
  sessions: number;
};
