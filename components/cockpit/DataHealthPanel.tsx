"use client";

import type { DataHealthResponse, DataHealthCheck } from "./types";
import { InfoTip } from "./CockpitTooltip";

function StatusIcon({ status }: { status: DataHealthCheck["status"] }) {
  const map = {
    ok: { icon: "✓", cls: "text-green-400" },
    stale: { icon: "⚠", cls: "text-amber-400" },
    error: { icon: "✗", cls: "text-red-400" },
  };
  const { icon, cls } = map[status] ?? map.error;
  return <span className={`${cls} text-xs font-bold`}>{icon}</span>;
}

function OverallBadge({ overall }: { overall: DataHealthResponse["overall"] }) {
  const map = {
    healthy: { label: "Healthy", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
    degraded: { label: "Degraded", cls: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    unhealthy: { label: "Unhealthy", cls: "bg-red-500/20 text-red-400 border-red-500/30" },
  };
  const { label, cls } = map[overall] ?? map.unhealthy;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

interface Props {
  health: DataHealthResponse | null;
  loading: boolean;
}

export function DataHealthPanel({ health, loading }: Props) {
  if (loading && !health) {
    return (
      <section className="rounded border border-gray-800 bg-gray-900 p-3">
        <div className="h-32 bg-gray-800 rounded animate-pulse flex items-center justify-center">
          <span className="text-xs text-gray-500">Loading health checks…</span>
        </div>
      </section>
    );
  }

  const checks = health?.checks ?? [];

  return (
    <section className="rounded border border-gray-800 bg-gray-900">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-300">
          Data Health & Pipeline
          <InfoTip tip="Pipeline status and data freshness. Green = healthy, Yellow = stale (>4 days, may be weekend), Red = error." />
        </div>
        {health && <OverallBadge overall={health.overall} />}
      </div>

      <div className="divide-y divide-gray-800/50">
        {checks.map((check, i) => (
          <div key={i} className="px-3 py-2 flex items-center gap-3">
            <StatusIcon status={check.status} />
            <span className="text-xs text-gray-200 font-medium w-28">{check.source}</span>
            <span className="text-xs text-gray-400 flex-1">{check.message}</span>
            {check.lastUpdate && (
              <span className="text-[10px] text-gray-500 hidden sm:inline">
                {new Date(check.lastUpdate).toLocaleDateString()}
              </span>
            )}
          </div>
        ))}
        {checks.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-500 text-center">
            No health check data available
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-gray-800/50 text-[10px] text-gray-500">
        Checks run on each page load. FRED allows 4-day staleness for weekends/holidays.
        Fleet status from GPU check-in system (5-min heartbeat).
      </div>
    </section>
  );
}
