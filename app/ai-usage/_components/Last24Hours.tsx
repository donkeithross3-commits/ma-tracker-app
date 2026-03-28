import { useMemo } from "react";
import type { SessionRow } from "../_lib/types";
import { fmtCost, fmtTokens, fmtDuration, fmtOverhead, overheadColor } from "../_lib/formatters";
import { AGENT_BADGES, AGENT_COLORS, MACHINE_COLORS } from "../_lib/constants";

/** One hour bucket for the heatmap. */
type HourBucket = {
  hour: number; // 0-23
  label: string; // "8a", "2p", etc.
  cost: number;
  sessions: number;
  tokens: number;
};

function buildHourBuckets(sessions: SessionRow[]): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, i) => {
    const h = i % 12 || 12;
    const suffix = i < 12 ? "a" : "p";
    return { hour: i, label: `${h}${suffix}`, cost: 0, sessions: 0, tokens: 0 };
  });

  for (const s of sessions) {
    const ts = s.started_at ?? s.ended_at;
    if (!ts) continue;
    const d = new Date(ts);
    const hour = d.getHours();
    buckets[hour].cost += s.cost_equivalent;
    buckets[hour].sessions += 1;
    buckets[hour].tokens += s.input_tokens + s.output_tokens;
  }

  return buckets;
}

function heatColor(cost: number, maxCost: number): string {
  if (cost === 0) return "bg-gray-800/50";
  const ratio = cost / Math.max(maxCost, 1);
  if (ratio > 0.7) return "bg-red-500/80";
  if (ratio > 0.4) return "bg-amber-500/70";
  if (ratio > 0.15) return "bg-blue-500/60";
  return "bg-blue-500/30";
}

export function Last24Hours({ sessions }: { sessions: SessionRow[] | null }) {
  // Filter to last 24 hours
  const recentSessions = useMemo(() => {
    if (!sessions) return [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return sessions
      .filter((s) => {
        const ts = s.started_at ?? s.ended_at;
        return ts && new Date(ts).getTime() >= cutoff;
      })
      .sort((a, b) => {
        const ta = new Date(b.started_at ?? b.ended_at ?? 0).getTime();
        const tb = new Date(a.started_at ?? a.ended_at ?? 0).getTime();
        return ta - tb; // newest first
      });
  }, [sessions]);

  const hourBuckets = useMemo(() => buildHourBuckets(recentSessions), [recentSessions]);
  const maxHourlyCost = useMemo(() => Math.max(...hourBuckets.map((b) => b.cost), 0.01), [hourBuckets]);
  const totalCost = useMemo(() => recentSessions.reduce((sum, s) => sum + s.cost_equivalent, 0), [recentSessions]);
  const totalTokens = useMemo(
    () => recentSessions.reduce((sum, s) => sum + s.input_tokens + s.output_tokens, 0),
    [recentSessions],
  );

  // Current hour for highlighting
  const nowHour = new Date().getHours();

  if (!sessions || sessions.length === 0) {
    return <p className="text-gray-500 text-sm">No session data available.</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-200">Last 24 Hours</h2>
        <div className="flex items-center gap-3 text-[10px] text-gray-400">
          <span>
            <span className="font-mono text-blue-400">{fmtCost(totalCost)}</span> equiv
          </span>
          <span>
            <span className="font-mono">{fmtTokens(totalTokens)}</span> tokens
          </span>
          <span>
            <span className="font-mono">{recentSessions.length}</span> sessions
          </span>
        </div>
      </div>

      {/* Hourly heatmap */}
      <div className="mb-3">
        <div className="flex gap-px">
          {hourBuckets.map((b) => (
            <div
              key={b.hour}
              className={`flex-1 min-w-0 rounded-sm ${heatColor(b.cost, maxHourlyCost)} ${
                b.hour === nowHour ? "ring-1 ring-blue-400/60" : ""
              }`}
              title={`${b.label}: ${fmtCost(b.cost)} (${b.sessions} sessions, ${fmtTokens(b.tokens)} tokens)`}
              style={{ height: "20px" }}
            />
          ))}
        </div>
        <div className="flex mt-0.5">
          {hourBuckets.map((b) => (
            <span
              key={b.hour}
              className={`flex-1 min-w-0 text-center text-[8px] font-mono ${
                b.hour === nowHour ? "text-blue-400" : b.hour % 3 === 0 ? "text-gray-500" : "text-transparent"
              }`}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* Session list */}
      {recentSessions.length === 0 ? (
        <p className="text-gray-500 text-xs">No sessions in the last 24 hours.</p>
      ) : (
        <div className="space-y-0">
          {recentSessions.map((s) => {
            const ts = s.started_at ?? s.ended_at;
            const time = ts
              ? new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
              : "—";
            const ratio = s.overhead_ratio ?? 0;
            const isHighOverhead = ratio > 10 && s.cost_equivalent > 5;

            return (
              <div
                key={s.session_id}
                className={`flex items-center gap-2 py-1 px-1.5 text-xs border-b border-gray-800/40 hover:bg-gray-800/30 ${
                  isHighOverhead ? "border-l-2 border-l-red-500 bg-red-500/5" : ""
                }`}
              >
                {/* Time */}
                <span className="w-14 text-gray-400 font-mono text-[11px] shrink-0">{time}</span>

                {/* Agent badge */}
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
                    AGENT_BADGES[s.agent_persona ?? "unknown"] || "bg-gray-700 text-gray-300"
                  }`}
                >
                  {s.agent_persona ?? "unknown"}
                </span>

                {/* Machine */}
                <span
                  className={`text-[10px] w-14 shrink-0 ${MACHINE_COLORS[s.machine] || "text-gray-500"}`}
                >
                  {s.machine}
                </span>

                {/* Cost bar — inline proportional bar */}
                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isHighOverhead ? "bg-red-500/60" : "bg-blue-500/50"}`}
                      style={{
                        width: `${Math.min((s.cost_equivalent / Math.max(recentSessions[0]?.cost_equivalent || 1, 1)) * 100, 100)}%`,
                        minWidth: s.cost_equivalent > 0 ? "2px" : "0",
                      }}
                    />
                  </div>
                </div>

                {/* Overhead */}
                <span className={`w-10 text-right font-mono text-[10px] shrink-0 ${overheadColor(ratio)}`}>
                  {fmtOverhead(ratio)}
                </span>

                {/* Tokens */}
                <span className="w-12 text-right font-mono text-[10px] text-gray-400 shrink-0">
                  {fmtTokens(s.input_tokens + s.output_tokens)}
                </span>

                {/* Duration */}
                <span className="w-10 text-right font-mono text-[10px] text-gray-500 shrink-0">
                  {fmtDuration(s.started_at, s.ended_at)}
                </span>

                {/* Cost */}
                <span className="w-16 text-right font-mono text-[11px] text-blue-400 shrink-0">
                  {fmtCost(s.cost_equivalent)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
