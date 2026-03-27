import type { SummaryResponse, DailyAggregate, AgentAggregate, MachineAggregate } from "./types";

export function aggregateByDay(summary: SummaryResponse | null): DailyAggregate[] {
  if (!summary) return [];
  const map = new Map<string, DailyAggregate>();

  const getOrCreate = (day: string): DailyAggregate => {
    let agg = map.get(day);
    if (!agg) {
      agg = { day, interactive_cost: 0, programmatic_cost: 0, total_tokens: 0, sessions: 0, calls: 0, overhead_ratio: 0, cache_creation: 0 };
      map.set(day, agg);
    }
    return agg;
  };

  for (const row of summary.interactive_sessions) {
    const agg = getOrCreate(row.day);
    agg.interactive_cost += row.cost_equivalent;
    agg.total_tokens += row.input_tokens + row.output_tokens;
    agg.sessions += row.session_count;
    agg.cache_creation += row.cache_creation_tokens;
  }

  for (const row of summary.programmatic_calls) {
    const agg = getOrCreate(row.day);
    agg.programmatic_cost += row.cost_usd;
    agg.total_tokens += row.input_tokens + row.output_tokens;
    agg.calls += row.call_count;
  }

  // Compute overhead ratio per day
  const result = Array.from(map.values());
  for (const agg of result) {
    if (agg.total_tokens > 0) {
      agg.overhead_ratio = agg.cache_creation / agg.total_tokens;
    }
  }

  return result.sort((a, b) => new Date(b.day).getTime() - new Date(a.day).getTime());
}

export function aggregateByAgent(summary: SummaryResponse | null): AgentAggregate[] {
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

export function aggregateByMachine(summary: SummaryResponse | null): MachineAggregate[] {
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
