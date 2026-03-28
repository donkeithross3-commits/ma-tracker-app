import { useMemo, useCallback } from "react";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";
import type { DailyAggregate, SummaryResponse, EfficiencyResponse, SessionsResponse } from "../_lib/types";
import { fmtCost, fmtTokens, fmtDate, fmtOverhead, overheadColor } from "../_lib/formatters";
import { AGENT_COLORS, MACHINE_COLORS } from "../_lib/constants";
import { Last24Hours } from "./Last24Hours";
import { MachineAgentMatrix } from "./MachineAgentMatrix";

// Column definitions (module-level to avoid infinite loops)
const DAILY_COLUMNS: ColumnDef[] = [
  { key: "date", label: "Date" },
  { key: "sub_equiv", label: "Sub Equiv" },
  { key: "api_spend", label: "API Spend" },
  { key: "tokens", label: "Tokens" },
  { key: "sessions", label: "Sessions" },
  { key: "overhead", label: "Overhead" },
];
const DAILY_DEFAULTS = DAILY_COLUMNS.map((c) => c.key);
const DAILY_LOCKED = ["date"];

export function OverviewTab({
  dailyData,
  summary,
  sessions,
  efficiency,
}: {
  dailyData: DailyAggregate[];
  summary: SummaryResponse | null;
  sessions: SessionsResponse | null;
  efficiency: EfficiencyResponse | null;
}) {
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
  const savedCols = getVisibleColumns("aiUsageDaily");
  const visibleKeys = useMemo(() => savedCols ?? DAILY_DEFAULTS, [savedCols]);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const handleColsChange = useCallback(
    (keys: string[]) => setVisibleColumns("aiUsageDaily", keys),
    [setVisibleColumns],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* Last 24 Hours */}
      <div className="lg:col-span-2 bg-gray-900 rounded border border-gray-800 px-3 py-2">
        <Last24Hours sessions={sessions?.sessions ?? null} />
      </div>

      {/* Matrix */}
      <div className="bg-gray-900 rounded border border-gray-800 px-3 py-2">
        <MachineAgentMatrix matrix={efficiency?.machine_agent_matrix} />
      </div>

      {/* Daily Breakdown Table */}
      <div className="lg:col-span-2 bg-gray-900 rounded border border-gray-800 px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-200">Daily Breakdown</h2>
          <ColumnChooser
            columns={DAILY_COLUMNS}
            visible={visibleKeys}
            defaults={DAILY_DEFAULTS}
            onChange={handleColsChange}
            locked={DAILY_LOCKED}
            size="sm"
          />
        </div>
        <div className="overflow-x-auto d-table-wrap" style={{ "--visible-cols": visibleKeys.length } as React.CSSProperties}>
          <table className="w-full text-sm d-table">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                {visibleSet.has("date") && <th className="text-left py-1 pr-3">Date</th>}
                {visibleSet.has("sub_equiv") && <th className="text-right py-1 px-2"><span className="text-blue-400/70">Sub Equiv</span></th>}
                {visibleSet.has("api_spend") && <th className="text-right py-1 px-2"><span className="text-amber-400/70">API Spend</span></th>}
                {visibleSet.has("tokens") && <th className="text-right py-1 px-2">Tokens</th>}
                {visibleSet.has("sessions") && <th className="text-right py-1 px-2">Sessions</th>}
                {visibleSet.has("overhead") && <th className="text-right py-1 pl-2">Overhead</th>}
              </tr>
            </thead>
            <tbody>
              {dailyData.map((d) => (
                <tr key={d.day} className="border-b border-gray-800/50 hover:bg-gray-800/40">
                  {visibleSet.has("date") && <td className="py-1 pr-3 font-mono text-gray-300">{fmtDate(d.day)}</td>}
                  {visibleSet.has("sub_equiv") && <td className="py-1 px-2 text-right font-mono text-blue-400">{fmtCost(d.interactive_cost)}</td>}
                  {visibleSet.has("api_spend") && <td className="py-1 px-2 text-right font-mono text-amber-400">{d.programmatic_cost > 0 ? fmtCost(d.programmatic_cost) : "\u2014"}</td>}
                  {visibleSet.has("tokens") && <td className="py-1 px-2 text-right font-mono text-gray-400">{fmtTokens(d.total_tokens)}</td>}
                  {visibleSet.has("sessions") && <td className="py-1 px-2 text-right font-mono text-gray-400">{d.sessions}</td>}
                  {visibleSet.has("overhead") && <td className={`py-1 pl-2 text-right font-mono ${overheadColor(d.overhead_ratio)}`}>{fmtOverhead(d.overhead_ratio)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Consumers */}
      <div className="bg-gray-900 rounded border border-gray-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-200 mb-2">Top Consumers</h2>
        {efficiency?.per_agent && efficiency.per_agent.length > 0 ? (
          <div className="space-y-1.5">
            {efficiency.per_agent.slice(0, 8).map((a) => {
              const maxCost = efficiency.per_agent[0]?.total_cost || 1;
              const pct = (a.total_cost / maxCost) * 100;
              return (
                <div key={`${a.agent}:${a.machine}`}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className={AGENT_COLORS[a.agent] || "text-gray-300"}>{a.agent}</span>
                      <span className={`text-[10px] ${MACHINE_COLORS[a.machine] || "text-gray-500"}`}>{a.machine}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`font-mono text-[10px] ${overheadColor(a.avg_overhead_ratio)}`}>
                        {fmtOverhead(a.avg_overhead_ratio)}
                      </span>
                      <span className="font-mono text-gray-300">{fmtCost(a.total_cost)}</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${a.is_inefficient ? "bg-red-500/60" : "bg-blue-500/60"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {a.sessions} session{a.sessions !== 1 ? "s" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No agent data.</p>
        )}

        {/* API Call Sources */}
        {summary && summary.programmatic_calls.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-gray-200 mt-4 mb-2">API Call Sources</h2>
            <div className="space-y-1">
              {(() => {
                const sourceMap = new Map<string, { cost: number; calls: number }>();
                for (const row of summary.programmatic_calls) {
                  const existing = sourceMap.get(row.source) || { cost: 0, calls: 0 };
                  existing.cost += row.cost_usd;
                  existing.calls += row.call_count;
                  sourceMap.set(row.source, existing);
                }
                return Array.from(sourceMap.entries())
                  .sort((a, b) => b[1].calls - a[1].calls)
                  .map(([source, data]) => (
                    <div key={source} className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 font-mono truncate mr-2">{source}</span>
                      <span className="text-gray-300 font-mono whitespace-nowrap">
                        {fmtCost(data.cost)} <span className="text-gray-500">({data.calls})</span>
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
