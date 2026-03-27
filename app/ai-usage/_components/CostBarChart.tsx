import type { DailyAggregate } from "../_lib/types";
import { fmtCost, fmtDate } from "../_lib/formatters";

export function CostBarChart({ data }: { data: DailyAggregate[] }) {
  if (!data.length) return <p className="text-gray-500 text-sm">No data available.</p>;

  // Fill gaps so x-axis is continuous
  const sorted = [...data].sort((a, b) => new Date(a.day).getTime() - new Date(b.day).getTime());
  const filled: DailyAggregate[] = [];
  if (sorted.length > 0) {
    const start = new Date(sorted[0].day);
    const end = new Date(sorted[sorted.length - 1].day);
    const dayMap = new Map(sorted.map((d) => [d.day, d]));
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().split("T")[0];
      filled.push(
        dayMap.get(iso) ?? {
          day: iso,
          interactive_cost: 0,
          programmatic_cost: 0,
          total_tokens: 0,
          sessions: 0,
          calls: 0,
          overhead_ratio: 0,
          cache_creation: 0,
        }
      );
    }
  }

  const sliced = filled.slice(-14);
  const maxCost = Math.max(...sliced.map((d) => d.interactive_cost + d.programmatic_cost), 0.01);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-200">Daily Cost</h2>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />
            Sub Equiv
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />
            API Spend
          </span>
        </div>
      </div>
      <div className="flex items-end gap-1 h-28">
        {sliced.map((d) => {
          const total = d.interactive_cost + d.programmatic_cost;
          const pct = (total / maxCost) * 100;
          const interPct = total > 0 ? (d.interactive_cost / total) * pct : 0;
          const progPct = pct - interPct;

          return (
            <div
              key={d.day}
              className="flex-1 flex flex-col items-center gap-0.5 min-w-0"
              title={`${fmtDate(d.day)}: ${fmtCost(total)} (${d.sessions}s / ${d.calls}c)`}
            >
              <div className="w-full flex flex-col justify-end" style={{ height: "96px" }}>
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
    </div>
  );
}
