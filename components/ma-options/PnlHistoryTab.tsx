"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PositionLineage {
  model_version?: string;
  model_type?: string;
  signal?: { probability?: number; direction?: string };
}

interface Position {
  position_id: string;
  user_id: string;
  status: "active" | "closed";
  strategy_type?: string;
  parent_strategy?: string;
  symbol: string;
  sec_type?: string;
  strike?: number;
  expiry?: string;
  right_type?: string;
  entry_price?: number;
  entry_quantity?: number;
  entry_time?: string;
  exit_reason?: string | null;
  closed_at?: string | null;
  total_gross_pnl?: number | null;
  total_commission?: number | null;
  total_net_pnl?: number | null;
  multiplier?: number;
  model_version?: string;
  lineage?: PositionLineage;
  risk_config?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  agent_created_at?: string;
}

interface PositionsResponse {
  positions: Position[];
  total_count: number;
  limit: number;
  offset: number;
}

interface SummaryRow {
  group_key: string;
  trades: number;
  wins: number;
  win_rate: number;
  total_gross_pnl: number;
  total_commission: number;
  total_net_pnl: number;
}

interface SummaryResponse {
  summary: SummaryRow[];
  totals: {
    trades: number;
    wins: number;
    win_rate: number;
    total_gross_pnl: number;
    total_commission: number;
    total_net_pnl: number;
  };
}

interface FillRow {
  fill_index?: number;
  fill_time?: string;
  order_id?: number;
  exec_id?: string;
  level?: string;
  qty_filled?: number;
  avg_price?: number;
  remaining_qty?: number;
  pnl_pct?: number;
  commission?: number | null;
  realized_pnl_ib?: number | null;
  fill_exchange?: string;
  slippage?: number | null;
  last_liquidity?: number | null;
}

interface FillDetailResponse {
  position_id: string;
  fills: FillRow[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt$(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}

function pnlColor(v: number | null | undefined): string {
  if (v == null || v === 0) return "text-gray-400";
  return v > 0 ? "text-green-400" : "text-red-400";
}

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtExpiry(yyyymmdd: string | undefined | null): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || "—";
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = yyyymmdd.slice(6, 8);
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
  ];
  return `${months[m - 1]} ${d}`;
}

function fmtDuration(openIso: string | undefined | null, closeIso: string | undefined | null): string {
  if (!openIso) return "—";
  if (!closeIso) return "active";
  const ms = new Date(closeIso).getTime() - new Date(openIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `${hrs}h ${rem}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function truncateModel(v: string | undefined | null): string {
  if (!v) return "—";
  // v_20260227_071717 → v_0227_0717
  if (v.startsWith("v_") && v.length >= 18) {
    return `v_${v.slice(6, 10)}_${v.slice(11, 15)}`;
  }
  if (v.length > 16) return v.slice(0, 14) + "…";
  return v;
}

// ---------------------------------------------------------------------------
// Column definitions — module-level (avoids re-creation in component)
// ---------------------------------------------------------------------------

const POSITION_COLUMNS: ColumnDef[] = [
  { key: "symbol", label: "Symbol" },
  { key: "strike", label: "Strike" },
  { key: "expiry", label: "Expiry" },
  { key: "entry", label: "Entry" },
  { key: "qty", label: "Qty" },
  { key: "status", label: "Status" },
  { key: "exit", label: "Exit" },
  { key: "gross_pnl", label: "Gross P&L" },
  { key: "commission", label: "Comm" },
  { key: "net_pnl", label: "Net P&L" },
  { key: "model", label: "Model" },
  { key: "signal", label: "Signal" },
  { key: "opened", label: "Opened" },
  { key: "duration", label: "Duration" },
];

const POSITION_DEFAULTS = [
  "symbol", "strike", "expiry", "entry", "qty", "status",
  "net_pnl", "model", "opened",
];
const POSITION_LOCKED = ["symbol"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type GroupBy = "date" | "symbol" | "model_version";
type StatusFilter = "all" | "active" | "closed";

export default function PnlHistoryTab() {
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();

  // Column chooser state
  const savedCols = getVisibleColumns("pnlHistory");
  const visibleKeys = useMemo(() => savedCols ?? POSITION_DEFAULTS, [savedCols]);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const handleColsChange = useCallback(
    (keys: string[]) => setVisibleColumns("pnlHistory", keys),
    [setVisibleColumns],
  );

  // Filters
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  // Default to "all" with no date filters so historical data shows immediately
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Data
  const [positions, setPositions] = useState<Position[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [posLoading, setPosLoading] = useState(false);
  const [sumLoading, setSumLoading] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [sumError, setSumError] = useState<string | null>(null);

  // Expand state for fill detail
  const [expandedPos, setExpandedPos] = useState<Set<string>>(new Set());
  const [fillCache, setFillCache] = useState<Record<string, FillRow[]>>({});
  const [fillLoading, setFillLoading] = useState<Set<string>>(new Set());

  // Summary row filter → position table
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetchers
  // ---------------------------------------------------------------------------

  const fetchPositions = useCallback(async () => {
    setPosLoading(true);
    setPosError(null);
    try {
      const params = new URLSearchParams({ endpoint: "positions", limit: "500" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await fetch(`/api/ma-options/execution/pnl-history?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data: PositionsResponse = await res.json();
      setPositions(data.positions || []);
      setTotalCount(data.total_count ?? data.positions?.length ?? 0);
    } catch (e: unknown) {
      setPosError(e instanceof Error ? e.message : "Failed to load positions");
    } finally {
      setPosLoading(false);
    }
  }, [statusFilter, dateFrom, dateTo]);

  const fetchSummary = useCallback(async () => {
    setSumLoading(true);
    setSumError(null);
    try {
      const params = new URLSearchParams({ endpoint: "summary", group_by: groupBy });
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await fetch(`/api/ma-options/execution/pnl-history?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data: SummaryResponse = await res.json();
      setSummary(data);
    } catch (e: unknown) {
      setSumError(e instanceof Error ? e.message : "Failed to load summary");
    } finally {
      setSumLoading(false);
    }
  }, [groupBy, dateFrom, dateTo]);

  // Fetch on mount + filter change
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const fetchFills = useCallback(async (positionId: string) => {
    if (fillCache[positionId]) return;
    setFillLoading((prev) => new Set(prev).add(positionId));
    try {
      const res = await fetch(`/api/ma-options/execution/pnl-history/${encodeURIComponent(positionId)}`);
      if (!res.ok) return;
      const data: FillDetailResponse = await res.json();
      setFillCache((prev) => ({ ...prev, [positionId]: data.fills || [] }));
    } finally {
      setFillLoading((prev) => {
        const next = new Set(prev);
        next.delete(positionId);
        return next;
      });
    }
  }, [fillCache]);

  // ---------------------------------------------------------------------------
  // Expand toggle
  // ---------------------------------------------------------------------------

  const toggleExpand = useCallback(
    (positionId: string) => {
      setExpandedPos((prev) => {
        const next = new Set(prev);
        if (next.has(positionId)) {
          next.delete(positionId);
        } else {
          next.add(positionId);
          fetchFills(positionId);
        }
        return next;
      });
    },
    [fetchFills],
  );

  // ---------------------------------------------------------------------------
  // Filtered positions (when a summary row is clicked)
  // ---------------------------------------------------------------------------

  const filteredPositions = useMemo(() => {
    if (!activeGroup) return positions;
    return positions.filter((p) => {
      if (groupBy === "date") {
        const posDate = p.created_at ? p.created_at.slice(0, 10) : "";
        return posDate === activeGroup;
      }
      if (groupBy === "symbol") return p.symbol === activeGroup;
      if (groupBy === "model_version") return (p.model_version || "") === activeGroup;
      return true;
    });
  }, [positions, activeGroup, groupBy]);

  // ---------------------------------------------------------------------------
  // Totals (from summary response or computed)
  // ---------------------------------------------------------------------------

  const totals = summary?.totals;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isLoading = posLoading || sumLoading;

  const exitBadge = (reason: string | null | undefined) => {
    if (!reason) return <span className="text-gray-600">—</span>;
    const map: Record<string, { bg: string; text: string; label: string }> = {
      risk_exit: { bg: "bg-blue-900/40", text: "text-blue-400", label: "Risk" },
      expired_worthless: { bg: "bg-red-900/40", text: "text-red-400", label: "Expired" },
      manual_close: { bg: "bg-gray-700", text: "text-gray-300", label: "Manual" },
    };
    const m = map[reason] || { bg: "bg-gray-700", text: "text-gray-300", label: reason };
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${m.bg} ${m.text}`}>
        {m.label}
      </span>
    );
  };

  const levelBadge = (level: string | undefined) => {
    if (!level) return null;
    const map: Record<string, { bg: string; text: string }> = {
      entry: { bg: "bg-blue-900/40", text: "text-blue-400" },
      trailing: { bg: "bg-green-900/40", text: "text-green-400" },
      expired_worthless: { bg: "bg-red-900/40", text: "text-red-400" },
    };
    const m = map[level] || { bg: "bg-gray-700", text: "text-gray-300" };
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${m.bg} ${m.text}`}>
        {level}
      </span>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-3">
      {/* ── Filters Row ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Status:</span>
          {(["closed", "active", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setActiveGroup(null); }}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Group by */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Group:</span>
          {(["date", "symbol", "model_version"] as GroupBy[]).map((g) => (
            <button
              key={g}
              onClick={() => { setGroupBy(g); setActiveGroup(null); }}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                groupBy === g
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {g === "model_version" ? "Model" : g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">From:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setActiveGroup(null); }}
            className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-1.5 py-1 inline-edit"
          />
          <span className="text-xs text-gray-500">To:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setActiveGroup(null); }}
            className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-1.5 py-1 inline-edit"
          />
        </div>

        {/* Refresh */}
        <button
          onClick={() => { fetchPositions(); fetchSummary(); }}
          disabled={isLoading}
          className="ml-auto px-2 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ── Errors ── */}
      {(posError || sumError) && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm px-3 py-1.5 rounded">
          {posError || sumError}
        </div>
      )}

      {/* ── Summary Totals Bar ── */}
      {totals && (
        <div className="flex items-center gap-4 text-sm bg-gray-900 border border-gray-800 rounded px-3 py-2">
          <div>
            <span className="text-gray-500 text-xs">Trades</span>
            <span className="ml-1 text-gray-200 font-mono">{totals.trades}</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Win Rate</span>
            <span className={`ml-1 font-mono ${totals.win_rate > 50 ? "text-green-400" : totals.win_rate > 0 ? "text-red-400" : "text-gray-400"}`}>
              {fmtPct(totals.win_rate)}
            </span>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Gross</span>
            <span className={`ml-1 font-mono ${pnlColor(totals.total_gross_pnl)}`}>
              {fmt$(totals.total_gross_pnl)}
            </span>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Comm</span>
            <span className="ml-1 font-mono text-gray-400">
              {fmt$(totals.total_commission)}
            </span>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Net</span>
            <span className={`ml-1 font-mono font-bold ${pnlColor(totals.total_net_pnl)}`}>
              {fmt$(totals.total_net_pnl)}
            </span>
          </div>
          <span className="ml-auto text-xs text-gray-600">
            {totalCount} position{totalCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* ── Summary Group Table ── */}
      {summary && summary.summary.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 text-gray-400 border-b border-gray-700">
                <th className="text-left py-1.5 px-3 text-xs font-medium">
                  {groupBy === "date" ? "Date" : groupBy === "symbol" ? "Symbol" : "Model"}
                </th>
                <th className="text-right py-1.5 px-3 text-xs font-medium">Trades</th>
                <th className="text-right py-1.5 px-3 text-xs font-medium">Wins</th>
                <th className="text-right py-1.5 px-3 text-xs font-medium">Win Rate</th>
                <th className="text-right py-1.5 px-3 text-xs font-medium">Gross P&L</th>
                <th className="text-right py-1.5 px-3 text-xs font-medium">Comm</th>
                <th className="text-right py-1.5 px-3 text-xs font-medium">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {summary.summary.map((row) => {
                const isActive = activeGroup === row.group_key;
                return (
                  <tr
                    key={row.group_key}
                    onClick={() => setActiveGroup(isActive ? null : row.group_key)}
                    className={`border-b border-gray-800 cursor-pointer transition-colors ${
                      isActive ? "bg-blue-900/20" : "hover:bg-gray-800/50"
                    }`}
                  >
                    <td className="py-1.5 px-3 text-gray-200 font-mono text-xs">
                      {groupBy === "model_version" ? truncateModel(row.group_key) : row.group_key}
                    </td>
                    <td className="py-1.5 px-3 text-right text-gray-300 font-mono">{row.trades}</td>
                    <td className="py-1.5 px-3 text-right text-gray-300 font-mono">{row.wins}</td>
                    <td className={`py-1.5 px-3 text-right font-mono ${row.win_rate > 50 ? "text-green-400" : "text-gray-400"}`}>
                      {fmtPct(row.win_rate)}
                    </td>
                    <td className={`py-1.5 px-3 text-right font-mono ${pnlColor(row.total_gross_pnl)}`}>
                      {fmt$(row.total_gross_pnl)}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-gray-400">
                      {fmt$(row.total_commission)}
                    </td>
                    <td className={`py-1.5 px-3 text-right font-mono font-bold ${pnlColor(row.total_net_pnl)}`}>
                      {fmt$(row.total_net_pnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Active group indicator */}
      {activeGroup && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">Filtering positions by:</span>
          <span className="px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded font-mono">
            {groupBy === "model_version" ? truncateModel(activeGroup) : activeGroup}
          </span>
          <button
            onClick={() => setActiveGroup(null)}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* ── Position Detail Table ── */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-medium text-gray-300">
          Positions ({filteredPositions.length})
        </h3>
        <div className="ml-auto">
          <ColumnChooser
            columns={POSITION_COLUMNS}
            visible={visibleKeys}
            defaults={POSITION_DEFAULTS}
            onChange={handleColsChange}
            locked={POSITION_LOCKED}
          />
        </div>
      </div>

      {filteredPositions.length === 0 && !posLoading ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          {positions.length === 0
            ? "No trade history yet. Positions will appear here once the algo engine completes trades."
            : "No positions match the current filter."}
        </div>
      ) : (
        <div
          className="overflow-x-auto d-table-wrap"
          style={{ "--visible-cols": visibleKeys.length } as React.CSSProperties}
        >
          <table className="w-full text-sm d-table">
            <thead>
              <tr className="bg-gray-800/50 text-gray-400 border-b border-gray-700">
                {/* Expand toggle column */}
                <th className="w-6 py-1.5 px-1" />
                {visibleSet.has("symbol") && (
                  <th className="text-left py-1.5 px-3 text-xs font-medium">Symbol</th>
                )}
                {visibleSet.has("strike") && (
                  <th className="text-right py-1.5 px-3 text-xs font-medium">Strike</th>
                )}
                {visibleSet.has("expiry") && (
                  <th className="text-left py-1.5 px-3 text-xs font-medium">Expiry</th>
                )}
                {visibleSet.has("entry") && (
                  <th className="text-right py-1.5 px-3 text-xs font-medium">Entry</th>
                )}
                {visibleSet.has("qty") && (
                  <th className="text-right py-1.5 px-3 text-xs font-medium">Qty</th>
                )}
                {visibleSet.has("status") && (
                  <th className="text-center py-1.5 px-3 text-xs font-medium">Status</th>
                )}
                {visibleSet.has("exit") && (
                  <th className="text-center py-1.5 px-3 text-xs font-medium">Exit</th>
                )}
                {visibleSet.has("gross_pnl") && (
                  <th className="text-right py-1.5 px-3 text-xs font-medium">Gross P&L</th>
                )}
                {visibleSet.has("commission") && (
                  <th className="text-right py-1.5 px-3 text-xs font-medium">Comm</th>
                )}
                {visibleSet.has("net_pnl") && (
                  <th className="text-right py-1.5 px-3 text-xs font-medium">Net P&L</th>
                )}
                {visibleSet.has("model") && (
                  <th className="text-left py-1.5 px-3 text-xs font-medium">Model</th>
                )}
                {visibleSet.has("signal") && (
                  <th className="text-right py-1.5 px-3 text-xs font-medium">Signal</th>
                )}
                {visibleSet.has("opened") && (
                  <th className="text-left py-1.5 px-3 text-xs font-medium">Opened</th>
                )}
                {visibleSet.has("duration") && (
                  <th className="text-right py-1.5 px-3 text-xs font-medium">Duration</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredPositions.map((pos) => {
                const isExpanded = expandedPos.has(pos.position_id);
                const fills = fillCache[pos.position_id];
                const isFillLoading = fillLoading.has(pos.position_id);
                const rightLabel = pos.right_type
                  ? pos.right_type.charAt(0).toUpperCase()
                  : "";
                // Column count for expanded fill row
                const colCount = visibleKeys.length + 1; // +1 for expand toggle

                return (
                  <Fragment key={pos.position_id}>
                    <tr
                      onClick={() => toggleExpand(pos.position_id)}
                      className={`border-b border-gray-800 cursor-pointer transition-colors ${
                        isExpanded ? "bg-gray-800/40" : "hover:bg-gray-800/30"
                      }`}
                    >
                      {/* Expand chevron */}
                      <td className="py-1.5 px-1 text-gray-500">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </td>
                      {visibleSet.has("symbol") && (
                        <td className="py-1.5 px-3 text-gray-200 font-mono font-medium">
                          {pos.symbol}
                        </td>
                      )}
                      {visibleSet.has("strike") && (
                        <td className="py-1.5 px-3 text-right text-gray-300 font-mono">
                          {pos.strike != null ? (
                            <>
                              {pos.strike}
                              {rightLabel && (
                                <span className={`ml-0.5 text-[10px] ${rightLabel === "C" ? "text-green-400" : "text-red-400"}`}>
                                  {rightLabel}
                                </span>
                              )}
                            </>
                          ) : "—"}
                        </td>
                      )}
                      {visibleSet.has("expiry") && (
                        <td className="py-1.5 px-3 text-gray-400 text-xs">
                          {fmtExpiry(pos.expiry)}
                        </td>
                      )}
                      {visibleSet.has("entry") && (
                        <td className="py-1.5 px-3 text-right text-gray-300 font-mono">
                          {pos.entry_price != null ? `$${pos.entry_price.toFixed(2)}` : "—"}
                        </td>
                      )}
                      {visibleSet.has("qty") && (
                        <td className="py-1.5 px-3 text-right text-gray-300 font-mono">
                          {pos.entry_quantity ?? "—"}
                        </td>
                      )}
                      {visibleSet.has("status") && (
                        <td className="py-1.5 px-3 text-center">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              pos.status === "active"
                                ? "bg-green-900/40 text-green-400"
                                : "bg-gray-700 text-gray-300"
                            }`}
                          >
                            {pos.status}
                          </span>
                        </td>
                      )}
                      {visibleSet.has("exit") && (
                        <td className="py-1.5 px-3 text-center">
                          {exitBadge(pos.exit_reason)}
                        </td>
                      )}
                      {visibleSet.has("gross_pnl") && (
                        <td className={`py-1.5 px-3 text-right font-mono ${pnlColor(pos.total_gross_pnl)}`}>
                          {fmt$(pos.total_gross_pnl)}
                        </td>
                      )}
                      {visibleSet.has("commission") && (
                        <td className="py-1.5 px-3 text-right font-mono text-gray-400">
                          {fmt$(pos.total_commission)}
                        </td>
                      )}
                      {visibleSet.has("net_pnl") && (
                        <td className={`py-1.5 px-3 text-right font-mono font-bold ${pnlColor(pos.total_net_pnl)}`}>
                          {fmt$(pos.total_net_pnl)}
                        </td>
                      )}
                      {visibleSet.has("model") && (
                        <td className="py-1.5 px-3 text-xs text-gray-500" title={pos.model_version || pos.lineage?.model_version || ""}>
                          <span className="font-mono">
                            {truncateModel(pos.model_version || pos.lineage?.model_version)}
                          </span>
                        </td>
                      )}
                      {visibleSet.has("signal") && (
                        <td className="py-1.5 px-3 text-right text-gray-400 font-mono text-xs">
                          {pos.lineage?.signal?.probability != null
                            ? `${(pos.lineage.signal.probability * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                      )}
                      {visibleSet.has("opened") && (
                        <td className="py-1.5 px-3 text-gray-400 text-xs">
                          {fmtDate(pos.created_at)}
                        </td>
                      )}
                      {visibleSet.has("duration") && (
                        <td className="py-1.5 px-3 text-right text-gray-500 text-xs font-mono">
                          {fmtDuration(pos.created_at, pos.closed_at)}
                        </td>
                      )}
                    </tr>

                    {/* ── Expanded: Fill detail ── */}
                    {isExpanded && (
                      <tr className="bg-gray-900/50">
                        <td colSpan={colCount} className="px-6 py-2">
                          {isFillLoading ? (
                            <div className="text-xs text-gray-500">Loading fills…</div>
                          ) : fills && fills.length > 0 ? (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500 border-b border-gray-700">
                                  <th className="text-left py-1 px-2 font-medium">Time</th>
                                  <th className="text-center py-1 px-2 font-medium">Level</th>
                                  <th className="text-right py-1 px-2 font-medium">Qty</th>
                                  <th className="text-right py-1 px-2 font-medium">Price</th>
                                  <th className="text-right py-1 px-2 font-medium">P&L %</th>
                                  <th className="text-right py-1 px-2 font-medium">Comm</th>
                                  <th className="text-left py-1 px-2 font-medium">Exchange</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fills.map((fill, idx) => (
                                  <tr key={fill.exec_id || idx} className="border-b border-gray-800/50">
                                    <td className="py-1 px-2 text-gray-400 font-mono">
                                      {fmtDateTime(fill.fill_time)}
                                    </td>
                                    <td className="py-1 px-2 text-center">
                                      {levelBadge(fill.level)}
                                    </td>
                                    <td className="py-1 px-2 text-right text-gray-300 font-mono">
                                      {fill.qty_filled ?? "—"}
                                    </td>
                                    <td className="py-1 px-2 text-right text-gray-300 font-mono">
                                      {fill.avg_price != null ? `$${fill.avg_price.toFixed(2)}` : "—"}
                                    </td>
                                    <td className={`py-1 px-2 text-right font-mono ${pnlColor(fill.pnl_pct)}`}>
                                      {fill.pnl_pct != null ? `${fill.pnl_pct >= 0 ? "+" : ""}${fill.pnl_pct.toFixed(1)}%` : "—"}
                                    </td>
                                    <td className="py-1 px-2 text-right font-mono text-gray-400">
                                      {fill.commission != null ? `$${fill.commission.toFixed(2)}` : "—"}
                                    </td>
                                    <td className="py-1 px-2 text-gray-500">
                                      {fill.fill_exchange || "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="text-xs text-gray-500">No fills recorded.</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
