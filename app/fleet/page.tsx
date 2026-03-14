"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

type GpuPipelineEntry = {
  job?: string | null;
  job_state?: string;   // "running" | "idle" | "unreachable"
  queue_depth?: number;
  queue_total?: number;
};

type RecentResult = {
  name?: string;
  machine?: string;
  collected_at?: string;
  configs?: number;
  profitable?: number;
  profitable_pct?: number;
  best_pf?: number;
  beats_production?: boolean;
};

type RecentCpuJob = {
  name?: string;
  machine?: string;      // "droplet" | "gaming-pc" | "garage-pc" | "mac"
  status?: string;       // "completed" | "failed" | "timeout"
  elapsed_min?: number;
  completed_at?: string;
};

type FleetHealth = {
  retry_queue_size?: number;
  idle_gpu_alert?: string | null;
  last_collect_at?: string | null;
};

type CpuStatus = {
  workers?: number;
  nice?: number;
  reason?: string;
  idle_seconds?: number;
};

type ResearchJob = {
  script?: string;
  cpu_pct?: number;
  elapsed?: string;
  workers?: number;
  pid?: number;
};

type ResearchProcesses = {
  jobs?: ResearchJob[];
  total_workers?: number;
  total_cpu_pct?: number;
};

type OrchestratorStatus = {
  state?: string;
  current_task?: string | null;
  started_at?: string | null;
  last_collect_at?: string | null;
  pid?: number;
  cpu?: CpuStatus;
  gpu_pipeline?: Record<string, GpuPipelineEntry>;
  recent_results?: RecentResult[];
  recent_cpu_jobs?: RecentCpuJob[];
  fleet_health?: FleetHealth;
  research_processes?: ResearchProcesses;
  // Legacy fields (kept for backward compat with old telemetry)
  idle_seconds?: number;
  cpu_budget?: {
    max_workers?: number;
    nice?: number;
    reason?: string;
  };
  collected_jobs_count?: number;
  collected_profitable?: number;
  best_pf?: number;
  retry_queue_size?: number;
  cpu_jobs_completed?: number;
};

type CpuWindowSummary = {
  avg_cores?: number;
  peak_cores?: number;
  total_core_hours?: number;
  samples?: number;
  coverage_pct?: number;
  label?: string;
  complete?: boolean;
};

type CpuUtilizationResponse = {
  as_of?: string;
  trailing?: {
    day?: CpuWindowSummary;
    week?: CpuWindowSummary;
  };
  daily?: CpuWindowSummary[];
};

type StatusMachine = {
  machine: string;
  age_seconds?: number | null;
  gpu?: {
    util?: number;
    temp?: number;
    mem_used_mb?: number;
    mem_total_mb?: number;
    clock_mhz?: number;
    power_w?: number;
  };
  heartbeats?: Record<string, { state?: string; current_job?: string; timestamp?: string }>;
  queues?: Record<string, { jobs?: Array<{ status?: string; name?: string }> }>;
  orchestrator?: OrchestratorStatus;
};

type StatusResponse = {
  machines: StatusMachine[];
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

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

function pctColor(v?: number): string {
  if (v == null || Number.isNaN(v)) return "text-gray-500";
  if (v >= 60) return "text-emerald-300";
  if (v >= 30) return "text-cyan-300";
  if (v >= 10) return "text-amber-300";
  return "text-red-300";
}

function tempColor(temp?: number): string {
  if (temp == null) return "text-gray-500";
  if (temp >= 85) return "text-red-400";
  if (temp >= 75) return "text-amber-300";
  return "text-gray-300";
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

// Expected checkins per 24h at 1/min
const EXPECTED_SAMPLES_24H = 1440;
const SAMPLE_RATE_WARN_PCT = 0.80; // warn below 80% of expected

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FleetUtilizationPage() {
  const [util, setUtil] = useState<UtilizationResponse | null>(null);
  const [cpuUtil, setCpuUtil] = useState<CpuUtilizationResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshAt, setRefreshAt] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [utilRes, statusRes, cpuUtilRes] = await Promise.all([
        fetch("/api/fleet/utilization?daily_days=14&weekly_weeks=8", { cache: "no-store" }),
        fetch("/api/fleet/status", { cache: "no-store" }),
        fetch("/api/fleet/cpu-utilization?daily_days=7", { cache: "no-store" }),
      ]);

      if (!utilRes.ok) throw new Error(`utilization API ${utilRes.status}`);
      if (!statusRes.ok) throw new Error(`status API ${statusRes.status}`);

      const utilJson = (await utilRes.json()) as UtilizationResponse;
      const statusJson = (await statusRes.json()) as StatusResponse;
      setUtil(utilJson);
      setStatus(statusJson);
      if (cpuUtilRes.ok) {
        setCpuUtil((await cpuUtilRes.json()) as CpuUtilizationResponse);
      }
      setRefreshAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load fleet utilization";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling with document.hidden check
  useEffect(() => {
    fetchData();

    const tick = () => {
      if (!document.hidden) {
        fetchData();
      }
    };
    timerRef.current = setInterval(tick, 60000);

    const handleVisibility = () => {
      if (!document.hidden) {
        // Refresh immediately when tab becomes visible
        fetchData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData]);

  const statusByMachine = useMemo(() => {
    const map = new Map<string, StatusMachine>();
    for (const row of status?.machines || []) {
      map.set(row.machine, row);
    }
    return map;
  }, [status]);

  // Extract CPU orchestrator data — merge from all machines with orchestrator field
  // Mac posts recent_results (GPU sweeps), droplet posts recent_cpu_jobs
  const orchestratorMachine = useMemo(() => {
    for (const row of status?.machines || []) {
      if (row.orchestrator) return row;
    }
    return null;
  }, [status]);

  // Merge orchestrator data from all machines
  const mergedOrchestrator = useMemo(() => {
    const allOrch = (status?.machines || []).filter(m => m.orchestrator);
    if (allOrch.length === 0) return null;
    // Start with the first orchestrator (typically Mac — has GPU pipeline, results, health)
    const primary = allOrch[0].orchestrator!;
    // Merge recent_cpu_jobs and recent_results from all orchestrator machines
    const allResults: RecentResult[] = [];
    const allCpuJobs: RecentCpuJob[] = [];
    for (const m of allOrch) {
      const o = m.orchestrator!;
      if (o.recent_results?.length) allResults.push(...o.recent_results);
      if (o.recent_cpu_jobs?.length) allCpuJobs.push(...o.recent_cpu_jobs);
    }
    return {
      ...primary,
      recent_results: allResults.length > 0 ? allResults : primary.recent_results,
      recent_cpu_jobs: allCpuJobs.length > 0 ? allCpuJobs : primary.recent_cpu_jobs,
    };
  }, [status]);

  const dailyRows = useMemo(() => {
    if (!util) return [];
    return [...util.daily].sort((a, b) => {
      const ta = Date.parse(a.start);
      const tb = Date.parse(b.start);
      if (!Number.isFinite(ta) || !Number.isFinite(tb))
        return String(b.label || "").localeCompare(String(a.label || ""));
      return tb - ta;
    });
  }, [util]);

  const weeklyRows = useMemo(() => {
    if (!util) return [];
    return [...util.weekly].sort((a, b) => {
      const ta = Date.parse(a.start);
      const tb = Date.parse(b.start);
      if (!Number.isFinite(ta) || !Number.isFinite(tb))
        return String(b.label || "").localeCompare(String(a.label || ""));
      return tb - ta;
    });
  }, [util]);

  const machineSpeed = useMemo(() => {
    if (!util) return [];
    return util.machines.map((machine) => {
      const row = statusByMachine.get(machine);
      const rawUtil = typeof row?.gpu?.util === "number" ? row.gpu.util : 0;
      const powerW = typeof row?.gpu?.power_w === "number" ? row.gpu.power_w : null;
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
  const ringCircumference = 2 * Math.PI * 74;
  const smallRingCirc = 2 * Math.PI * 60;
  const ringOffset = ringCircumference * (1 - fleetSpeedPct / 100);

  // CPU gauge: sum ALL active CPU cores across all machines (% of 18 total: 10 mac + 8 droplet)
  const CPU_TOTAL_CORES = 18;
  const cpuSpeedPct = useMemo(() => {
    if (!status) return 0;
    let totalCores = 0;
    for (const row of status.machines) {
      const o = row.orchestrator;
      if (!o) continue;
      // Research processes (detected via ps, reported as CPU %)
      const rpCores = (o.research_processes?.total_cpu_pct ?? 0) / 100;
      // Orchestrator CPU workers (LightGBM jobs etc)
      const orchWorkers = o.cpu?.workers ?? 0;
      totalCores += rpCores + orchWorkers;
    }
    return Math.max(0, Math.min(100, (totalCores / CPU_TOTAL_CORES) * 100));
  }, [status]);
  const cpuNeedleDeg = -120 + (cpuSpeedPct / 100) * 240;

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
            <h1 className="text-xl font-semibold tracking-tight">Fleet Dashboard</h1>
            <p className="text-xs text-gray-500">
              GPU + CPU compute · {refreshAt ? `refreshed ${new Date(refreshAt).toLocaleTimeString()}` : "loading..."}
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
            {/* --- Warp Speed Gauges: GPU + CPU side-by-side (hero) --- */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* GPU Warp Speed Gauge */}
              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-1.5 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>GPU Warp Speed</span>
                  <span className="text-xs font-normal tabular-nums">
                    <span className="text-cyan-400">{fmtPct(util.trailing.day.fleet_attainment_pct)}</span>
                    <span className="text-gray-600 mx-1">24h</span>
                    <span className="text-emerald-400">{fmtPct(util.trailing.week.fleet_attainment_pct)}</span>
                    <span className="text-gray-600 ml-1">7d</span>
                  </span>
                </div>
                <div className="px-3 py-2">
                  <div className="rounded-xl border border-cyan-900/40 bg-gradient-to-br from-slate-950 via-cyan-950/40 to-gray-900 overflow-hidden relative">
                    <div className="pointer-events-none absolute inset-0 fleet-speed-grid opacity-25" />
                    <svg viewBox="0 0 200 190" className="mx-auto w-full max-w-[180px]">
                      <defs>
                        <linearGradient id="fleetDialGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#22d3ee" />
                          <stop offset="50%" stopColor="#34d399" />
                          <stop offset="100%" stopColor="#facc15" />
                        </linearGradient>
                      </defs>
                      <text x="100" y="14" textAnchor="middle" fill="rgba(165,243,252,0.7)" fontSize="9" fontWeight="500" letterSpacing="0.18em" className="uppercase">THROTTLE</text>
                      <circle cx="100" cy="90" r="60" fill="none" stroke="rgba(55,65,81,0.55)" strokeWidth="9" />
                      <circle
                        cx="100"
                        cy="90"
                        r="60"
                        fill="none"
                        stroke="url(#fleetDialGradient)"
                        strokeWidth="9"
                        strokeLinecap="round"
                        strokeDasharray={smallRingCirc}
                        strokeDashoffset={smallRingCirc * (1 - fleetSpeedPct / 100)}
                        transform="rotate(-90 100 90)"
                        className="transition-all duration-700 ease-out"
                      />
                      <line
                        x1="100"
                        y1="90"
                        x2="100"
                        y2="37"
                        stroke="#67e8f9"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        transform={`rotate(${speedNeedleDeg} 100 90)`}
                        className="transition-all duration-700 ease-out"
                      />
                      <circle cx="100" cy="90" r="6" fill="#e2e8f0" />
                      <text x="100" y="180" textAnchor="middle" fill="#a5f3fc" fontSize="20" fontWeight="600">{fmtPct(fleetSpeedPct)}</text>
                    </svg>
                  </div>

                  <div className="mt-2.5 space-y-1.5">
                    {machineSpeed.map((row) => {
                      const statusRow = statusByMachine.get(row.machine);
                      const gpu = statusRow?.gpu;
                      return (
                        <div key={`spd-${row.machine}`}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-300 font-medium">{row.machine}</span>
                            <span className="text-cyan-300 tabular-nums">
                              {fmtPct(row.utilPct)}
                              {row.powerW !== null && (
                                <span className="text-gray-500 ml-1 font-normal">({Math.round(row.powerW)}W)</span>
                              )}
                              {gpu?.temp != null && (
                                <span className={`ml-1 font-normal ${tempColor(gpu.temp)}`}>{gpu.temp}°</span>
                              )}
                            </span>
                          </div>
                          <div className="mt-0.5 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div
                              className="h-full rounded-full fleet-speed-bar"
                              style={{
                                width: `${Math.max(2, row.utilPct)}%`,
                                animationDuration: `${Math.max(0.45, 2.6 - row.utilPct / 55)}s`,
                              }}
                            />
                          </div>
                          <div className="text-[10px] text-gray-600 mt-0.5 truncate">{row.state}</div>
                        </div>
                      );
                    })}
                  </div>
                  {/* GPU attainment summary */}
                  <div className="mt-2 pt-1.5 border-t border-gray-800/60 grid grid-cols-3 gap-2 text-[10px] text-gray-500 tabular-nums">
                    <div>
                      <span className="text-gray-600">24h</span>{" "}
                      {fmtHours(util.trailing.day.achieved_gpu_hours)}<span className="text-gray-700">/{fmtHours(util.trailing.day.possible_gpu_hours)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">7d</span>{" "}
                      {fmtHours(util.trailing.week.achieved_gpu_hours)}<span className="text-gray-700">/{fmtHours(util.trailing.week.possible_gpu_hours)}</span>
                    </div>
                    <div className="text-right">
                      Cov {fmtPct(util.trailing.day.fleet_coverage_pct)}
                    </div>
                  </div>
                </div>
              </div>

              {/* CPU Warp Speed Gauge */}
              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-1.5 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>CPU Warp Speed</span>
                  <span className="text-xs font-normal tabular-nums">
                    {cpuUtil?.trailing ? (
                      <>
                        <span className="text-cyan-400">{(cpuUtil.trailing.day?.avg_cores ?? 0).toFixed(1)}</span>
                        <span className="text-gray-600 mx-1">cores 24h</span>
                        <span className="text-emerald-400">{(cpuUtil.trailing.week?.avg_cores ?? 0).toFixed(1)}</span>
                        <span className="text-gray-600 ml-1">7d</span>
                      </>
                    ) : <span className="text-gray-600">loading...</span>}
                  </span>
                </div>
                <div className="px-3 py-2">
                  <div className="rounded-xl border border-emerald-900/40 bg-gradient-to-br from-slate-950 via-emerald-950/40 to-gray-900 overflow-hidden relative">
                    <div className="pointer-events-none absolute inset-0 cpu-speed-grid opacity-25" />
                    <svg viewBox="0 0 200 190" className="mx-auto w-full max-w-[180px]">
                      <defs>
                        <linearGradient id="cpuDialGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#34d399" />
                          <stop offset="50%" stopColor="#10b981" />
                          <stop offset="100%" stopColor="#facc15" />
                        </linearGradient>
                      </defs>
                      <text x="100" y="14" textAnchor="middle" fill="rgba(167,243,208,0.7)" fontSize="9" fontWeight="500" letterSpacing="0.18em" className="uppercase">THROTTLE</text>
                      <circle cx="100" cy="90" r="60" fill="none" stroke="rgba(55,65,81,0.55)" strokeWidth="9" />
                      <circle
                        cx="100"
                        cy="90"
                        r="60"
                        fill="none"
                        stroke="url(#cpuDialGradient)"
                        strokeWidth="9"
                        strokeLinecap="round"
                        strokeDasharray={smallRingCirc}
                        strokeDashoffset={smallRingCirc * (1 - cpuSpeedPct / 100)}
                        transform="rotate(-90 100 90)"
                        className="transition-all duration-700 ease-out"
                      />
                      <line
                        x1="100"
                        y1="90"
                        x2="100"
                        y2="37"
                        stroke="#34d399"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        transform={`rotate(${cpuNeedleDeg} 100 90)`}
                        className="transition-all duration-700 ease-out"
                      />
                      <circle cx="100" cy="90" r="6" fill="#e2e8f0" />
                      <text x="100" y="180" textAnchor="middle" fill="#a7f3d0" fontSize="18" fontWeight="600">
                        {cpuSpeedPct > 0 ? `${(cpuSpeedPct * CPU_TOTAL_CORES / 100).toFixed(1)} cores` : "0.0 cores"}
                      </text>
                    </svg>
                  </div>

                  {/* Machine bars */}
                  <div className="mt-2 space-y-1.5">
                    {(() => {
                      // Gather CPU data from ALL machines with orchestrator
                      const cpuMachines = (status?.machines || [])
                        .filter(m => m.orchestrator)
                        .map(m => {
                          const o = m.orchestrator!;
                          const rpCores = (o.research_processes?.total_cpu_pct ?? 0) / 100;
                          const orchWorkers = o.cpu?.workers ?? 0;
                          const totalCores = rpCores + orchWorkers;
                          const rpJobs = o.research_processes?.jobs ?? [];
                          const task = o.current_task;
                          const maxCores = m.machine === "mac" ? 10 : m.machine === "droplet" ? 8 : 4;
                          const label = m.machine === "mac" ? "M4 Pro" : m.machine === "droplet" ? "8 vCPU" : "";
                          return { machine: m.machine, totalCores, maxCores, rpJobs, task, label, orchWorkers };
                        });
                      return cpuMachines.map(cm => {
                        const pct = Math.min(100, (cm.totalCores / cm.maxCores) * 100);
                        return (
                          <div key={cm.machine}>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-300 font-medium">{cm.machine} <span className="text-gray-600 font-normal">{cm.label}</span></span>
                              <span className={`tabular-nums ${cm.totalCores > 0 ? "text-emerald-300" : "text-gray-600"}`}>
                                {cm.totalCores.toFixed(1)}/{cm.maxCores} cores
                              </span>
                            </div>
                            <div className="mt-0.5 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${cm.totalCores > 0 ? "cpu-speed-bar" : "bg-gray-700"}`}
                                style={{
                                  width: `${Math.max(2, pct)}%`,
                                  ...(cm.totalCores > 0 ? { animationDuration: `${Math.max(0.45, 2.6 - pct / 55)}s` } : {}),
                                }}
                              />
                            </div>
                            {cm.rpJobs.length > 0 ? (
                              <div className="mt-0.5 space-y-0">
                                {cm.rpJobs.map((job, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                    <span className="text-emerald-400 font-mono truncate max-w-[140px]">{job.script || "unknown"}</span>
                                    {(job.workers ?? 0) > 0 && <span className="text-gray-600">{job.workers}w</span>}
                                    <span className="tabular-nums text-gray-500">{(job.cpu_pct ?? 0).toFixed(0)}%</span>
                                    {job.elapsed && <span className="text-gray-700">{job.elapsed}</span>}
                                  </div>
                                ))}
                              </div>
                            ) : cm.task ? (
                              <div className="text-[10px] text-emerald-400/70 mt-0.5 truncate">{cm.task}</div>
                            ) : (
                              <div className="text-[10px] text-gray-600 mt-0.5">idle</div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                  {/* CPU attainment summary */}
                  {cpuUtil?.trailing && (
                    <div className="mt-2 pt-1.5 border-t border-gray-800/60 grid grid-cols-3 gap-2 text-[10px] text-gray-500 tabular-nums">
                      <div>
                        <span className="text-gray-600">24h</span>{" "}
                        {(cpuUtil.trailing.day?.total_core_hours ?? 0).toFixed(1)} core·h
                      </div>
                      <div>
                        <span className="text-gray-600">7d</span>{" "}
                        {(cpuUtil.trailing.week?.total_core_hours ?? 0).toFixed(1)} core·h
                      </div>
                      <div className="text-right">
                        peak {(cpuUtil.trailing.day?.peak_cores ?? 0).toFixed(1)} cores
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* --- Live Machine Snapshot --- */}
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
                      <th className="text-right px-3 py-2">Temp</th>
                      <th className="text-right px-3 py-2">VRAM</th>
                      <th className="text-right px-3 py-2">Clock</th>
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
                      const gpu = row?.gpu;
                      const samples = day?.samples ?? 0;
                      const sampleHealth =
                        samples >= EXPECTED_SAMPLES_24H * SAMPLE_RATE_WARN_PCT
                          ? "text-gray-400"
                          : samples >= EXPECTED_SAMPLES_24H * 0.5
                            ? "text-amber-300"
                            : "text-red-300";
                      const vramPct =
                        gpu?.mem_used_mb && gpu?.mem_total_mb
                          ? ((gpu.mem_used_mb / gpu.mem_total_mb) * 100).toFixed(0)
                          : null;
                      return (
                        <tr key={machine} className="border-b border-gray-800/70">
                          <td className="px-3 py-2 font-medium text-gray-200">{machine}</td>
                          <td className="px-3 py-2 text-right">
                            {fmtPct(gpu?.util)}
                            {typeof gpu?.power_w === "number" && (
                              <span
                                className={`ml-1 text-xs ${gpu.power_w >= 50 ? "text-emerald-400" : "text-gray-500"}`}
                              >
                                {Math.round(gpu.power_w)}W
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right ${tempColor(gpu?.temp)}`}>
                            {gpu?.temp != null ? `${gpu.temp}°C` : "--"}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-300">
                            {gpu?.mem_used_mb != null && gpu?.mem_total_mb != null ? (
                              <span title={`${gpu.mem_used_mb} / ${gpu.mem_total_mb} MB`}>
                                {(gpu.mem_used_mb / 1024).toFixed(1)}/{(gpu.mem_total_mb / 1024).toFixed(0)}G
                                <span className="text-xs text-gray-500 ml-1">({vramPct}%)</span>
                              </span>
                            ) : (
                              "--"
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-400">
                            {gpu?.clock_mhz != null ? `${gpu.clock_mhz}MHz` : "--"}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-300">
                            {fmtPct(day?.observed_avg_util_pct)}
                          </td>
                          <td className={`px-3 py-2 text-right ${sampleHealth}`}>
                            {samples}
                            <span className="text-xs text-gray-600 ml-0.5">/{EXPECTED_SAMPLES_24H}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-cyan-300">
                            {fmtPct(day?.attainment_pct)}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-300">
                            {fmtPct(week?.attainment_pct)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right ${(day?.coverage_pct ?? 0) < 25 ? "text-amber-300" : "text-gray-200"}`}
                          >
                            {fmtPct(day?.coverage_pct)}
                          </td>
                          <td className="px-3 py-2 text-gray-400 max-w-[160px] truncate">
                            {machineRunState(row || { machine })}
                          </td>
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
                Current GPU data is the last check-in snapshot. Samples shows received/expected at 1/min.
                Low coverage means 24h attainment may understate true usage.
              </div>
            </section>

            {/* --- Live CPU Machine Snapshot --- */}
            {(() => {
              const cpuMachines = (status?.machines || []).filter(m => {
                // CPU machines: those without GPU data, or those with orchestrator
                const hasGpu = m.gpu && Object.values(m.gpu).some(v => v != null && v !== 0);
                return !hasGpu && m.machine !== "watchdog_state";
              });
              if (cpuMachines.length === 0) return null;
              return (
                <section className="rounded border border-gray-800 bg-gray-900">
                  <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300">
                    Live CPU Machine Snapshot
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-gray-500">
                        <tr className="border-b border-gray-800">
                          <th className="text-left px-3 py-2">Machine</th>
                          <th className="text-left px-3 py-2">Role</th>
                          <th className="text-right px-3 py-2">CPU Workers</th>
                          <th className="text-left px-3 py-2">Current Task</th>
                          <th className="text-left px-3 py-2">State</th>
                          <th className="text-right px-3 py-2">Status Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cpuMachines.map((m) => {
                          const o = m.orchestrator;
                          const hb = m.heartbeats?.cpu_orchestrator;
                          const cpuState = o?.state || hb?.state || "offline";
                          const workers = o?.cpu?.workers ?? 0;
                          const task = o?.current_task || hb?.current_job || null;
                          const role = m.machine === "mac" ? "compute + GPU collection"
                            : m.machine === "droplet" ? "fleet brain + compute"
                            : "compute";
                          return (
                            <tr key={m.machine} className="border-b border-gray-800/50">
                              <td className="px-3 py-2 text-gray-200 font-medium">{m.machine}</td>
                              <td className="px-3 py-2 text-gray-500 text-xs">{role}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <span className={workers > 0 ? "text-emerald-300" : "text-gray-500"}>
                                  {workers}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-cyan-300 text-xs max-w-[200px] truncate" title={task || undefined}>
                                {task || "—"}
                              </td>
                              <td className="px-3 py-2">
                                <span className="flex items-center gap-1.5 text-xs">
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                                    cpuState === "cpu_job" ? "bg-emerald-400 animate-pulse" :
                                    cpuState === "collecting" ? "bg-cyan-400 animate-pulse" :
                                    cpuState === "idle" ? "bg-gray-500" :
                                    "bg-gray-600"
                                  }`} />
                                  <span className={
                                    cpuState === "cpu_job" ? "text-emerald-300" :
                                    cpuState === "collecting" ? "text-cyan-300" :
                                    cpuState === "idle" ? "text-gray-400" : "text-gray-500"
                                  }>{cpuState}</span>
                                </span>
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums ${ageClass(m.age_seconds)}`}>
                                {fmtAge(m.age_seconds)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })()}

            {/* --- GPU Pipeline + CPU Compute + Results (from orchestrator) --- */}
            {orchestratorMachine && mergedOrchestrator && (() => {
              const orch = mergedOrchestrator;
              const orchState = orch.state || "unknown";

              const pipeline = orch.gpu_pipeline;
              const results = orch.recent_results;
              const cpuJobs = orch.recent_cpu_jobs;
              const health = orch.fleet_health;
              const hasPipeline = pipeline && Object.keys(pipeline).length > 0;

              // Health bar text
              const lastCollect = health?.last_collect_at || orch.last_collect_at;
              const collectAgo = lastCollect ? (() => {
                const ms = Date.now() - Date.parse(lastCollect);
                if (!Number.isFinite(ms) || ms < 0) return "--";
                const sec = ms / 1000;
                if (sec < 60) return `${Math.round(sec)}s`;
                if (sec < 3600) return `${Math.round(sec / 60)}m`;
                return `${(sec / 3600).toFixed(1)}h`;
              })() : "--";
              const retries = health?.retry_queue_size ?? orch.retry_queue_size ?? 0;
              const idleAlert = health?.idle_gpu_alert;

              // CPU compute status
              const cpu = orch.cpu;
              const cpuLegacy = orch.cpu_budget;
              const cpuWorkers = cpu?.workers ?? cpuLegacy?.max_workers ?? 0;
              const cpuReason = cpu?.reason ?? cpuLegacy?.reason ?? "unknown";
              const cpuIdleSec = cpu?.idle_seconds ?? orch.idle_seconds ?? 0;
              const cpuTask = orch.current_task;
              const cpuActive = orchState === "cpu_job";

              // Research processes (agent-spawned CPU jobs)
              const rp = orch.research_processes;
              const rpJobs = rp?.jobs ?? [];
              const rpTotalCpu = rp?.total_cpu_pct ?? 0;
              const rpTotalWorkers = rp?.total_workers ?? 0;
              const macCpuBusy = rpTotalCpu > 50 || cpuActive;

              return (
                <>
                  {/* ========== GPU Pipeline ========== */}
                  {hasPipeline && (
                    <section className="rounded border border-gray-800 bg-gray-900">
                      <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          GPU Pipeline
                          <span className="text-xs font-normal text-gray-500">current jobs + queue progress</span>
                        </span>
                        <span className="text-xs text-gray-500 flex items-center gap-2">
                          <span className={retries > 0 ? "text-amber-300" : "text-gray-500"}>{retries > 0 ? `${retries} retries` : ""}</span>
                          {idleAlert && <span className="text-amber-300">{idleAlert} idle</span>}
                          {collectAgo !== "--" && <span className="text-gray-500">collected {collectAgo} ago</span>}
                        </span>
                      </div>
                      <div className="px-3 py-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Object.entries(pipeline!).map(([machine, info]) => {
                          const jState = info.job_state || "unknown";
                          const dotColor =
                            jState === "running" ? "bg-emerald-400" :
                            jState === "idle" ? "bg-gray-500" :
                            "bg-red-400";
                          const depth = info.queue_depth ?? 0;
                          const total = info.queue_total ?? 0;
                          const done = Math.max(0, total - depth);
                          const pct = total > 0 ? Math.round((done / total) * 100) : 0;

                          return (
                            <div key={machine} className="rounded border border-gray-800 bg-gray-950/50 px-3 py-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="flex items-center gap-1.5 text-xs font-medium text-gray-200">
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                  {machine}
                                </span>
                                <span className="text-xs text-gray-500">{jState}</span>
                              </div>
                              <div className="text-xs text-cyan-300 truncate mb-1.5" title={info.job || undefined}>
                                {info.job || "—"}
                              </div>
                              {total > 0 && (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-cyan-600"
                                      style={{ width: `${Math.max(2, pct)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                                    {done}/{total}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* ========== Orchestrator Status (compact bar) ========== */}
                  <div className="rounded border border-gray-800 bg-gray-900 px-3 py-1.5 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                        orchState === "collecting" ? "bg-cyan-400 animate-pulse" :
                        orchState === "cpu_job" ? "bg-emerald-400 animate-pulse" :
                        "bg-gray-600"
                      }`} />
                      Orchestrator: <span className={
                        orchState === "collecting" ? "text-cyan-300" :
                        orchState === "cpu_job" ? "text-emerald-300" :
                        orchState === "idle" ? "text-gray-400" : "text-gray-500"
                      }>{orchState}</span>
                    </span>
                    <span className="text-gray-700">·</span>
                    <span>PID {orch.pid}</span>
                    <span className="text-gray-700">·</span>
                    <span className={ageClass(orchestratorMachine.age_seconds)}>
                      checkin {fmtAge(orchestratorMachine.age_seconds)} ago
                    </span>
                    {(health?.retry_queue_size ?? orch.retry_queue_size ?? 0) > 0 && (
                      <>
                        <span className="text-gray-700">·</span>
                        <span className="text-amber-300">{health?.retry_queue_size ?? orch.retry_queue_size} retries</span>
                      </>
                    )}
                  </div>

                  {/* ========== Experiment Results + CPU Jobs side by side ========== */}
                  <div className={`grid gap-3 ${cpuJobs && cpuJobs.length > 0 && results && results.length > 0 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
                  {results && results.length > 0 && (
                    <section className="rounded border border-gray-800 bg-gray-900">
                      <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                        <span>Recent Experiment Results</span>
                        <span className="text-xs text-gray-500 font-normal">GPU sweeps</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500">
                            <tr className="border-b border-gray-800">
                              <th className="text-left px-3 py-1.5">Job</th>
                              <th className="text-left px-3 py-1.5">Machine</th>
                              <th className="text-right px-3 py-1.5">Configs</th>
                              <th className="text-right px-3 py-1.5">Profitable</th>
                              <th className="text-right px-3 py-1.5">Best PF</th>
                              <th className="text-right px-3 py-1.5">vs Prod</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.map((r, i) => (
                              <tr key={`res-${i}`} className="border-b border-gray-800/50">
                                <td className="px-3 py-1.5 text-gray-300 max-w-[180px] truncate" title={r.name}>
                                  {r.name || "—"}
                                </td>
                                <td className="px-3 py-1.5">
                                  <span className="text-gray-400">{(r.machine || "").replace("-pc", "")}</span>
                                </td>
                                <td className="px-3 py-1.5 text-right text-gray-300 tabular-nums">
                                  {r.configs ?? 0}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums">
                                  <span className={(r.profitable ?? 0) > 0 ? "text-emerald-300" : "text-gray-500"}>
                                    {r.profitable ?? 0}
                                  </span>
                                  {(r.configs ?? 0) > 0 && (
                                    <span className="text-gray-500 ml-1">
                                      ({(r.profitable_pct ?? 0).toFixed(0)}%)
                                    </span>
                                  )}
                                </td>
                                <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${
                                  (r.best_pf ?? 0) >= 3.01 ? "text-emerald-300" :
                                  (r.best_pf ?? 0) > 1.0 ? "text-gray-200" : "text-gray-500"
                                }`}>
                                  {(r.best_pf ?? 0) > 0 ? (r.best_pf ?? 0).toFixed(2) : "—"}
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                  {(r.best_pf ?? 0) > 0 ? (
                                    r.beats_production ? (
                                      <span className="text-emerald-400">&#9650;</span>
                                    ) : (
                                      <span className="text-red-400">&#9660;</span>
                                    )
                                  ) : (
                                    <span className="text-gray-600">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {/* ========== Recent CPU Jobs ========== */}
                  {cpuJobs && cpuJobs.length > 0 && (
                    <section className="rounded border border-gray-800 bg-gray-900">
                      <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                        <span>Recent CPU Jobs</span>
                        <span className="text-xs text-gray-500 font-normal">fleet orchestrator</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500">
                            <tr className="border-b border-gray-800">
                              <th className="text-left px-3 py-1.5">Job</th>
                              <th className="text-left px-3 py-1.5">Machine</th>
                              <th className="text-left px-3 py-1.5">Status</th>
                              <th className="text-right px-3 py-1.5">Duration</th>
                              <th className="text-right px-3 py-1.5">Completed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...cpuJobs].reverse().map((j, i) => {
                              const completedAt = j.completed_at ? new Date(j.completed_at) : null;
                              const ago = completedAt
                                ? (() => {
                                    const mins = Math.floor((Date.now() - completedAt.getTime()) / 60000);
                                    if (mins < 60) return `${mins}m ago`;
                                    const hrs = Math.floor(mins / 60);
                                    if (hrs < 24) return `${hrs}h ago`;
                                    return `${Math.floor(hrs / 24)}d ago`;
                                  })()
                                : "—";
                              return (
                                <tr key={`cpu-${i}`} className="border-b border-gray-800/50">
                                  <td className="px-3 py-1.5 text-gray-300 max-w-[200px] truncate" title={j.name}>
                                    {j.name || "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-400">
                                    {(j.machine || "—").replace("-pc", "")}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <span className={j.status === "completed" ? "text-emerald-400" : j.status === "timeout" ? "text-amber-400" : "text-red-400"}>
                                      {j.status || "—"}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-gray-300 tabular-nums">
                                    {j.elapsed_min != null ? `${j.elapsed_min.toFixed(1)}m` : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">
                                    {ago}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                  </div>
                </>
              );
            })()}

            {/* --- Attainment Tables: GPU Daily + GPU Weekly + CPU Daily --- */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* GPU Daily Attainment */}
              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>GPU Daily ({util.settings.daily_days}d)</span>
                  <span className="text-xs text-gray-500 font-normal">latest first</span>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-800 sticky top-0 bg-gray-900">
                        <th className="text-left px-2 py-1.5">Date</th>
                        <th className="text-right px-2 py-1.5">Fleet %</th>
                        {util.machines.map((m) => (
                          <th key={`dh-${m}`} className="text-right px-2 py-1.5">
                            {m.replace("-pc", "")}
                          </th>
                        ))}
                        <th className="text-right px-2 py-1.5">Cov %</th>
                        <th className="text-right px-2 py-1.5">GPU h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map((row) => (
                        <tr key={`d-${row.label}`} className="border-b border-gray-800/60">
                          <td className="px-2 py-1.5 text-gray-300">
                            {row.label}{" "}
                            {!row.complete && <span className="text-amber-400">(partial)</span>}
                          </td>
                          <td className={`px-2 py-1.5 text-right ${pctColor(row.fleet_attainment_pct)}`}>
                            {fmtPct(row.fleet_attainment_pct)}
                          </td>
                          {util.machines.map((m) => {
                            const mb = row.machines[m];
                            return (
                              <td
                                key={`d-${row.label}-${m}`}
                                className={`px-2 py-1.5 text-right ${pctColor(mb?.attainment_pct)}`}
                              >
                                {fmtPct(mb?.attainment_pct)}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-right text-gray-400">
                            {fmtPct(row.fleet_coverage_pct)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-400">
                            {fmtHours(row.achieved_gpu_hours)} / {fmtHours(row.possible_gpu_hours)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* GPU Weekly Attainment */}
              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>GPU Weekly ({util.settings.weekly_weeks}w)</span>
                  <span className="text-xs text-gray-500 font-normal">latest first</span>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-800 sticky top-0 bg-gray-900">
                        <th className="text-left px-2 py-1.5">Week Start</th>
                        <th className="text-right px-2 py-1.5">Fleet %</th>
                        {util.machines.map((m) => (
                          <th key={`wh-${m}`} className="text-right px-2 py-1.5">
                            {m.replace("-pc", "")}
                          </th>
                        ))}
                        <th className="text-right px-2 py-1.5">Cov %</th>
                        <th className="text-right px-2 py-1.5">GPU h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyRows.map((row) => (
                        <tr key={`w-${row.label}`} className="border-b border-gray-800/60">
                          <td className="px-2 py-1.5 text-gray-300">
                            {row.label}{" "}
                            {!row.complete && <span className="text-amber-400">(partial)</span>}
                          </td>
                          <td className={`px-2 py-1.5 text-right ${pctColor(row.fleet_attainment_pct)}`}>
                            {fmtPct(row.fleet_attainment_pct)}
                          </td>
                          {util.machines.map((m) => {
                            const mb = row.machines[m];
                            return (
                              <td
                                key={`w-${row.label}-${m}`}
                                className={`px-2 py-1.5 text-right ${pctColor(mb?.attainment_pct)}`}
                              >
                                {fmtPct(mb?.attainment_pct)}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-right text-gray-400">
                            {fmtPct(row.fleet_coverage_pct)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-400">
                            {fmtHours(row.achieved_gpu_hours)} / {fmtHours(row.possible_gpu_hours)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* CPU Daily Attainment */}
              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>CPU Daily (7d)</span>
                  <span className="text-xs text-gray-500 font-normal">latest first</span>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {cpuUtil?.daily && cpuUtil.daily.length > 0 ? (
                    <table className="w-full text-xs">
                      <thead className="text-gray-500">
                        <tr className="border-b border-gray-800 sticky top-0 bg-gray-900">
                          <th className="text-left px-2 py-1.5">Date</th>
                          <th className="text-right px-2 py-1.5">Avg Cores</th>
                          <th className="text-right px-2 py-1.5">Peak</th>
                          <th className="text-right px-2 py-1.5">Core·h</th>
                          <th className="text-right px-2 py-1.5">Cov %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...cpuUtil.daily].sort((a, b) =>
                          String(b.label || "").localeCompare(String(a.label || ""))
                        ).map((row) => (
                          <tr key={`cpu-d-${row.label}`} className="border-b border-gray-800/60">
                            <td className="px-2 py-1.5 text-gray-300">
                              {row.label}{" "}
                              {!row.complete && <span className="text-amber-400">(partial)</span>}
                            </td>
                            <td className={`px-2 py-1.5 text-right tabular-nums ${(row.avg_cores ?? 0) >= 1 ? "text-emerald-300" : "text-gray-400"}`}>
                              {(row.avg_cores ?? 0).toFixed(1)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">
                              {(row.peak_cores ?? 0).toFixed(1)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">
                              {(row.total_core_hours ?? 0).toFixed(1)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-gray-400">
                              {fmtPct(row.coverage_pct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="px-3 py-4 text-xs text-gray-500 text-center">No CPU telemetry data yet</div>
                  )}
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

        .cpu-speed-grid {
          background-image:
            linear-gradient(to right, rgba(52, 211, 153, 0.22) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(52, 211, 153, 0.16) 1px, transparent 1px);
          background-size: 16px 16px;
        }

        .cpu-speed-bar {
          background-image: linear-gradient(
            110deg,
            rgba(52, 211, 153, 0.95) 0%,
            rgba(16, 185, 129, 0.88) 45%,
            rgba(250, 204, 21, 0.88) 75%,
            rgba(52, 211, 153, 0.95) 100%
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
