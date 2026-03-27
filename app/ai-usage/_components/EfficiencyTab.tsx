import type { EfficiencyResponse, SummaryResponse, QuotaBudget } from "../_lib/types";
import { fmtCost, fmtTokens, fmtDate, fmtOverhead, overheadColor } from "../_lib/formatters";
import { AGENT_COLORS, MACHINE_COLORS } from "../_lib/constants";

function OverheadBar({ ratio, maxRatio }: { ratio: number; maxRatio: number }) {
  const pct = maxRatio > 0 ? Math.min((ratio / maxRatio) * 100, 100) : 0;
  const color = ratio > 10 ? "bg-red-500/60" : ratio > 3 ? "bg-amber-500/60" : "bg-emerald-500/60";
  return (
    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden flex-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function BudgetBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 text-gray-400 truncate">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right font-mono text-gray-300">{fmtCost(value)}</span>
      <span className="w-6 text-right font-mono text-gray-500">{pct.toFixed(0)}%</span>
    </div>
  );
}

export function EfficiencyTab({
  efficiency,
  summary,
  quotaBudget,
}: {
  efficiency: EfficiencyResponse | null;
  summary: SummaryResponse | null;
  quotaBudget: QuotaBudget | null;
}) {
  if (!efficiency) return <p className="text-gray-500 text-sm">Loading efficiency data...</p>;

  const maxOverhead = Math.max(...(efficiency.per_agent.map((a) => a.avg_overhead_ratio) || [1]), 1);

  return (
    <div className="space-y-3">
      {/* Per-agent overhead ratios */}
      <div className="bg-gray-900 rounded border border-gray-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-200 mb-2">Subscription Efficiency by Agent</h2>
        <div className="text-[10px] text-gray-500 mb-2">
          Overhead ratio = cache_creation_tokens / (input + output). Lower is better.
          <span className="text-emerald-400"> ≤3 good</span> ·
          <span className="text-amber-400"> 3-10 watch</span> ·
          <span className="text-red-400"> &gt;10 migrate to API</span>
        </div>
        {efficiency.per_agent.length === 0 ? (
          <p className="text-gray-500 text-sm">No agent data.</p>
        ) : (
          <div className="space-y-2">
            {efficiency.per_agent.map((a) => (
              <div key={`${a.agent}:${a.machine}`} className="flex items-center gap-2 text-xs">
                <span className={`w-24 truncate ${AGENT_COLORS[a.agent] || "text-gray-400"}`}>{a.agent}</span>
                <span className={`w-14 text-[10px] ${MACHINE_COLORS[a.machine] || "text-gray-500"}`}>{a.machine}</span>
                <OverheadBar ratio={a.avg_overhead_ratio} maxRatio={maxOverhead} />
                <span className={`w-12 text-right font-mono ${overheadColor(a.avg_overhead_ratio)}`}>
                  {fmtOverhead(a.avg_overhead_ratio)}
                </span>
                <span className="w-16 text-right font-mono text-gray-400">{fmtCost(a.total_cost)}</span>
                <span className="w-10 text-right text-gray-500">{a.sessions}s</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Budget Allocation */}
      {quotaBudget && (
        <div className="bg-gray-900 rounded border border-gray-800 px-3 py-2">
          <h2 className="text-sm font-semibold text-gray-200 mb-2">Budget Allocation</h2>
          <div className="text-[10px] text-gray-500 mb-2">
            Weekly quota split: {((quotaBudget.automated_budget.reserved_for_interactive) * 100).toFixed(0)}% reserved for interactive, {((1 - quotaBudget.automated_budget.reserved_for_interactive) * 100).toFixed(0)}% for automated workloads.
            Resets {new Date(quotaBudget.budget.weekly_resets_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ({quotaBudget.budget.hours_until_reset.toFixed(0)}h).
          </div>
          <div className="space-y-1.5">
            <BudgetBar
              label="Weekly Used"
              value={quotaBudget.budget.weekly_used}
              max={quotaBudget.budget.weekly_limit_equiv}
              color={quotaBudget.budget.weekly_pct >= 80 ? "bg-red-500/70" : quotaBudget.budget.weekly_pct >= 60 ? "bg-amber-500/70" : "bg-blue-500/70"}
            />
            <BudgetBar
              label="Weekly Remaining"
              value={quotaBudget.budget.weekly_remaining}
              max={quotaBudget.budget.weekly_limit_equiv}
              color="bg-emerald-500/70"
            />
            <BudgetBar
              label="Auto Daily Used"
              value={quotaBudget.automated_budget.daily_used}
              max={quotaBudget.automated_budget.daily_cap_equiv}
              color={quotaBudget.automated_budget.daily_remaining <= quotaBudget.automated_budget.daily_cap_equiv * 0.2 ? "bg-red-500/70" : "bg-cyan-500/70"}
            />
            <BudgetBar
              label="Auto Daily Remaining"
              value={quotaBudget.automated_budget.daily_remaining}
              max={quotaBudget.automated_budget.daily_cap_equiv}
              color="bg-emerald-500/70"
            />
          </div>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-500">
            <span>
              Pace: <span className="font-mono text-gray-300">{fmtCost(quotaBudget.pace.current_hourly_rate)}/hr</span>
              {" "}(sustainable: <span className="font-mono text-gray-300">{fmtCost(quotaBudget.pace.sustainable_hourly_rate)}/hr</span>)
            </span>
            <span>
              Throttle: <span className={`font-mono ${quotaBudget.pace.throttle_factor < 1 ? "text-red-400" : "text-emerald-400"}`}>
                {quotaBudget.pace.throttle_factor.toFixed(2)}x
              </span>
            </span>
            <span>
              Delay: <span className="font-mono text-gray-300">{quotaBudget.recommended_delay_sec}s</span>
            </span>
            {!quotaBudget.can_proceed && (
              <span className="text-red-400 font-medium bg-red-500/15 px-1.5 py-0.5 rounded">
                AUTOMATED WORK BLOCKED
              </span>
            )}
          </div>
        </div>
      )}

      {/* API cost per call */}
      {summary && summary.programmatic_calls.length > 0 && (
        <div className="bg-gray-900 rounded border border-gray-800 px-3 py-2">
          <h2 className="text-sm font-semibold text-gray-200 mb-2">API Cost per Call by Source</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-1 pr-3">Source</th>
                <th className="text-right py-1 px-2">Calls</th>
                <th className="text-right py-1 px-2">Total Cost</th>
                <th className="text-right py-1 pl-2">Avg/Call</th>
              </tr>
            </thead>
            <tbody>
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
                    <tr key={source} className="border-b border-gray-800/50 hover:bg-gray-800/40">
                      <td className="py-1 pr-3 font-mono text-gray-300">{source}</td>
                      <td className="py-1 px-2 text-right font-mono text-gray-400">{data.calls}</td>
                      <td className="py-1 px-2 text-right font-mono text-amber-400">{fmtCost(data.cost)}</td>
                      <td className="py-1 pl-2 text-right font-mono text-gray-400">
                        {data.calls > 0 ? fmtCost(data.cost / data.calls) : "\u2014"}
                      </td>
                    </tr>
                  ));
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Worst offenders */}
      <div className="bg-gray-900 rounded border border-gray-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-200 mb-2">
          Highest Overhead Sessions
        </h2>
        {efficiency.per_session.length === 0 ? (
          <p className="text-gray-500 text-sm">No sessions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-1 pr-2">Date</th>
                  <th className="text-left py-1 px-2">Machine</th>
                  <th className="text-left py-1 px-2">Agent</th>
                  <th className="text-right py-1 px-2">Overhead</th>
                  <th className="text-right py-1 px-2">Cost</th>
                  <th className="text-right py-1 px-2">Cache Create</th>
                  <th className="text-right py-1 pl-2">Useful Tok</th>
                </tr>
              </thead>
              <tbody>
                {efficiency.per_session
                  .filter((s) => s.overhead_ratio > 0)
                  .sort((a, b) => b.overhead_ratio - a.overhead_ratio)
                  .slice(0, 20)
                  .map((s, i) => (
                    <tr
                      key={`${s.session_id}-${i}`}
                      className={`border-b border-gray-800/50 hover:bg-gray-800/40 ${
                        s.is_inefficient ? "border-l-2 border-red-500 bg-red-500/5" : ""
                      }`}
                    >
                      <td className="py-1 pr-2 font-mono text-gray-300">{fmtDate(s.day)}</td>
                      <td className={`py-1 px-2 ${MACHINE_COLORS[s.machine] || "text-gray-400"}`}>{s.machine}</td>
                      <td className={`py-1 px-2 ${AGENT_COLORS[s.agent_persona] || "text-gray-400"}`}>{s.agent_persona}</td>
                      <td className={`py-1 px-2 text-right font-mono ${overheadColor(s.overhead_ratio)}`}>
                        {fmtOverhead(s.overhead_ratio)}
                      </td>
                      <td className="py-1 px-2 text-right font-mono text-blue-400">{fmtCost(s.cost_equivalent)}</td>
                      <td className="py-1 px-2 text-right font-mono text-gray-400">{fmtTokens(s.cache_creation_tokens)}</td>
                      <td className="py-1 pl-2 text-right font-mono text-gray-400">
                        {fmtTokens(s.input_tokens + s.output_tokens)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
