"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type MachineBucket = {
  attainment_pct: number;
  coverage_pct: number;
  observed_avg_util_pct: number;
  achieved_gpu_hours: number;
  possible_gpu_hours: number;
  samples: number;
};

type WindowBucket = {
  label?: string;
  complete?: boolean;
  start: string;
  end: string;
  hours: number;
  fleet_attainment_pct: number;
  fleet_coverage_pct: number;
  achieved_gpu_hours: number;
  possible_gpu_hours: number;
  machines: Record<string, MachineBucket>;
};

type UtilizationResponse = {
  as_of: string;
  timezone: string;
  machines: string[];
  settings: {
    daily_days: number;
    weekly_weeks: number;
    carry_max_seconds: number;
  };
  trailing: {
    day: WindowBucket;
    week: WindowBucket;
  };
  daily: WindowBucket[];
  weekly: WindowBucket[];
};

type StatusMachine = {
  machine: string;
  age_seconds?: number | null;
  gpu?: {
    util?: number;
    temp?: number;
    mem_used_mb?: number;
    mem_total_mb?: number;
    power_w?: number;
  };
  heartbeats?: Record<string, { state?: string; current_job?: string; timestamp?: string }>;
  queues?: Record<string, { jobs?: Array<{ status?: string; name?: string }> }>;
};

type StatusResponse = {
  machines: StatusMachine[];
};

function fmtPct(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return "--";
  return `${v.toFixed(1)}%`;
}

function fmtHours(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return "--";
  return `${v.toFixed(1)}h`;
}

function fmtAge(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "--";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function ageClass(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "text-gray-500";
  if (seconds <= 300) return "text-gray-400";
  if (seconds <= 600) return "text-amber-300";
  return "text-red-300";
}

function parseIsoMillis(raw?: string): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function machineRunState(machine: StatusMachine): string {
  const heartbeats = machine.heartbeats || {};
  let hasPolling = false;
  let newestRunningTs = -1;
  let runningLabel: string | null = null;

  for (const hb of Object.values(heartbeats)) {
    if (hb?.state === "running") {
      const ts = parseIsoMillis(hb.timestamp);
      if (runningLabel === null || (ts != null && ts >= newestRunningTs)) {
        runningLabel = hb.current_job || "running";
        newestRunningTs = ts ?? newestRunningTs;
      }
    }
    if (hb?.state === "polling") hasPolling = true;
  }

  if (runningLabel) return runningLabel;

  const queues = machine.queues || {};
  for (const qs of Object.values(queues)) {
    const jobs = qs?.jobs || [];
    const running = jobs.find((j) => j?.status === "running");
    if (running) return running.name || "running";
  }

  if (hasPolling) return "polling";

  return "unknown";
}

export default function FleetUtilizationPage() {
  const [util, setUtil] = useState<UtilizationResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshAt, setRefreshAt] = useState<string>("");

  const fetchData = useCallback(async () => {
    try {
      const [utilRes, statusRes] = await Promise.all([
        fetch("/api/fleet/utilization?daily_days=14&weekly_weeks=8", { cache: "no-store" }),
        fetch("/api/fleet/status", { cache: "no-store" }),
      ]);

      if (!utilRes.ok) {
        throw new Error(`utilization API ${utilRes.status}`);
      }
      if (!statusRes.ok) {
        throw new Error(`status API ${statusRes.status}`);
      }

      const utilJson = (await utilRes.json()) as UtilizationResponse;
      const statusJson = (await statusRes.json()) as StatusResponse;
      setUtil(utilJson);
      setStatus(statusJson);
      setRefreshAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load fleet utilization";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const statusByMachine = useMemo(() => {
    const map = new Map<string, StatusMachine>();
    for (const row of status?.machines || []) {
      map.set(row.machine, row);
    }
    return map;
  }, [status]);

  const dailyRows = useMemo(() => {
    if (!util) return [];
    return [...util.daily].sort((a, b) => {
      const ta = Date.parse(a.start);
      const tb = Date.parse(b.start);
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return String(b.label || "").localeCompare(String(a.label || ""));
      return tb - ta;
    });
  }, [util]);

  const weeklyRows = useMemo(() => {
    if (!util) return [];
    return [...util.weekly].sort((a, b) => {
      const ta = Date.parse(a.start);
      const tb = Date.parse(b.start);
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return String(b.label || "").localeCompare(String(a.label || ""));
      return tb - ta;
    });
  }, [util]);

  const machineSpeed = useMemo(() => {
    if (!util) return [];
    return util.machines.map((machine) => {
      const row = statusByMachine.get(machine);
      const rawUtil = typeof row?.gpu?.util === "number" ? row.gpu.util : 0;
      const powerW = typeof row?.gpu?.power_w === "number" ? row.gpu.power_w : null;
      // WDDM workaround: nvidia-smi reports 0% util even during active compute.
      // Power draw is the reliable signal: idle ~20-30W, active training 100-350W.
      // If util is 0 but power > 50W, estimate 80% effective utilization.
      let utilPct = Math.max(0, Math.min(100, rawUtil));
      const powerActive = powerW !== null && powerW >= 50;
      if (utilPct === 0 && powerActive) {
        utilPct = 80;
      }
      return {
        machine,
        utilPct,
        powerW,
        powerActive,
        state: machineRunState(row || { machine }),
      };
    });
  }, [util, statusByMachine]);

  const fleetSpeedPct = useMemo(() => {
    if (machineSpeed.length === 0) return 0;
    const total = machineSpeed.reduce((sum, row) => sum + row.utilPct, 0);
    return Math.max(0, Math.min(100, total / machineSpeed.length));
  }, [machineSpeed]);

  const speedNeedleDeg = -120 + (fleetSpeedPct / 100) * 240;
  const speedRpm = Math.round(1000 + fleetSpeedPct * 80);
  const speedMph = Math.round(35 + fleetSpeedPct * 2.1);
  const ringCircumference = 2 * Math.PI * 74;
  const ringOffset = ringCircumference * (1 - fleetSpeedPct / 100);

  if (loading && !util) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
        <div className="max-w-7xl mx-auto">Loading fleet utilization...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Fleet Utilization Dashboard</h1>
            <p className="text-xs text-gray-500">
              Daily/weekly attainment vs theoretical 100% GPU-time
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded hover:bg-gray-800 transition-colors"
            >
              Home
            </Link>
            <button
              onClick={fetchData}
              className="text-sm px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5 space-y-4">
        {error && (
          <div className="rounded border border-red-600/40 bg-red-950/40 text-red-300 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {util && (
          <>
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded border border-gray-800 bg-gray-900 p-3">
                <div className="text-xs text-gray-500">Trailing 24h Attainment</div>
                <div className="text-2xl font-semibold text-cyan-300">
                  {fmtPct(util.trailing.day.fleet_attainment_pct)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {fmtHours(util.trailing.day.achieved_gpu_hours)} / {fmtHours(util.trailing.day.possible_gpu_hours)}
                </div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-900 p-3">
                <div className="text-xs text-gray-500">Trailing 7d Attainment</div>
                <div className="text-2xl font-semibold text-emerald-300">
                  {fmtPct(util.trailing.week.fleet_attainment_pct)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {fmtHours(util.trailing.week.achieved_gpu_hours)} / {fmtHours(util.trailing.week.possible_gpu_hours)}
                </div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-900 p-3">
                <div className="text-xs text-gray-500">Telemetry Coverage (24h)</div>
                <div className="text-2xl font-semibold text-amber-300">
                  {fmtPct(util.trailing.day.fleet_coverage_pct)}
                </div>
                <div className="text-xs text-gray-500 mt-1">carry max {util.settings.carry_max_seconds}s</div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-900 p-3">
                <div className="text-xs text-gray-500">As Of</div>
                <div className="text-sm font-medium text-gray-200 mt-1">
                  {new Date(util.as_of).toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  TZ {util.timezone} · refreshed {refreshAt ? new Date(refreshAt).toLocaleTimeString() : "--"}
                </div>
              </div>
            </section>

            <section className="rounded border border-gray-800 bg-gray-900">
              <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300">
                Live Machine Snapshot
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-3 py-2">Machine</th>
                      <th className="text-right px-3 py-2">GPU Util / Power</th>
                      <th className="text-right px-3 py-2">Obs Avg 24h</th>
                      <th className="text-right px-3 py-2">Samples 24h</th>
                      <th className="text-right px-3 py-2">24h</th>
                      <th className="text-right px-3 py-2">7d</th>
                      <th className="text-right px-3 py-2">Coverage 24h</th>
                      <th className="text-left px-3 py-2">Current State</th>
                      <th className="text-right px-3 py-2">Status Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {util.machines.map((machine) => {
                      const row = statusByMachine.get(machine);
                      const day = util.trailing.day.machines[machine];
                      const week = util.trailing.week.machines[machine];
                      return (
                        <tr key={machine} className="border-b border-gray-800/70">
                          <td className="px-3 py-2 font-medium text-gray-200">{machine}</td>
                          <td className="px-3 py-2 text-right">
                            {fmtPct(row?.gpu?.util)}
                            {typeof row?.gpu?.power_w === "number" && (
                              <span className={`ml-1 text-xs ${row.gpu.power_w >= 50 ? "text-emerald-400" : "text-gray-500"}`}>
                                {Math.round(row.gpu.power_w)}W
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-300">
                            {fmtPct(day?.observed_avg_util_pct)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-400">{day?.samples ?? 0}</td>
                          <td className="px-3 py-2 text-right text-cyan-300">{fmtPct(day?.attainment_pct)}</td>
                          <td className="px-3 py-2 text-right text-emerald-300">{fmtPct(week?.attainment_pct)}</td>
                          <td
                            className={`px-3 py-2 text-right ${
                              (day?.coverage_pct ?? 0) < 25 ? "text-amber-300" : "text-gray-200"
                            }`}
                          >
                            {fmtPct(day?.coverage_pct)}
                          </td>
                          <td className="px-3 py-2 text-gray-400">{machineRunState(row || { machine })}</td>
                          <td className={`px-3 py-2 text-right ${ageClass(row?.age_seconds)}`}>
                            {fmtAge(row?.age_seconds)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-2 border-t border-gray-800 text-xs text-gray-500">
                Current GPU util is the last check-in snapshot. Low coverage means 24h attainment may understate true
                usage.
              </div>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>Fleet Warp Speed</span>
                  <span className="text-xs font-normal text-gray-500">live GPU thrust</span>
                </div>
                <div className="p-3">
                  <div className="relative rounded-xl border border-cyan-900/40 bg-gradient-to-br from-slate-950 via-cyan-950/40 to-gray-900 p-2 overflow-hidden">
                    <div className="pointer-events-none absolute inset-0 fleet-speed-grid opacity-25" />
                    <svg viewBox="0 0 200 200" className="mx-auto h-44 w-44">
                      <defs>
                        <linearGradient id="fleetDialGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#22d3ee" />
                          <stop offset="50%" stopColor="#34d399" />
                          <stop offset="100%" stopColor="#facc15" />
                        </linearGradient>
                      </defs>
                      <circle cx="100" cy="100" r="74" fill="none" stroke="rgba(55,65,81,0.55)" strokeWidth="10" />
                      <circle
                        cx="100"
                        cy="100"
                        r="74"
                        fill="none"
                        stroke="url(#fleetDialGradient)"
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={ringCircumference}
                        strokeDashoffset={ringOffset}
                        transform="rotate(-90 100 100)"
                        className="transition-all duration-700 ease-out"
                      />
                      <line
                        x1="100"
                        y1="100"
                        x2="100"
                        y2="34"
                        stroke="#67e8f9"
                        strokeWidth="4"
                        strokeLinecap="round"
                        transform={`rotate(${speedNeedleDeg} 100 100)`}
                        className="transition-all duration-700 ease-out"
                      />
                      <circle cx="100" cy="100" r="7" fill="#e2e8f0" />
                    </svg>
                    <div className="absolute left-0 right-0 top-2 text-center">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/80">Throttle</div>
                    </div>
                    <div className="absolute left-0 right-0 bottom-2 text-center">
                      <div className="text-2xl font-semibold text-cyan-200">{fmtPct(fleetSpeedPct)}</div>
                      <div className="text-xs text-gray-400">
                        {speedRpm.toLocaleString()} RPM · {speedMph} MPH
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {machineSpeed.map((row) => (
                      <div key={`spd-${row.machine}`}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">{row.machine}</span>
                          <span className="text-cyan-200">
                            {fmtPct(row.utilPct)}
                            {row.powerW !== null && <span className="text-gray-400 ml-1">({Math.round(row.powerW)}W)</span>}
                            {" · "}{row.state}
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-gray-800 overflow-hidden border border-gray-700/70">
                          <div
                            className="h-full rounded-full fleet-speed-bar"
                            style={{
                              width: `${Math.max(3, row.utilPct)}%`,
                              animationDuration: `${Math.max(0.45, 2.6 - row.utilPct / 55)}s`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>Daily Attainment ({util.settings.daily_days}d)</span>
                  <span className="text-xs text-gray-500 font-normal">latest first</span>
                </div>
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-800 sticky top-0 bg-gray-900">
                        <th className="text-left px-3 py-1.5">Date</th>
                        <th className="text-right px-3 py-1.5">Fleet %</th>
                        <th className="text-right px-3 py-1.5">Coverage %</th>
                        <th className="text-right px-3 py-1.5">GPU h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map((row) => (
                        <tr key={`d-${row.label}`} className="border-b border-gray-800/60">
                          <td className="px-3 py-1.5 text-gray-300">
                            {row.label} {!row.complete && <span className="text-amber-400">(partial)</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right text-cyan-300">{fmtPct(row.fleet_attainment_pct)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtPct(row.fleet_coverage_pct)}</td>
                          <td className="px-3 py-1.5 text-right text-gray-400">
                            {fmtHours(row.achieved_gpu_hours)} / {fmtHours(row.possible_gpu_hours)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>Weekly Attainment ({util.settings.weekly_weeks}w)</span>
                  <span className="text-xs text-gray-500 font-normal">latest first</span>
                </div>
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-800 sticky top-0 bg-gray-900">
                        <th className="text-left px-3 py-1.5">Week Start</th>
                        <th className="text-right px-3 py-1.5">Fleet %</th>
                        <th className="text-right px-3 py-1.5">Coverage %</th>
                        <th className="text-right px-3 py-1.5">GPU h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyRows.map((row) => (
                        <tr key={`w-${row.label}`} className="border-b border-gray-800/60">
                          <td className="px-3 py-1.5 text-gray-300">
                            {row.label} {!row.complete && <span className="text-amber-400">(partial)</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right text-emerald-300">{fmtPct(row.fleet_attainment_pct)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtPct(row.fleet_coverage_pct)}</td>
                          <td className="px-3 py-1.5 text-right text-gray-400">
                            {fmtHours(row.achieved_gpu_hours)} / {fmtHours(row.possible_gpu_hours)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
      <style jsx>{`
        .fleet-speed-grid {
          background-image:
            linear-gradient(to right, rgba(34, 211, 238, 0.22) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(34, 211, 238, 0.16) 1px, transparent 1px);
          background-size: 16px 16px;
        }

        .fleet-speed-bar {
          background-image: linear-gradient(
            110deg,
            rgba(103, 232, 249, 0.95) 0%,
            rgba(16, 185, 129, 0.88) 45%,
            rgba(250, 204, 21, 0.88) 75%,
            rgba(103, 232, 249, 0.95) 100%
          );
          background-size: 200% 100%;
          animation-name: fleetSpeedShift;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.4);
        }

        @keyframes fleetSpeedShift {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 200% 50%;
          }
        }
      `}</style>
    </div>
  );
}
