import { useMemo, useCallback, useState } from "react";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";
import type { SessionsResponse } from "../_lib/types";
import { fmtCost, fmtTokens, fmtDateTime, fmtDuration, fmtOverhead, overheadColor } from "../_lib/formatters";
import { AGENT_BADGES, MACHINE_COLORS } from "../_lib/constants";

const SESSION_COLUMNS: ColumnDef[] = [
  { key: "date", label: "Date" },
  { key: "machine", label: "Machine" },
  { key: "agent", label: "Agent" },
  { key: "model", label: "Model" },
  { key: "input_tokens", label: "Input Tok" },
  { key: "output_tokens", label: "Output Tok" },
  { key: "cache_creation", label: "Cache Create" },
  { key: "overhead", label: "Overhead" },
  { key: "cost", label: "API Equiv" },
  { key: "duration", label: "Duration" },
  { key: "subagents", label: "Subagents" },
];
const SESSION_DEFAULTS = ["date", "machine", "agent", "model", "overhead", "cost", "input_tokens", "output_tokens"];
const SESSION_LOCKED = ["date"];

export function SessionsTab({ sessions }: { sessions: SessionsResponse | null }) {
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
  const savedCols = getVisibleColumns("aiUsageSessions");
  const visibleKeys = useMemo(() => savedCols ?? SESSION_DEFAULTS, [savedCols]);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const handleColsChange = useCallback(
    (keys: string[]) => setVisibleColumns("aiUsageSessions", keys),
    [setVisibleColumns],
  );

  const [machineFilter, setMachineFilter] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string>("");

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    return sessions.sessions.filter((s) => {
      if (machineFilter && s.machine !== machineFilter) return false;
      if (agentFilter && (s.agent_persona ?? "unknown") !== agentFilter) return false;
      return true;
    });
  }, [sessions, machineFilter, agentFilter]);

  // Extract unique machines and agents for filter dropdowns
  const machines = useMemo(() => {
    if (!sessions) return [];
    return [...new Set(sessions.sessions.map((s) => s.machine))].sort();
  }, [sessions]);

  const agents = useMemo(() => {
    if (!sessions) return [];
    return [...new Set(sessions.sessions.map((s) => s.agent_persona ?? "unknown"))].sort();
  }, [sessions]);

  if (!sessions || sessions.sessions.length === 0) {
    return <p className="text-gray-500 text-sm">No sessions found.</p>;
  }

  return (
    <div>
      {/* Filter row */}
      <div className="flex items-center gap-3 mb-2 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Machine</span>
          <select
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
          >
            <option value="">All</option>
            {machines.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Agent</span>
          <select
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="">All</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <div className="ml-auto">
          <ColumnChooser
            columns={SESSION_COLUMNS}
            visible={visibleKeys}
            defaults={SESSION_DEFAULTS}
            onChange={handleColsChange}
            locked={SESSION_LOCKED}
            size="sm"
          />
        </div>
      </div>

      <div className="bg-gray-900 rounded border border-gray-800">
        <div className="overflow-x-auto d-table-wrap" style={{ "--visible-cols": visibleKeys.length } as React.CSSProperties}>
          <table className="w-full text-sm d-table">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                {visibleSet.has("date") && <th className="text-left py-1.5 px-3">Date</th>}
                {visibleSet.has("machine") && <th className="text-left py-1.5 px-2">Machine</th>}
                {visibleSet.has("agent") && <th className="text-left py-1.5 px-2">Agent</th>}
                {visibleSet.has("model") && <th className="text-left py-1.5 px-2">Model</th>}
                {visibleSet.has("input_tokens") && <th className="text-right py-1.5 px-2">Input</th>}
                {visibleSet.has("output_tokens") && <th className="text-right py-1.5 px-2">Output</th>}
                {visibleSet.has("cache_creation") && <th className="text-right py-1.5 px-2">Cache Create</th>}
                {visibleSet.has("overhead") && <th className="text-right py-1.5 px-2">Overhead</th>}
                {visibleSet.has("cost") && <th className="text-right py-1.5 px-2">API Equiv</th>}
                {visibleSet.has("duration") && <th className="text-right py-1.5 px-2">Duration</th>}
                {visibleSet.has("subagents") && <th className="text-right py-1.5 px-3">Subagents</th>}
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((s) => {
                const ratio = s.overhead_ratio ?? 0;
                const isHighOverhead = ratio > 10 && s.cost_equivalent > 5;
                const rowClass = isHighOverhead
                  ? "border-l-2 border-red-500 bg-red-500/5"
                  : "border-l-2 border-transparent";

                return (
                  <tr
                    key={s.session_id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/40 ${rowClass}`}
                  >
                    {visibleSet.has("date") && (
                      <td className="py-1.5 px-3 font-mono text-xs text-gray-300">
                        {fmtDateTime(s.started_at ?? s.ended_at)}
                      </td>
                    )}
                    {visibleSet.has("machine") && (
                      <td className="py-1.5 px-2">
                        <span className={`text-xs ${MACHINE_COLORS[s.machine] || "text-gray-400"}`}>
                          {s.machine}
                        </span>
                      </td>
                    )}
                    {visibleSet.has("agent") && (
                      <td className="py-1.5 px-2">
                        {s.agent_persona ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${AGENT_BADGES[s.agent_persona] || "bg-gray-700 text-gray-300"}`}>
                            {s.agent_persona}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">{"\u2014"}</span>
                        )}
                      </td>
                    )}
                    {visibleSet.has("model") && (
                      <td className="py-1.5 px-2 text-xs text-gray-400 font-mono max-w-[120px] truncate">
                        {s.model_primary || "\u2014"}
                      </td>
                    )}
                    {visibleSet.has("input_tokens") && (
                      <td className="py-1.5 px-2 text-right text-xs font-mono text-gray-400">
                        {fmtTokens(s.input_tokens)}
                      </td>
                    )}
                    {visibleSet.has("output_tokens") && (
                      <td className="py-1.5 px-2 text-right text-xs font-mono text-gray-400">
                        {fmtTokens(s.output_tokens)}
                      </td>
                    )}
                    {visibleSet.has("cache_creation") && (
                      <td className="py-1.5 px-2 text-right text-xs font-mono text-gray-400">
                        {fmtTokens(s.cache_creation_tokens)}
                      </td>
                    )}
                    {visibleSet.has("overhead") && (
                      <td className={`py-1.5 px-2 text-right text-xs font-mono ${overheadColor(ratio)}`}>
                        {fmtOverhead(ratio)}
                      </td>
                    )}
                    {visibleSet.has("cost") && (
                      <td className="py-1.5 px-2 text-right text-xs font-mono text-blue-400">
                        {fmtCost(s.cost_equivalent)}
                      </td>
                    )}
                    {visibleSet.has("duration") && (
                      <td className="py-1.5 px-2 text-right text-xs font-mono text-gray-400">
                        {fmtDuration(s.started_at, s.ended_at)}
                      </td>
                    )}
                    {visibleSet.has("subagents") && (
                      <td className="py-1.5 px-3 text-right text-xs font-mono text-gray-500">
                        {s.subagent_count || "\u2014"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sessions.total > sessions.limit && (
          <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-800">
            Showing {filteredSessions.length} of {sessions.total} sessions
          </div>
        )}
      </div>
    </div>
  );
}
