"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserMenu } from "@/components/UserMenu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProgrammaticRow = {
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

type InteractiveRow = {
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

type Totals = {
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

type SummaryResponse = {
  period_days: number;
  since: string;
  programmatic_calls: ProgrammaticRow[];
  interactive_sessions: InteractiveRow[];
  totals: {
    programmatic: Totals;
    interactive: Totals;
  };
};

type RateWindow = {
  tokens_per_hour: number;
  cost_per_hour: number;
  total_tokens: number;
  total_cost_equivalent: number;
  window_hours: number;
};

type BurnRateResponse = {
  rates: Record<string, RateWindow>;
  today: {
    cost_equivalent: number;
    programmatic_calls: number;
    interactive_sessions: number;
  };
  computed_at: string;
};

type SessionRow = {
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
};

type SessionsResponse = {
  sessions: SessionRow[];
  total: number;
  limit: number;
  offset: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

const AGENT_COLORS: Record<string, string> = {
  "dashboard-ui": "text-blue-400",
  "trading-engine": "text-emerald-400",
  "ops-deploy": "text-amber-400",
  "bmc-quant": "text-purple-400",
  "deal-intel": "text-cyan-400",
  "parkinsons-research": "text-rose-400",
};

const AGENT_BADGES: Record<string, string> = {
  "dashboard-ui": "bg-blue-500/20 text-blue-400",
  "trading-engine": "bg-emerald-500/20 text-emerald-400",
  "ops-deploy": "bg-amber-500/20 text-amber-400",
  "bmc-quant": "bg-purple-500/20 text-purple-400",
  "deal-intel": "bg-cyan-500/20 text-cyan-400",
  "parkinsons-research": "bg-rose-500/20 text-rose-400",
};

const MACHINE_COLORS: Record<string, string> = {
  mac: "text-blue-400",
  droplet: "text-emerald-400",
  "gaming-pc": "text-purple-400",
  "garage-pc": "text-amber-400",
};

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

type DailyAggregate = {
  day: string;
  interactive_cost: number;
  programmatic_cost: number;
  total_tokens: number;
  sessions: number;
  calls: number;
  messages: number;
};

function aggregateByDay(summary: SummaryResponse | null): DailyAggregate[] {
  if (!summary) return [];
  const map = new Map<string, DailyAggregate>();

  const getOrCreate = (day: string): DailyAggregate => {
    let agg = map.get(day);
    if (!agg) {
      agg = {
        day,
        interactive_cost: 0,
        programmatic_cost: 0,
        total_tokens: 0,
        sessions: 0,
        calls: 0,
        messages: 0,
      };
      map.set(day, agg);
    }
    return agg;
  };

  for (const row of summary.interactive_sessions) {
    const agg = getOrCreate(row.day);
    agg.interactive_cost += row.cost_equivalent;
    // Only count input + output tokens. Cache tokens describe how input
    // was served (from cache vs fresh), not additional tokens consumed.
    agg.total_tokens += row.input_tokens + row.output_tokens;
    agg.sessions += row.session_count;
    agg.messages += row.message_count;
  }

  for (const row of summary.programmatic_calls) {
    const agg = getOrCreate(row.day);
    agg.programmatic_cost += row.cost_usd;
    agg.total_tokens += row.input_tokens + row.output_tokens;
    agg.calls += row.call_count;
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.day).getTime() - new Date(a.day).getTime()
  );
}

type AgentAggregate = {
  agent: string;
  cost: number;
  tokens: number;
  sessions: number;
  messages: number;
};

function aggregateByAgent(summary: SummaryResponse | null): AgentAggregate[] {
  if (!summary) return [];
  const map = new Map<string, AgentAggregate>();

  for (const row of summary.interactive_sessions) {
    const agent = row.agent_persona || "unknown";
    let agg = map.get(agent);
    if (!agg) {
      agg = { agent, cost: 0, tokens: 0, sessions: 0, messages: 0 };
      map.set(agent, agg);
    }
    agg.cost += row.cost_equivalent;
    agg.tokens += row.input_tokens + row.output_tokens;
    agg.sessions += row.session_count;
    agg.messages += row.message_count;
  }

  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

type MachineAggregate = {
  machine: string;
  cost: number;
  tokens: number;
  sessions: number;
};

function aggregateByMachine(summary: SummaryResponse | null): MachineAggregate[] {
  if (!summary) return [];
  const map = new Map<string, MachineAggregate>();

  for (const row of summary.interactive_sessions) {
    const machine = row.machine || "unknown";
    let agg = map.get(machine);
    if (!agg) {
      agg = { machine, cost: 0, tokens: 0, sessions: 0 };
      map.set(machine, agg);
    }
    agg.cost += row.cost_equivalent;
    agg.tokens += row.input_tokens + row.output_tokens;
    agg.sessions += row.session_count;
  }

  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

// ---------------------------------------------------------------------------
// Simple bar chart (CSS-only, no deps)
// ---------------------------------------------------------------------------

function CostBarChart({ data }: { data: DailyAggregate[] }) {
  if (!data.length)
    return <p className="text-gray-500 text-sm">No data available.</p>;

  // Show up to 14 days, oldest first
  const sliced = data.slice(0, 14).reverse();
  const maxCost = Math.max(...sliced.map((d) => d.interactive_cost + d.programmatic_cost), 0.01);

  return (
    <div className="flex items-end gap-1 h-32">
      {sliced.map((d) => {
        const total = d.interactive_cost + d.programmatic_cost;
        const pct = (total / maxCost) * 100;
        const interPct =
          total > 0 ? (d.interactive_cost / total) * pct : 0;
        const progPct = pct - interPct;

        return (
          <div
            key={d.day}
            className="flex-1 flex flex-col items-center gap-0.5 min-w-0"
            title={`${fmtDate(d.day)}: ${fmtCost(total)} (${d.sessions} sessions, ${d.calls} API calls)`}
          >
            <div className="w-full flex flex-col justify-end" style={{ height: "100px" }}>
              <div
                className="w-full bg-blue-500 rounded-t-sm"
                style={{ height: `${interPct}%`, minHeight: total > 0 ? 2 : 0 }}
              />
              {progPct > 0 && (
                <div
                  className="w-full bg-amber-500 rounded-b-sm"
                  style={{ height: `${progPct}%`, minHeight: 2 }}
                />
              )}
            </div>
            <span className="text-[9px] text-gray-500 font-mono truncate w-full text-center">
              {new Date(d.day).getDate()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AIUsagePage() {
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [burnRate, setBurnRate] = useState<BurnRateResponse | null>(null);
  const [sessions, setSessions] = useState<SessionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "sessions">("overview");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (periodDays: number) => {
    try {
      const [summaryRes, burnRes, sessionsRes] = await Promise.all([
        fetch(`/api/ai-usage/summary?days=${periodDays}`),
        fetch("/api/ai-usage/burn-rate"),
        fetch(`/api/ai-usage/sessions?days=${periodDays}&limit=50`),
      ]);

      if (!summaryRes.ok || !burnRes.ok || !sessionsRes.ok) {
        throw new Error("Failed to fetch AI usage data");
      }

      const [summaryData, burnData, sessionsData] = await Promise.all([
        summaryRes.json(),
        burnRes.json(),
        sessionsRes.json(),
      ]);

      setSummary(summaryData);
      setBurnRate(burnData);
      setSessions(sessionsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling (60s)
  useEffect(() => {
    setLoading(true);
    fetchData(days);

    pollRef.current = setInterval(() => {
      if (!document.hidden) {
        fetchData(days);
      }
    }, 60_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [days, fetchData]);

  // Aggregations
  const dailyData = useMemo(() => aggregateByDay(summary), [summary]);
  const agentData = useMemo(() => aggregateByAgent(summary), [summary]);
  const machineData = useMemo(() => aggregateByMachine(summary), [summary]);

  const totalCost = useMemo(() => {
    if (!summary) return 0;
    // Backend may return null for aggregate fields when no rows match
    return (
      (summary.totals.interactive?.cost_equivalent ?? 0) +
      (summary.totals.programmatic?.cost_usd ?? 0)
    );
  }, [summary]);

  const totalTokens = useMemo(() => {
    if (!summary) return 0;
    const n = (v: number | null | undefined) => v ?? 0;
    const i = summary.totals.interactive ?? {};
    const p = summary.totals.programmatic ?? {};
    // Only input + output. Cache tokens are not additive — they describe
    // how input tokens were served (from prompt cache vs fresh compute).
    return n(i.input_tokens) + n(i.output_tokens) + n(p.input_tokens) + n(p.output_tokens);
  }, [summary]);

  if (loading && !summary) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading AI usage data…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="px-3 py-2">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-500 hover:text-gray-300 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">AI Usage</h1>
              <p className="text-sm text-gray-400">
                Token consumption and cost tracking across all agents and machines
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Period selector */}
            <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-0.5">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    days === d
                      ? "bg-gray-700 text-gray-100"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <UserMenu variant="dark" />
          </div>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Burn Rate Cards */}
        {burnRate && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
              <div className="text-xs text-gray-500 mb-0.5">Today (API Equivalent)</div>
              <div className="text-2xl font-bold font-mono text-blue-400">
                {fmtCost(burnRate.today.cost_equivalent)}
              </div>
              <div className="text-xs text-gray-500">
                {burnRate.today.interactive_sessions} sessions · {burnRate.today.programmatic_calls} API calls
              </div>
            </div>
            {(["1h", "6h", "24h"] as const).map((window) => {
              const rate = burnRate.rates[window];
              if (!rate) return null;
              return (
                <div key={window} className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
                  <div className="text-xs text-gray-500 mb-0.5">{window} Equiv. Rate</div>
                  <div className="text-xl font-bold font-mono text-gray-100">
                    {fmtCost(rate.cost_per_hour)}
                    <span className="text-xs text-gray-500 font-normal">/hr</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {fmtTokens(rate.tokens_per_hour)} tok/hr
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Period Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-1">
          <div className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
            <div className="text-xs text-gray-500 mb-0.5">{days}d API Equivalent</div>
            <div className="text-xl font-bold font-mono text-blue-400">
              {fmtCost(summary?.totals.interactive?.cost_equivalent ?? 0)}
            </div>
            <div className="text-[10px] text-gray-600">what API pricing would charge</div>
          </div>
          <div className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
            <div className="text-xs text-gray-500 mb-0.5">{days}d API Spend</div>
            <div className="text-xl font-bold font-mono text-amber-400">
              {fmtCost(summary?.totals.programmatic?.cost_usd ?? 0)}
            </div>
            <div className="text-[10px] text-gray-600">actual billed API usage</div>
          </div>
          <div className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
            <div className="text-xs text-gray-500 mb-0.5">{days}d Tokens</div>
            <div className="text-xl font-bold font-mono">{fmtTokens(totalTokens)}</div>
            <div className="text-[10px] text-gray-600">input + output</div>
          </div>
          <div className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
            <div className="text-xs text-gray-500 mb-0.5">Sessions</div>
            <div className="text-xl font-bold font-mono">
              {summary?.totals.interactive?.session_count ?? 0}
            </div>
          </div>
          <div className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
            <div className="text-xs text-gray-500 mb-0.5">API Calls</div>
            <div className="text-xl font-bold font-mono">
              {summary?.totals.programmatic?.call_count ?? 0}
            </div>
          </div>
        </div>
        <div className="text-[10px] text-gray-600 mb-3 px-1">
          <span className="text-blue-400/70">API Equivalent</span> = value of tokens consumed via Max subscription at API rates ·{" "}
          <span className="text-amber-400/70">API Spend</span> = actual $ charged to API key
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 border-b border-gray-800 mb-3">
          {(["overview", "sessions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? "border-blue-500 text-gray-100"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab === "overview" ? "Overview" : "Sessions"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "overview" ? (
          <OverviewTab
            dailyData={dailyData}
            agentData={agentData}
            machineData={machineData}
            summary={summary}
          />
        ) : (
          <SessionsTab sessions={sessions} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({
  dailyData,
  agentData,
  machineData,
  summary,
}: {
  dailyData: DailyAggregate[];
  agentData: AgentAggregate[];
  machineData: MachineAggregate[];
  summary: SummaryResponse | null;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* Daily Cost Chart */}
      <div className="lg:col-span-2 bg-gray-900 rounded-lg border border-gray-800 px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-200">Daily Cost</h2>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />
              API Equivalent (subscription)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />
              API Spend (billed)
            </span>
          </div>
        </div>
        <CostBarChart data={dailyData} />
      </div>

      {/* Cost by Agent */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-200 mb-2">API Equivalent by Agent</h2>
        {agentData.length === 0 ? (
          <p className="text-gray-500 text-sm">No agent data.</p>
        ) : (
          <div className="space-y-1.5">
            {agentData.map((a) => {
              const maxCost = agentData[0]?.cost || 1;
              const pct = (a.cost / maxCost) * 100;
              return (
                <div key={a.agent}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className={AGENT_COLORS[a.agent] || "text-gray-300"}>
                      {a.agent}
                    </span>
                    <span className="font-mono text-gray-300">{fmtCost(a.cost)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500/60 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {a.sessions} sessions · {a.messages.toLocaleString()} msgs · {fmtTokens(a.tokens)} tok
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Daily Breakdown Table */}
      <div className="lg:col-span-2 bg-gray-900 rounded-lg border border-gray-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-200 mb-2">Daily Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left py-1 pr-3">Date</th>
                <th className="text-right py-1 px-2">
                  <span className="text-blue-400/70">Equivalent</span>
                </th>
                <th className="text-right py-1 px-2">
                  <span className="text-amber-400/70">API Spend</span>
                </th>
                <th className="text-right py-1 px-2">Tokens</th>
                <th className="text-right py-1 px-2">Sessions</th>
                <th className="text-right py-1 pl-2">Messages</th>
              </tr>
            </thead>
            <tbody>
              {dailyData.map((d) => (
                  <tr
                    key={d.day}
                    className="border-b border-gray-800/50 hover:bg-gray-800/40"
                  >
                    <td className="py-1 pr-3 font-mono text-gray-300">
                      {fmtDate(d.day)}
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-blue-400">
                      {fmtCost(d.interactive_cost)}
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-amber-400">
                      {d.programmatic_cost > 0 ? fmtCost(d.programmatic_cost) : "—"}
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-gray-400">
                      {fmtTokens(d.total_tokens)}
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-gray-400">
                      {d.sessions}
                    </td>
                    <td className="py-1 pl-2 text-right font-mono text-gray-400">
                      {d.messages.toLocaleString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cost by Machine */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-200 mb-2">API Equivalent by Machine</h2>
        {machineData.length === 0 ? (
          <p className="text-gray-500 text-sm">No machine data.</p>
        ) : (
          <div className="space-y-1.5">
            {machineData.map((m) => {
              const maxCost = machineData[0]?.cost || 1;
              const pct = (m.cost / maxCost) * 100;
              return (
                <div key={m.machine}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className={MACHINE_COLORS[m.machine] || "text-gray-300"}>
                      {m.machine}
                    </span>
                    <span className="font-mono text-gray-300">{fmtCost(m.cost)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500/60 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {m.sessions} sessions · {fmtTokens(m.tokens)} tok
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Programmatic Call Sources */}
        {summary && summary.programmatic_calls.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-gray-200 mt-4 mb-2">
              API Call Sources
            </h2>
            <div className="space-y-1">
              {(() => {
                const sourceMap = new Map<string, { cost: number; calls: number }>();
                for (const row of summary.programmatic_calls) {
                  const key = row.source;
                  const existing = sourceMap.get(key) || { cost: 0, calls: 0 };
                  existing.cost += row.cost_usd;
                  existing.calls += row.call_count;
                  sourceMap.set(key, existing);
                }
                return Array.from(sourceMap.entries())
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([source, data]) => (
                    <div
                      key={source}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-gray-400 font-mono truncate mr-2">
                        {source}
                      </span>
                      <span className="text-gray-300 font-mono whitespace-nowrap">
                        {fmtCost(data.cost)}{" "}
                        <span className="text-gray-500">({data.calls})</span>
                      </span>
                    </div>
                  ));
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions Tab
// ---------------------------------------------------------------------------

function SessionsTab({ sessions }: { sessions: SessionsResponse | null }) {
  if (!sessions || sessions.sessions.length === 0) {
    return <p className="text-gray-500 text-sm">No sessions found.</p>;
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-800">
              <th className="text-left py-1.5 px-3">Started</th>
              <th className="text-left py-1.5 px-2">Machine</th>
              <th className="text-left py-1.5 px-2">Agent</th>
              <th className="text-left py-1.5 px-2">Model</th>
              <th className="text-right py-1.5 px-2">Duration</th>
              <th className="text-right py-1.5 px-2">Messages</th>
              <th className="text-right py-1.5 px-2">Tokens</th>
              <th className="text-right py-1.5 px-2">API Equiv.</th>
              <th className="text-right py-1.5 px-3">Subagents</th>
            </tr>
          </thead>
          <tbody>
            {sessions.sessions.map((s) => {
              const totalTokens = s.input_tokens + s.output_tokens;

              return (
                <tr
                  key={s.session_id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/40"
                >
                  <td className="py-1.5 px-3 font-mono text-xs text-gray-300">
                    {fmtDateTime(s.started_at ?? s.ended_at)}
                  </td>
                  <td className="py-1.5 px-2">
                    <span
                      className={`text-xs ${MACHINE_COLORS[s.machine] || "text-gray-400"}`}
                    >
                      {s.machine}
                    </span>
                  </td>
                  <td className="py-1.5 px-2">
                    {s.agent_persona ? (
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          AGENT_BADGES[s.agent_persona] || "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {s.agent_persona}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-xs text-gray-400 font-mono max-w-[120px] truncate">
                    {s.model_primary || "—"}
                  </td>
                  <td className="py-1.5 px-2 text-right text-xs font-mono text-gray-400">
                    {fmtDuration(s.started_at, s.ended_at)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-xs font-mono text-gray-400">
                    {s.message_count}
                  </td>
                  <td className="py-1.5 px-2 text-right text-xs font-mono text-gray-400">
                    {fmtTokens(totalTokens)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-xs font-mono text-gray-100">
                    {fmtCost(s.cost_equivalent)}
                  </td>
                  <td className="py-1.5 px-3 text-right text-xs font-mono text-gray-500">
                    {s.subagent_count || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sessions.total > sessions.limit && (
        <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-800">
          Showing {sessions.sessions.length} of {sessions.total} sessions
        </div>
      )}
    </div>
  );
}
