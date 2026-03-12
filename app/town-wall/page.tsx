"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserMenu } from "@/components/UserMenu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityEntry = {
  timestamp: string;
  user_message: string;
  response: string;
  specialist: string;
  model: string;
  message_id: string;
};

type GpuInfo = {
  util: number | null;
  temp: number | null;
  mem_used: number | null;
};

type Heartbeat = {
  current_job: string | null;
  jobs_completed: number | null;
  jobs_remaining: number | null;
};

type FleetMachine = {
  machine: string;
  reachable: boolean;
  gpu: GpuInfo;
  heartbeats: Heartbeat;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPECIALIST_COLORS: Record<string, { bg: string; text: string }> = {
  autoloop: { bg: "bg-blue-500/20", text: "text-blue-400" },
  bmc_research: { bg: "bg-purple-500/20", text: "text-purple-400" },
  watchdog: { bg: "bg-red-500/20", text: "text-red-400" },
  cos: { bg: "bg-green-500/20", text: "text-green-400" },
  deal_intel: { bg: "bg-orange-500/20", text: "text-orange-400" },
  algo_trading: { bg: "bg-cyan-500/20", text: "text-cyan-400" },
  trading_engine: { bg: "bg-cyan-500/20", text: "text-cyan-400" },
  ops: { bg: "bg-gray-500/20", text: "text-gray-400" },
  krj_signals: { bg: "bg-blue-500/20", text: "text-blue-300" },
  system: { bg: "bg-gray-600/20", text: "text-gray-500" },
};

const ALL_SPECIALISTS = [
  "autoloop",
  "bmc_research",
  "cos",
  "deal_intel",
  "algo_trading",
  "trading_engine",
  "ops",
  "krj_signals",
  "watchdog",
];

const REFRESH_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 0) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function specialistStyle(specialist: string) {
  return SPECIALIST_COLORS[specialist] ?? SPECIALIST_COLORS.system;
}

function specialistLabel(specialist: string): string {
  return specialist.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// FleetStatusBar
// ---------------------------------------------------------------------------

function FleetStatusBar({ machines }: { machines: FleetMachine[] }) {
  if (!machines.length) return null;

  return (
    <div className="flex gap-3 flex-wrap">
      {machines.map((m) => {
        const online = m.reachable;
        const hb = m.heartbeats;
        const gpu = m.gpu;

        return (
          <div
            key={m.machine}
            className="flex-1 min-w-[200px] border border-zinc-800 rounded-md bg-zinc-900 px-3 py-2"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-zinc-100">
                {m.machine}
              </span>
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  online ? "bg-green-500" : "bg-red-500"
                }`}
                title={online ? "Reachable" : "Unreachable"}
              />
            </div>
            {online ? (
              <div className="text-xs text-zinc-400 space-y-0.5">
                {gpu.util != null && (
                  <div>
                    GPU {gpu.util}%{gpu.temp != null ? ` / ${gpu.temp}C` : ""}
                    {gpu.mem_used != null
                      ? ` / ${(gpu.mem_used / 1024).toFixed(1)}GB`
                      : ""}
                  </div>
                )}
                {hb.current_job ? (
                  <div className="truncate text-zinc-300">
                    {hb.current_job}
                  </div>
                ) : (
                  <div className="text-zinc-500">Idle</div>
                )}
                {(hb.jobs_completed != null || hb.jobs_remaining != null) && (
                  <div>
                    {hb.jobs_completed ?? 0} done
                    {hb.jobs_remaining != null
                      ? ` / ${hb.jobs_remaining} queued`
                      : ""}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">Offline</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityEntryRow
// ---------------------------------------------------------------------------

function ActivityEntryRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const style = specialistStyle(entry.specialist);
  const hasResponse =
    entry.response && entry.response.trim().length > 0;
  const responsePreview =
    hasResponse && entry.response.length > 280
      ? entry.response.slice(0, 280) + "..."
      : entry.response;

  return (
    <div className="border-b border-zinc-800/60 px-3 py-2 hover:bg-zinc-900/50 transition-colors">
      {/* Top row: timestamp + specialist + model */}
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-xs text-zinc-500 font-mono shrink-0 w-[60px]">
          {relativeTime(entry.timestamp)}
        </span>
        <span
          className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${style.bg} ${style.text} capitalize shrink-0`}
        >
          {specialistLabel(entry.specialist)}
        </span>
        {entry.model && entry.model !== "system" && (
          <span className="text-[11px] text-zinc-500 font-mono">
            {entry.model}
          </span>
        )}
      </div>

      {/* User message */}
      <div className="text-sm text-zinc-200 ml-[68px]">
        {entry.user_message}
      </div>

      {/* Collapsible response */}
      {hasResponse && (
        <div className="ml-[68px] mt-1">
          {!expanded ? (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors text-left"
            >
              <span className="line-clamp-3 whitespace-pre-wrap text-zinc-400">
                {responsePreview}
              </span>
              {entry.response.length > 280 && (
                <span className="text-zinc-500 hover:text-zinc-300 ml-1">
                  show more
                </span>
              )}
            </button>
          ) : (
            <div>
              <div className="text-xs text-zinc-400 whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                {entry.response}
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300 mt-1"
              >
                collapse
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TownWallPage() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [fleet, setFleet] = useState<FleetMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filterSpecialists, setFilterSpecialists] = useState<Set<string>>(
    new Set(),
  );
  const [searchText, setSearchText] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch activity
  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/cos/activity");
      if (!res.ok) throw new Error(`Activity fetch failed: ${res.status}`);
      const data = await res.json();
      setActivity(Array.isArray(data) ? data : data.entries ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch activity");
    }
  }, []);

  // Fetch fleet status
  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/status");
      if (!res.ok) return; // fleet is optional
      const data = await res.json();
      setFleet(
        Array.isArray(data) ? data : data.machines ?? data.status ?? [],
      );
    } catch {
      // Fleet status is nice-to-have, don't error the whole page
    }
  }, []);

  // Combined fetch
  const fetchAll = useCallback(async () => {
    await Promise.all([fetchActivity(), fetchFleet()]);
    setLastRefresh(new Date());
    setLoading(false);
  }, [fetchActivity, fetchFleet]);

  // Initial fetch + polling
  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(() => {
      if (!document.hidden) fetchAll();
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAll]);

  // Toggle specialist filter
  const toggleSpecialist = useCallback((s: string) => {
    setFilterSpecialists((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  // Filtered + sorted activity
  const filtered = useMemo(() => {
    let items = activity;

    // Specialist filter
    if (filterSpecialists.size > 0) {
      items = items.filter((e) => filterSpecialists.has(e.specialist));
    }

    // Text search
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      items = items.filter(
        (e) =>
          e.user_message?.toLowerCase().includes(q) ||
          e.response?.toLowerCase().includes(q) ||
          e.specialist?.toLowerCase().includes(q),
      );
    }

    // Newest first
    return [...items].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [activity, filterSpecialists, searchText]);

  // Unique specialists in current data (for highlighting active ones)
  const activeSpecialists = useMemo(
    () => new Set(activity.map((e) => e.specialist)),
    [activity],
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-zinc-400 hover:text-zinc-200 text-sm"
            >
              Home
            </Link>
            <span className="text-zinc-700">/</span>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Town Wall</h1>
              <p className="text-xs text-zinc-500">
                Sancho&apos;s continuous research feed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Auto-refresh indicator */}
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-[11px] text-zinc-500 font-mono">
                {lastRefresh
                  ? `${lastRefresh.toLocaleTimeString()}`
                  : "loading"}
              </span>
            </div>
            <UserMenu variant="dark" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 py-3">
        {/* Fleet status */}
        {fleet.length > 0 && (
          <div className="mb-3">
            <FleetStatusBar machines={fleet} />
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {/* Specialist pills */}
          <div className="flex items-center gap-1 flex-wrap">
            {ALL_SPECIALISTS.map((s) => {
              const style = specialistStyle(s);
              const isActive = filterSpecialists.has(s);
              const hasData = activeSpecialists.has(s);

              return (
                <button
                  key={s}
                  onClick={() => toggleSpecialist(s)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors capitalize ${
                    isActive
                      ? `${style.bg} ${style.text} border-current`
                      : hasData
                        ? `border-zinc-700 ${style.text} hover:border-zinc-500`
                        : "border-zinc-800 text-zinc-600 hover:border-zinc-700"
                  }`}
                >
                  {specialistLabel(s)}
                </button>
              );
            })}
            {filterSpecialists.size > 0 && (
              <button
                onClick={() => setFilterSpecialists(new Set())}
                className="text-[11px] px-2 py-0.5 text-zinc-500 hover:text-zinc-300"
              >
                clear
              </button>
            )}
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="ml-auto bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 w-48 focus:outline-none focus:border-zinc-600 no-density inline-edit"
          />
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-3 px-3 py-2 rounded border border-red-900/50 bg-red-950/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Activity timeline */}
        <div className="border border-zinc-800 rounded-md bg-zinc-900/50 overflow-hidden">
          {loading ? (
            <div className="px-3 py-8 text-center text-zinc-500 text-sm">
              Loading activity...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-zinc-500 text-sm">
              {activity.length === 0
                ? "No activity yet. Waiting for agent messages..."
                : "No entries match the current filters."}
            </div>
          ) : (
            <>
              <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {filtered.length} entries
                  {filterSpecialists.size > 0 || searchText
                    ? ` (${activity.length} total)`
                    : ""}
                </span>
              </div>
              <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                {filtered.map((entry) => (
                  <ActivityEntryRow
                    key={entry.message_id}
                    entry={entry}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
