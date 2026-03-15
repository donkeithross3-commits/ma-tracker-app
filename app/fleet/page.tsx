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
    hour?: WindowBucket;
    day: WindowBucket;
    week: WindowBucket;
  };
  daily: WindowBucket[];
  weekly: WindowBucket[];
};

type GpuPipelineEntry = {
  job?: string | null;
  job_state?: string;
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
  machine?: string;
  status?: string;
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
  system_cpu_pct?: number;
};

type RunningExperiment = {
  name?: string;
  machine?: string;
  elapsed_min?: number;
  max_hours?: number;
};

type PendingExperiment = {
  name?: string;
  priority?: number;
  target_machine?: string;
  hypothesis?: string;
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
  running_experiments?: RunningExperiment[];
  pending_queue?: PendingExperiment[];
  completed_count?: number;
  fleet_health?: FleetHealth;
  research_processes?: ResearchProcesses;
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
  stale?: boolean;
  gpu?: {
    util?: number;
    temp?: number;
    mem_used_mb?: number;
    mem_total_mb?: number;
    clock_mhz?: number;
    power_w?: number;
  };
  heartbeats?: Record<string, { state?: string; current_job?: string; timestamp?: string; elapsed_minutes?: number; started_at?: string }>;
  queues?: Record<string, { jobs?: Array<{ status?: string; name?: string }> }>;
  orchestrator?: OrchestratorStatus;
};

type StatusResponse = {
  machines: StatusMachine[];
};

type MachineCard = {
  name: string;
  spec: typeof MACHINE_SPECS[string];
  row: StatusMachine | undefined;
  isStale: boolean;
  gpuUtil: number | null;
  gpuTemp: number | null;
  vramUsedGb: number | null;
  vramTotalGb: number | null;
  gpuJob: string | null;
  activeCores: number;
  significantJobs: ResearchJob[];
  orchState: string | undefined;
  orchPid: number | undefined;
  health: FleetHealth | undefined;
  ageSeconds: number | null | undefined;
};

// ---------------------------------------------------------------------------
// Hardware specs (hardcoded, source of truth)
// ---------------------------------------------------------------------------

const MACHINE_SPECS: Record<string, {
  gpu?: string;
  gpuVram?: number; // GB
  cpu: string;
  cores: number;
  role: string;
}> = {
  "gaming-pc": { gpu: "RTX 4060", gpuVram: 8, cpu: "i7-12700F", cores: 16, role: "GPU + CPU compute" },
  "garage-pc": { gpu: "RTX 3080 Ti", gpuVram: 12, cpu: "i7-14700K", cores: 24, role: "GPU + CPU compute" },
  "droplet":   { cpu: "8 vCPU", cores: 8, role: "Fleet brain + compute" },
  "mac":       { cpu: "M4 Pro", cores: 10, role: "Orchestrator + compute" },
};

const CPU_TOTAL_CORES = Object.values(MACHINE_SPECS).reduce((sum, s) => sum + s.cores, 0); // 58

// Preferred display order
const MACHINE_ORDER = ["gaming-pc", "garage-pc", "droplet", "mac"];

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

function fmtElapsed(elapsed?: string | null): string {
  if (!elapsed) return "--";
  // elapsed comes as "HH:MM:SS" or similar from the agent
  return elapsed;
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

function timeAgo(isoStr?: string | null): string {
  if (!isoStr) return "--";
  const ms = Date.now() - Date.parse(isoStr);
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const sec = ms / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

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
    const tick = () => { if (!document.hidden) fetchData(); };
    timerRef.current = setInterval(tick, 60000);
    const handleVisibility = () => { if (!document.hidden) fetchData(); };
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

  // Merge orchestrator data from all machines
  const mergedOrchestrator = useMemo(() => {
    const allOrch = (status?.machines || []).filter(m => m.orchestrator);
    if (allOrch.length === 0) return null;
    const primary = allOrch[0].orchestrator!;
    const allResults: RecentResult[] = [];
    const allCpuJobs: RecentCpuJob[] = [];
    const allRunning: RunningExperiment[] = [];
    const allPending: PendingExperiment[] = [];
    let totalCompleted = 0;
    for (const m of allOrch) {
      const o = m.orchestrator!;
      if (o.recent_results?.length) allResults.push(...o.recent_results);
      if (o.recent_cpu_jobs?.length) allCpuJobs.push(...o.recent_cpu_jobs);
      if (o.running_experiments?.length) allRunning.push(...o.running_experiments);
      if (o.pending_queue?.length) allPending.push(...o.pending_queue);
      totalCompleted += o.completed_count ?? 0;
    }
    return {
      ...primary,
      recent_results: allResults.length > 0 ? allResults : primary.recent_results,
      recent_cpu_jobs: allCpuJobs.length > 0 ? allCpuJobs : primary.recent_cpu_jobs,
      running_experiments: allRunning.length > 0 ? allRunning : primary.running_experiments,
      pending_queue: allPending.length > 0 ? allPending : primary.pending_queue,
      completed_count: totalCompleted || primary.completed_count,
    };
  }, [status]);

  // Orchestrator machine for checkin age display
  const orchestratorMachine = useMemo(() => {
    for (const row of status?.machines || []) {
      if (row.orchestrator) return row;
    }
    return null;
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

  // -----------------------------------------------------------------------
  // Derived data: per-machine card info
  // -----------------------------------------------------------------------

  const machineCards = useMemo(() => {
    if (!status) return [];

    return MACHINE_ORDER.map((name): MachineCard | null => {
      const row = statusByMachine.get(name);
      const spec = MACHINE_SPECS[name];
      if (!spec) return null;

      const gpu = row?.gpu;
      const orch = row?.orchestrator;
      const isStale = row?.stale === true || (row?.age_seconds != null && row.age_seconds > 300);

      // GPU info
      const gpuUtil = typeof gpu?.util === "number" ? gpu.util : null;
      const gpuTemp = gpu?.temp ?? null;
      const vramUsedGb = gpu?.mem_used_mb != null ? gpu.mem_used_mb / 1024 : null;
      const vramTotalGb = spec.gpuVram ?? null;
      const gpuJob = machineRunState(row || { machine: name });

      // CPU active cores: use the MAX of system-level CPU% and process-sum CPU%.
      // system_cpu_pct (from OS) can be stale/unreliable on Windows.
      // total_cpu_pct (sum of detected processes) misses n_jobs child workers.
      // Taking the max gives the most honest picture.
      const rp = orch?.research_processes;
      const sysCpuCores = isStale ? 0 : (
        rp?.system_cpu_pct != null ? (rp.system_cpu_pct / 100) * spec.cores : 0
      );
      const processCpuCores = isStale ? 0 : (
        (rp?.total_cpu_pct ?? 0) / 100
      );
      const activeCores = Math.max(sysCpuCores, processCpuCores);

      // Processes (filter out < 1% CPU)
      const rpJobs = isStale ? [] : (orch?.research_processes?.jobs ?? []);
      const significantJobs = rpJobs.filter(j => (j.cpu_pct ?? 0) >= 1);

      // Orchestrator state for mac
      const orchState = orch?.state;
      const orchPid = orch?.pid;

      // Brain cost (placeholder -- from fleet health)
      const health = orch?.fleet_health;

      return {
        name,
        spec,
        row,
        isStale,
        gpuUtil,
        gpuTemp,
        vramUsedGb,
        vramTotalGb,
        gpuJob: spec.gpu ? gpuJob : null,
        activeCores,
        significantJobs,
        orchState,
        orchPid,
        health,
        ageSeconds: row?.age_seconds,
      };
    }).filter((c): c is MachineCard => c !== null);
  }, [status, statusByMachine]);

  // Fleet summary numbers
  const fleetSummary = useMemo(() => {
    const gpuMachines = machineCards.filter(c => c.spec.gpu);
    const gpuAvg = gpuMachines.length > 0
      ? gpuMachines.reduce((s, c) => s + (c.gpuUtil ?? 0), 0) / gpuMachines.length
      : 0;
    const totalActiveCores = machineCards.reduce((s, c) => s + c.activeCores, 0);

    // Find newest checkin
    let newestAge: number | null = null;
    for (const c of machineCards) {
      if (c.ageSeconds != null && (newestAge === null || c.ageSeconds < newestAge)) {
        newestAge = c.ageSeconds;
      }
    }

    return {
      gpuAvg,
      gpuCount: gpuMachines.length,
      activeCores: totalActiveCores,
      totalCores: CPU_TOTAL_CORES,
      newestAge,
    };
  }, [machineCards]);

  // Running jobs for the pipeline table (all machines, all types)
  const runningJobs = useMemo(() => {
    const jobs: Array<{
      name: string;
      machine: string;
      type: "GPU" | "CPU";
      cpuPct: number | null;
      elapsed: string;
      isGpu?: boolean;
    }> = [];

    for (const card of machineCards) {
      // GPU job — extract elapsed from heartbeat data
      if (card.spec.gpu && card.gpuJob && card.gpuJob !== "polling" && card.gpuJob !== "unknown") {
        let gpuElapsed = "--";
        const heartbeats = card.row?.heartbeats || {};
        for (const hb of Object.values(heartbeats)) {
          if (hb?.state === "running") {
            // Use elapsed_minutes from heartbeat if available (written by sweep_queue.py)
            if (hb.elapsed_minutes != null) {
              const mins = Math.round(hb.elapsed_minutes);
              if (mins >= 60) {
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                gpuElapsed = `${h}h ${m}m`;
              } else {
                gpuElapsed = `${mins}m`;
              }
            } else if (hb.timestamp) {
              // Fallback: compute from heartbeat timestamp vs now
              const hbTs = Date.parse(hb.timestamp);
              if (Number.isFinite(hbTs)) {
                const ageSec = (Date.now() - hbTs) / 1000;
                // The heartbeat timestamp is "when last updated", not "when started".
                // If it's recent (< 5min old), the job is still running but we
                // don't know total elapsed. Show "running" instead of misleading time.
                gpuElapsed = ageSec < 300 ? "running" : "--";
              }
            }
            break;
          }
        }
        jobs.push({
          name: card.gpuJob,
          machine: card.name,
          type: "GPU",
          cpuPct: null,
          elapsed: gpuElapsed,
          isGpu: true,
        });
      }
      // CPU jobs (already filtered to >= 1%)
      for (const j of card.significantJobs) {
        jobs.push({
          name: j.script || "unknown",
          machine: card.name,
          type: "CPU",
          cpuPct: j.cpu_pct ?? null,
          elapsed: fmtElapsed(j.elapsed),
        });
      }
    }

    return jobs;
  }, [machineCards]);

  // Recently completed jobs (merged GPU results + CPU jobs)
  const recentCompleted = useMemo(() => {
    const items: Array<{
      name: string;
      machine: string;
      type: "GPU" | "CPU";
      status: string;
      duration: string;
      completedAt: string;
      sortKey: number;
    }> = [];

    const results = mergedOrchestrator?.recent_results ?? [];
    for (const r of results) {
      const ts = parseIsoMillis(r.collected_at);
      items.push({
        name: r.name || "--",
        machine: r.machine || "--",
        type: "GPU",
        status: (r.profitable ?? 0) > 0 ? "profitable" : "completed",
        duration: r.configs ? `${r.configs} configs` : "--",
        completedAt: timeAgo(r.collected_at),
        sortKey: ts ?? 0,
      });
    }

    const cpuJobs = mergedOrchestrator?.recent_cpu_jobs ?? [];
    for (const j of cpuJobs) {
      const ts = parseIsoMillis(j.completed_at);
      items.push({
        name: j.name || "--",
        machine: j.machine || "--",
        type: "CPU",
        status: j.status || "unknown",
        duration: j.elapsed_min != null ? `${j.elapsed_min.toFixed(1)}m` : "--",
        completedAt: timeAgo(j.completed_at),
        sortKey: ts ?? 0,
      });
    }

    items.sort((a, b) => b.sortKey - a.sortKey);
    return items.slice(0, 20);
  }, [mergedOrchestrator]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading && !util) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
        <div className="max-w-7xl mx-auto">Loading fleet utilization...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
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

      <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        {error && (
          <div className="rounded border border-red-600/40 bg-red-950/40 text-red-300 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {/* ================================================================
            SECTION 1: Fleet Summary Bar
            ================================================================ */}
        <section className="rounded border border-gray-800 bg-gray-900 px-3 py-1.5 flex items-center gap-2 text-xs">
          {/* GPU live + attainment triplet */}
          <span className="flex items-center gap-1">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
              fleetSummary.gpuAvg >= 30 ? "bg-emerald-400" :
              fleetSummary.gpuAvg >= 10 ? "bg-amber-400" : "bg-gray-500"
            }`} />
            <span className="text-gray-500">GPU</span>
            <span className={`font-medium tabular-nums ${pctColor(fleetSummary.gpuAvg)}`}>
              {fmtPct(fleetSummary.gpuAvg)}
            </span>
            {util && (<>
              <span className="text-gray-700">/</span>
              <span className={`tabular-nums ${pctColor(util.trailing.hour?.fleet_attainment_pct ?? 0)}`}>
                {fmtPct(util.trailing.hour?.fleet_attainment_pct ?? 0)}
              </span>
              <span className="text-gray-700">/</span>
              <span className={`tabular-nums ${pctColor(util.trailing.day.fleet_attainment_pct)}`}>
                {fmtPct(util.trailing.day.fleet_attainment_pct)}
              </span>
            </>)}
          </span>
          <span className="text-gray-700">|</span>
          {/* CPU live + attainment triplet */}
          <span className="flex items-center gap-1">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
              fleetSummary.activeCores >= 5 ? "bg-emerald-400" :
              fleetSummary.activeCores >= 1 ? "bg-amber-400" : "bg-gray-500"
            }`} />
            <span className="text-gray-500">CPU</span>
            <span className={`font-medium tabular-nums ${fleetSummary.activeCores >= 1 ? "text-emerald-300" : "text-gray-500"}`}>
              {fleetSummary.activeCores.toFixed(0)}/{fleetSummary.totalCores}
            </span>
            {cpuUtil?.trailing && (<>
              <span className="text-gray-700">/</span>
              <span className={`tabular-nums ${pctColor(((cpuUtil.trailing.hour?.avg_cores ?? 0) / CPU_TOTAL_CORES) * 100)}`}>
                {fmtPct(((cpuUtil.trailing.hour?.avg_cores ?? 0) / CPU_TOTAL_CORES) * 100)}
              </span>
              <span className="text-gray-700">/</span>
              <span className={`tabular-nums ${pctColor(((cpuUtil.trailing.day?.avg_cores ?? 0) / CPU_TOTAL_CORES) * 100)}`}>
                {fmtPct(((cpuUtil.trailing.day?.avg_cores ?? 0) / CPU_TOTAL_CORES) * 100)}
              </span>
            </>)}
            <span className="text-gray-600 text-[9px]">1m/1h/24h</span>
          </span>
          <span className={`tabular-nums ${ageClass(fleetSummary.newestAge)}`}>
            {fmtAge(fleetSummary.newestAge)}
          </span>
        </section>

        {/* ================================================================
            SECTION 2: Per-Machine Cards (2x2 grid)
            ================================================================ */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {machineCards.map((card) => {
            const spec = card.spec;
            const hasGpu = !!spec.gpu;

            return (
              <div
                key={card.name}
                className={`rounded border bg-gray-900 ${
                  card.isStale ? "border-red-800/60" : "border-gray-800"
                }`}
              >
                {/* Card header */}
                <div className="px-3 py-1.5 border-b border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">{card.name}</span>
                    {hasGpu && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 font-medium">
                        {spec.gpu}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{spec.cpu} {spec.cores} cores</span>
                    <span className={ageClass(card.ageSeconds)}>
                      {fmtAge(card.ageSeconds)}
                    </span>
                    {card.isStale && (
                      <span className="text-red-400 font-medium">STALE</span>
                    )}
                  </div>
                </div>

                <div className="px-3 py-2 space-y-2">
                  {/* GPU row */}
                  {hasGpu && (
                    <div>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-gray-400">GPU</span>
                        <span className="tabular-nums">
                          <span className={pctColor(card.gpuUtil ?? undefined)}>
                            {card.gpuUtil != null ? `${card.gpuUtil.toFixed(0)}%` : "--"}
                          </span>
                          {card.gpuTemp != null && (
                            <span className={`ml-2 ${tempColor(card.gpuTemp)}`}>{card.gpuTemp}°C</span>
                          )}
                          {card.vramUsedGb != null && card.vramTotalGb != null && (
                            <span className="ml-2 text-gray-400">
                              {card.vramUsedGb.toFixed(1)}/{card.vramTotalGb}G VRAM
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            (card.gpuUtil ?? 0) > 0 ? "fleet-speed-bar" : "bg-gray-700"
                          }`}
                          style={{
                            width: `${Math.max(2, card.gpuUtil ?? 0)}%`,
                            ...(card.gpuUtil && card.gpuUtil > 0 ? { animationDuration: `${Math.max(0.45, 2.6 - card.gpuUtil / 55)}s` } : {}),
                          }}
                        />
                      </div>
                      {card.gpuJob && card.gpuJob !== "polling" && card.gpuJob !== "unknown" && (
                        <div className="text-[10px] text-cyan-400 mt-0.5 truncate font-mono" title={card.gpuJob}>
                          {card.gpuJob}
                        </div>
                      )}
                    </div>
                  )}

                  {/* CPU row */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-gray-400">CPU</span>
                      <span className={`tabular-nums ${card.activeCores >= 1 ? "text-emerald-300" : "text-gray-500"}`}>
                        {card.activeCores.toFixed(1)}/{spec.cores} cores active
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          card.activeCores > 0 ? "cpu-speed-bar" : "bg-gray-700"
                        }`}
                        style={{
                          width: `${Math.max(2, Math.min(100, (card.activeCores / spec.cores) * 100))}%`,
                          ...(card.activeCores > 0 ? { animationDuration: `${Math.max(0.45, 2.6 - (card.activeCores / spec.cores) * 100 / 55)}s` } : {}),
                        }}
                      />
                    </div>
                  </div>

                  {/* Process list (only > 1% CPU) */}
                  {card.significantJobs.length > 0 && card.significantJobs.length <= 2 && (
                    <div className="space-y-0">
                      {card.significantJobs.map((job, i) => (
                        <div key={i} className="flex items-center justify-between text-xs py-0.5">
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-1 h-1 rounded-full bg-emerald-400" />
                            <span className="text-emerald-300 font-mono truncate max-w-[180px]" title={job.script || undefined}>
                              {job.script || "unknown"}
                            </span>
                          </span>
                          <span className="text-gray-500 tabular-nums whitespace-nowrap ml-2">
                            {(job.cpu_pct ?? 0).toFixed(0)}%
                            {job.elapsed && <span className="text-gray-600 ml-1.5">{job.elapsed}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Summarized job list when 3+ jobs */}
                  {card.significantJobs.length >= 3 && (() => {
                    const counts = new Map<string, number>();
                    for (const j of card.significantJobs) {
                      const name = j.script || "unknown";
                      counts.set(name, (counts.get(name) ?? 0) + 1);
                    }
                    const groups = Array.from(counts.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, count]) => count > 1 ? `${count} ${name}` : name);
                    return (
                      <div className="text-xs text-emerald-300/80 font-mono py-0.5 leading-snug">
                        <span className="inline-block w-1 h-1 rounded-full bg-emerald-400 mr-1.5 align-middle" />
                        {card.significantJobs.length} CPU jobs
                        <span className="text-gray-500 mx-1">&middot;</span>
                        <span className="text-gray-400">{groups.join(" + ")}</span>
                      </div>
                    );
                  })()}

                  {/* Orchestrator info for mac */}
                  {card.orchState && card.name === "mac" && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                        card.orchState === "collecting" ? "bg-cyan-400 animate-pulse" :
                        card.orchState === "cpu_job" ? "bg-emerald-400 animate-pulse" :
                        "bg-gray-600"
                      }`} />
                      <span>Orchestrator: {card.orchState}</span>
                      {card.orchPid && <span className="text-gray-600">PID {card.orchPid}</span>}
                    </div>
                  )}

                  {/* Stale warning */}
                  {card.isStale && (
                    <div className="text-[10px] text-red-400/80 mt-0.5">
                      No checkin for {fmtAge(card.ageSeconds)} -- data may be stale
                    </div>
                  )}

                  {/* Empty state */}
                  {card.significantJobs.length === 0 && !card.isStale && (card.gpuJob === "polling" || card.gpuJob === "unknown" || !card.gpuJob) && card.activeCores < 1 && (
                    <div className="text-[10px] text-gray-600">idle</div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* ================================================================
            SECTION 3: Research Pipeline
            ================================================================ */}
        {(runningJobs.length > 0 || recentCompleted.length > 0) && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Currently Running */}
            {runningJobs.length > 0 && (
              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-1.5 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>Currently Running</span>
                  <span className="text-xs text-gray-500 font-normal">{runningJobs.length} jobs</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-800">
                        <th className="text-left px-3 py-1.5">Job</th>
                        <th className="text-left px-3 py-1.5">Machine</th>
                        <th className="text-center px-3 py-1.5">Type</th>
                        <th className="text-right px-3 py-1.5">Load</th>
                        <th className="text-right px-3 py-1.5">Elapsed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runningJobs.map((j, i) => (
                        <tr key={`rj-${i}`} className="border-b border-gray-800/50">
                          <td className="px-3 py-1.5 text-gray-300 max-w-[220px] truncate font-mono" title={j.name}>
                            {j.name}
                          </td>
                          <td className="px-3 py-1.5 text-gray-400">{j.machine}</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              j.type === "GPU" ? "bg-purple-900/50 text-purple-300" : "bg-emerald-900/50 text-emerald-300"
                            }`}>
                              {j.type}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-300" title={j.cpuPct != null && j.cpuPct > 100 ? `${j.cpuPct.toFixed(0)}% = using ${(j.cpuPct/100).toFixed(1)} cores` : undefined}>
                            {j.cpuPct != null ? (
                              j.cpuPct > 100
                                ? <>{(j.cpuPct/100).toFixed(1)} <span className="text-gray-500 text-[10px]">cores</span></>
                                : `${j.cpuPct.toFixed(0)}%`
                            ) : j.isGpu ? (
                              <span className="text-purple-400 text-[10px]">GPU</span>
                            ) : "--"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                            {j.elapsed}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recently Completed */}
            {recentCompleted.length > 0 && (
              <div className="rounded border border-gray-800 bg-gray-900">
                <div className="px-3 py-1.5 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
                  <span>Recently Completed</span>
                  <span className="text-xs text-gray-500 font-normal">
                    {mergedOrchestrator?.completed_count ? `${mergedOrchestrator.completed_count} total` : ""}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500 sticky top-0 bg-gray-900">
                      <tr className="border-b border-gray-800">
                        <th className="text-left px-3 py-1.5">Job</th>
                        <th className="text-left px-3 py-1.5">Machine</th>
                        <th className="text-center px-3 py-1.5">Type</th>
                        <th className="text-left px-3 py-1.5">Status</th>
                        <th className="text-right px-3 py-1.5">Duration</th>
                        <th className="text-right px-3 py-1.5">Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentCompleted.map((j, i) => (
                        <tr key={`rc-${i}`} className="border-b border-gray-800/50">
                          <td className="px-3 py-1.5 text-gray-300 max-w-[200px] truncate" title={j.name}>
                            {j.name}
                          </td>
                          <td className="px-3 py-1.5 text-gray-400">
                            {j.machine.replace("-pc", "")}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              j.type === "GPU" ? "bg-purple-900/50 text-purple-300" : "bg-emerald-900/50 text-emerald-300"
                            }`}>
                              {j.type}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={
                              j.status === "completed" ? "text-emerald-400" :
                              j.status === "profitable" ? "text-emerald-300 font-medium" :
                              j.status === "timeout" ? "text-amber-400" :
                              j.status === "failed" ? "text-red-400" :
                              "text-gray-500"
                            }>
                              {j.status}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">
                            {j.duration}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                            {j.completedAt}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* GPU Pipeline (queue progress per machine) */}
        {mergedOrchestrator?.gpu_pipeline && Object.keys(mergedOrchestrator.gpu_pipeline).length > 0 && (
          <section className="rounded border border-gray-800 bg-gray-900">
            <div className="px-3 py-1.5 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
              <span className="flex items-center gap-2">
                GPU Queue Progress
                <span className="text-xs font-normal text-gray-500">sweep queue depth</span>
              </span>
              <span className="text-xs text-gray-500 flex items-center gap-2">
                {(mergedOrchestrator.fleet_health?.retry_queue_size ?? mergedOrchestrator.retry_queue_size ?? 0) > 0 && (
                  <span className="text-amber-300">
                    {mergedOrchestrator.fleet_health?.retry_queue_size ?? mergedOrchestrator.retry_queue_size} retries
                  </span>
                )}
                {mergedOrchestrator.fleet_health?.idle_gpu_alert && (
                  <span className="text-amber-300">{mergedOrchestrator.fleet_health.idle_gpu_alert} idle</span>
                )}
              </span>
            </div>
            <div className="px-3 py-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(mergedOrchestrator.gpu_pipeline).map(([machine, info]) => {
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
                      {info.job || "--"}
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

        {/* Pending queue */}
        {mergedOrchestrator?.pending_queue && mergedOrchestrator.pending_queue.length > 0 && (
          <section className="rounded border border-gray-800 bg-gray-900">
            <div className="px-3 py-1.5 border-b border-gray-800 text-sm font-medium text-gray-300 flex items-center justify-between">
              <span>Pending Queue</span>
              <span className="text-xs text-gray-500 font-normal">{mergedOrchestrator.pending_queue.length} queued</span>
            </div>
            <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500 sticky top-0 bg-gray-900">
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-3 py-1">Experiment</th>
                    <th className="text-left px-3 py-1">Target</th>
                    <th className="text-left px-3 py-1">P</th>
                    <th className="text-left px-3 py-1">Hypothesis</th>
                  </tr>
                </thead>
                <tbody>
                  {mergedOrchestrator.pending_queue.map((p, i) => (
                    <tr key={`pend-${i}`} className="border-b border-gray-800/30">
                      <td className="px-3 py-1 text-gray-400 max-w-[180px] truncate" title={p.name}>
                        {p.name || "--"}
                      </td>
                      <td className="px-3 py-1 text-gray-500">
                        {(p.target_machine || "--").replace("-pc", "")}
                      </td>
                      <td className="px-3 py-1 text-gray-600">
                        P{p.priority ?? "?"}
                      </td>
                      <td className="px-3 py-1 text-gray-600 max-w-[300px] truncate" title={p.hypothesis || undefined}>
                        {p.hypothesis || "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ================================================================
            SECTION 4: Historical Utilization Tables (GPU Daily, GPU Weekly, CPU Daily)
            ================================================================ */}
        {util && (
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
                <span className="text-xs text-gray-500 font-normal">
                  {CPU_TOTAL_CORES} total cores · latest first
                </span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                {cpuUtil?.daily && cpuUtil.daily.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr className="border-b border-gray-800 sticky top-0 bg-gray-900">
                        <th className="text-left px-2 py-1.5">Date</th>
                        <th className="text-right px-2 py-1.5">Avg Cores</th>
                        <th className="text-right px-2 py-1.5">Peak</th>
                        <th className="text-right px-2 py-1.5">Core-h</th>
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
        )}
      </main>

      <style jsx>{`
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
