"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";

// ---------------------------------------------------------------------------
// Types — reuse from SignalsTab data shapes
// ---------------------------------------------------------------------------

interface QuoteSnapshot {
  bid: number;
  ask: number;
  last: number;
  mid: number;
  bid_size: number;
  ask_size: number;
  volume: number;
  open_interest: number;
  implied_vol: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  timestamp: number;
  age_seconds: number;
}

interface FillLogEntry {
  time: number;
  order_id: number;
  exec_id?: string;
  level: string;
  qty_filled: number;
  avg_price: number;
  remaining_qty: number;
  pnl_pct: number;
  tranche_idx?: number;
  lot_idx?: number;
  execution_analytics?: {
    exchange?: string;
    last_liquidity?: number;
    commission?: number | null;
    realized_pnl_ib?: number | null;
    slippage?: number | null;
  };
}

interface PositionLedgerEntry {
  id: string;
  status: "active" | "closed";
  created_at: number;
  closed_at: number | null;
  exit_reason?: string;
  parent_strategy?: string;
  is_orphan?: boolean;
  entry: { order_id: number; price: number; quantity: number; fill_time: number; perm_id: number };
  instrument: { symbol: string; secType?: string; strike?: number; expiry?: string; right?: string; multiplier?: number };
  runtime_state?: {
    remaining_qty?: number;
    initial_qty?: number;
    entry_price?: number;
    high_water_mark?: number;
    trailing_active?: boolean;
    trailing_stop_price?: number;
    trailing_tranche_idx?: number;
    trailing_tranche_pending?: boolean;
    completed?: boolean;
    level_states?: Record<string, string>;
    lot_entries?: Array<{
      order_id?: number;
      entry_price?: number;
      quantity?: number;
      fill_time?: number;
      perm_id?: number;
    }>;
  };
  risk_config?: Record<string, any>;
  fill_log: FillLogEntry[];
  lineage?: {
    model_version?: string;
    model_type?: string;
    target_column?: string;
    signal_inverted?: boolean;
    recipe_label?: string;
    signal?: { probability?: number; direction?: string; strength?: number };
  };
}

interface FullExecutionStatus {
  running: boolean;
  eval_interval: number;
  strategy_count: number;
  strategies: Array<{
    strategy_id: string;
    is_active: boolean;
    config: Record<string, any>;
    strategy_state: Record<string, any>;
  }>;
  quote_snapshot: Record<string, QuoteSnapshot>;
  position_ledger?: PositionLedgerEntry[];
  engine_mode?: "running" | "paused";
  budget_status?: {
    ticker_modes?: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Today's market open (09:30 ET) as epoch seconds */
function todayOpenEpoch(): number {
  const now = new Date();
  // Build today's 09:30 ET
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setHours(9, 30, 0, 0);
  // Convert back to UTC epoch
  const offset = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getTime();
  return Math.floor((et.getTime() + offset) / 1000);
}

function fmt$(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function pnlColor(v: number | null | undefined): string {
  if (v == null || v === 0) return "text-gray-400";
  return v > 0 ? "text-green-400" : "text-red-400";
}

function fmtTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function fmtExpiry(s: string | undefined | null): string {
  if (!s) return "—";
  if (s.length !== 8) return s;
  const m = parseInt(s.slice(4, 6), 10);
  const d = s.slice(6, 8);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[m - 1]} ${d}`;
}

function contractLabel(inst: PositionLedgerEntry["instrument"]): string {
  if (!inst.strike) return inst.symbol;
  return `${inst.strike}${inst.right || "?"} ${fmtExpiry(inst.expiry)}`;
}

/**
 * Build the cache key that matches Python's f-string format.
 * Python: f"{symbol}:{instrument.get('strike', 0)}:{expiry}:{right}"
 * When strike is a float like 570.0, Python produces "570.0" but JS Number
 * toString() produces "570". We must match Python's output.
 */
function cacheKeyFromInstrument(inst: PositionLedgerEntry["instrument"]): string {
  const sym = inst.symbol || "";
  if (inst.secType === "OPT" || inst.strike) {
    // Match Python's float formatting: 570.0 → "570.0", 570.5 → "570.5"
    const strike = inst.strike ?? 0;
    const strikeStr = Number.isInteger(strike) ? `${strike}.0` : `${strike}`;
    return `${sym}:${strikeStr}:${inst.expiry || ""}:${inst.right || ""}`;
  }
  return sym;
}

function truncateModel(v: string | undefined | null): string {
  if (!v) return "—";
  if (v.startsWith("v_") && v.length >= 18) {
    return `v_${v.slice(6, 10)}_${v.slice(11, 15)}`;
  }
  if (v.length > 16) return v.slice(0, 14) + "…";
  return v;
}

/** Friendly strategy label: bmc_spy_up → SPY↑, bmc_slv_down → SLV↓ */
function strategyLabel(s: string | undefined): string {
  if (!s) return "—";
  const m = s.match(/bmc_(\w+)_(up|down)/);
  if (m) return `${m[1].toUpperCase()}${m[2] === "up" ? "↑" : "↓"}`;
  return s;
}

// ---------------------------------------------------------------------------
// Aggregated position row (one row per unique contract)
// ---------------------------------------------------------------------------

interface BookRow {
  /** Composite key: symbol:strike:expiry:right */
  key: string;
  symbol: string;
  strike: number | undefined;
  expiry: string | undefined;
  right: string | undefined;
  label: string;
  /** Total remaining quantity */
  qty: number;
  /** Weighted avg entry price */
  entryPrice: number;
  /** Current mid or last */
  lastPrice: number;
  /** Unrealized P&L $ */
  unrealPnl: number;
  /** Unrealized P&L % */
  unrealPnlPct: number;
  /** Option multiplier */
  multiplier: number;
  /** Model(s) */
  models: string[];
  /** Parent strategy names */
  strategies: string[];
  /** True if any lot was entered before today's open */
  isCarried: boolean;
  /** Count of contracts from carried positions */
  carriedQty: number;
  /** Count of contracts from today's entries */
  todayQty: number;
  /** Risk manager trailing state summary */
  rmSummary: string;
  /** Individual positions backing this row */
  positions: PositionLedgerEntry[];
  /** Cache key for quote lookup */
  cacheKey: string;
}

// ---------------------------------------------------------------------------
// Blotter row (one per fill today)
// ---------------------------------------------------------------------------

interface BlotterRow {
  time: number;
  symbol: string;
  contract: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  commission: number;
  reason: string;
  pnl: number | null;
  model: string;
  strategy: string;
  isCarried: boolean;
  positionId: string;
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const BOOK_COLUMNS: ColumnDef[] = [
  { key: "contract", label: "Contract" },
  { key: "qty", label: "Qty" },
  { key: "entry", label: "Entry" },
  { key: "last", label: "Last" },
  { key: "pnl", label: "P&L $" },
  { key: "pnlPct", label: "P&L %" },
  { key: "model", label: "Model" },
  { key: "strategy", label: "Strategy" },
  { key: "rm", label: "RM Status" },
  { key: "carried", label: "Session" },
];
const BOOK_DEFAULTS = ["contract", "qty", "entry", "last", "pnl", "pnlPct", "model", "rm", "carried"];
const BOOK_LOCKED = ["contract"];

const BLOTTER_COLUMNS: ColumnDef[] = [
  { key: "time", label: "Time" },
  { key: "contract", label: "Contract" },
  { key: "side", label: "Side" },
  { key: "qty", label: "Qty" },
  { key: "price", label: "Price" },
  { key: "commission", label: "Comm" },
  { key: "reason", label: "Reason" },
  { key: "pnl", label: "P&L" },
  { key: "model", label: "Model" },
  { key: "strategy", label: "Strategy" },
  { key: "session", label: "Session" },
];
const BLOTTER_DEFAULTS = ["time", "contract", "side", "qty", "price", "reason", "pnl", "model"];
const BLOTTER_LOCKED = ["time"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BookTab() {
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();

  // Column chooser state
  const savedBookCols = getVisibleColumns("book");
  const bookVisibleKeys = useMemo(() => savedBookCols ?? BOOK_DEFAULTS, [savedBookCols]);
  const bookVisibleSet = useMemo(() => new Set(bookVisibleKeys), [bookVisibleKeys]);
  const handleBookColsChange = useCallback(
    (keys: string[]) => setVisibleColumns("book", keys),
    [setVisibleColumns],
  );

  const savedBlotterCols = getVisibleColumns("bookBlotter");
  const blotterVisibleKeys = useMemo(() => savedBlotterCols ?? BLOTTER_DEFAULTS, [savedBlotterCols]);
  const blotterVisibleSet = useMemo(() => new Set(blotterVisibleKeys), [blotterVisibleKeys]);
  const handleBlotterColsChange = useCallback(
    (keys: string[]) => setVisibleColumns("bookBlotter", keys),
    [setVisibleColumns],
  );

  // Data
  const [execStatus, setExecStatus] = useState<FullExecutionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // UI state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [blotterExpanded, setBlotterExpanded] = useState(true);
  const [filterModel, setFilterModel] = useState<string | null>(null);

  // ── Fetch execution status ──
  const fetchStatus = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/ma-options/execution/status", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setExecStatus(data);
        setLastUpdate(Date.now());
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000); // 3s polls for Book view
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  // ── Build position book rows ──
  const todayOpen = useMemo(() => todayOpenEpoch(), []);

  const { bookRows, groupedRows, blotterRows, totals } = useMemo(() => {
    const ledger = execStatus?.position_ledger || [];
    const quotes = execStatus?.quote_snapshot || {};
    const strategies = execStatus?.strategies || [];

    // Build a map from strategy_id → cache_key from strategy_state
    // This is the authoritative cache key that matches quote_snapshot keys
    const strategyCacheKeys = new Map<string, string>();
    for (const s of strategies) {
      if (s.strategy_state?.cache_key) {
        strategyCacheKeys.set(s.strategy_id, s.strategy_state.cache_key);
      }
    }

    // Only show active positions (or closed today for blotter)
    const todayStart = todayOpen;
    const activePositions = ledger.filter(p => p.status === "active");
    const closedToday = ledger.filter(p =>
      p.status === "closed" && p.closed_at && p.closed_at > todayStart
    );
    const allRelevant = [...activePositions, ...closedToday];

    // Resolve the quote_snapshot cache key for a position:
    // 1. Use the strategy's cache_key if available (authoritative, matches Python f-string)
    // 2. Fall back to reconstructing from instrument (with float-safe formatting)
    const resolveCacheKey = (pos: PositionLedgerEntry): string => {
      const fromStrategy = strategyCacheKeys.get(pos.id);
      if (fromStrategy) return fromStrategy;
      return cacheKeyFromInstrument(pos.instrument);
    };

    // Group active positions by contract key
    const contractMap = new Map<string, PositionLedgerEntry[]>();
    for (const pos of activePositions) {
      const ck = resolveCacheKey(pos);
      if (!contractMap.has(ck)) contractMap.set(ck, []);
      contractMap.get(ck)!.push(pos);
    }

    // Build book rows
    const rows: BookRow[] = [];
    for (const [ck, positions] of contractMap) {
      const first = positions[0];
      const multiplier = first.instrument.multiplier || 100;

      let totalQty = 0;
      let totalCost = 0;
      let carriedQty = 0;
      let todayQty = 0;
      const models = new Set<string>();
      const strategies = new Set<string>();
      let isCarried = false;
      const rmStates: string[] = [];

      for (const pos of positions) {
        const qty = pos.runtime_state?.remaining_qty ?? pos.entry.quantity;
        const entryPrice = pos.runtime_state?.entry_price ?? pos.entry.price;
        totalQty += qty;
        totalCost += entryPrice * qty;

        // Carried detection: entry before today's open
        const entryTime = pos.entry.fill_time || pos.created_at;
        if (entryTime < todayStart) {
          isCarried = true;
          carriedQty += qty;
        } else {
          todayQty += qty;
        }

        if (pos.lineage?.model_version) models.add(pos.lineage.model_version);
        if (pos.parent_strategy) strategies.add(pos.parent_strategy);

        // RM summary
        const ls = pos.runtime_state?.level_states || {};
        const trailing = pos.runtime_state?.trailing_active;
        const trailPrice = pos.runtime_state?.trailing_stop_price;
        if (trailing && trailPrice) {
          rmStates.push(`trail $${trailPrice.toFixed(2)}`);
        } else if (ls.trailing === "ARMED" || Object.keys(ls).some(k => k.startsWith("trailing") && ls[k] === "ARMED")) {
          rmStates.push("trail armed");
        }
        if (ls.eod_closeout === "ARMED") rmStates.push("eod");
        if (ls.stop_simple === "ARMED") rmStates.push("SL");
      }

      const avgEntry = totalQty > 0 ? totalCost / totalQty : 0;

      // Get live price
      const quote = quotes[ck];
      const lastPrice = quote
        ? (quote.bid > 0 && quote.ask > 0 ? quote.mid : quote.last)
        : 0;

      const unrealPnl = lastPrice > 0 ? (lastPrice - avgEntry) * totalQty * multiplier : 0;
      const unrealPnlPct = avgEntry > 0 && lastPrice > 0 ? ((lastPrice - avgEntry) / avgEntry) * 100 : 0;

      rows.push({
        key: ck,
        symbol: first.instrument.symbol,
        strike: first.instrument.strike,
        expiry: first.instrument.expiry,
        right: first.instrument.right,
        label: contractLabel(first.instrument),
        qty: totalQty,
        entryPrice: avgEntry,
        lastPrice,
        unrealPnl,
        unrealPnlPct,
        multiplier,
        models: [...models],
        strategies: [...strategies],
        isCarried,
        carriedQty,
        todayQty,
        rmSummary: [...new Set(rmStates)].join(", ") || "—",
        positions,
        cacheKey: ck,
      });
    }

    // Sort by symbol then strike
    rows.sort((a, b) => {
      const sc = a.symbol.localeCompare(b.symbol);
      if (sc !== 0) return sc;
      return (a.strike || 0) - (b.strike || 0);
    });

    // Group by symbol
    const grouped = new Map<string, BookRow[]>();
    for (const row of rows) {
      if (!grouped.has(row.symbol)) grouped.set(row.symbol, []);
      grouped.get(row.symbol)!.push(row);
    }

    // Build blotter rows from today's fills
    const blotter: BlotterRow[] = [];
    for (const pos of allRelevant) {
      for (const fill of pos.fill_log || []) {
        if (fill.time < todayStart) continue;
        const isEntry = fill.level === "entry";
        const contract = contractLabel(pos.instrument);

        // Compute fill P&L for exits
        let pnl: number | null = null;
        if (!isEntry) {
          const entryPrice = pos.runtime_state?.entry_price ?? pos.entry.price;
          const mult = pos.instrument.multiplier || 100;
          pnl = (fill.avg_price - entryPrice) * fill.qty_filled * mult;
        }

        const entryTime = pos.entry.fill_time || pos.created_at;

        blotter.push({
          time: fill.time,
          symbol: pos.instrument.symbol,
          contract,
          side: isEntry ? "BUY" : "SELL",
          qty: fill.qty_filled,
          price: fill.avg_price,
          commission: fill.execution_analytics?.commission ?? 0,
          reason: isEntry ? "entry" : fill.level || "exit",
          pnl,
          model: truncateModel(pos.lineage?.model_version),
          strategy: strategyLabel(pos.parent_strategy),
          isCarried: entryTime < todayStart,
          positionId: pos.id,
        });
      }
    }

    // Sort blotter reverse chronological
    blotter.sort((a, b) => b.time - a.time);

    // Compute totals
    let totalUnrealPnl = 0;
    let totalContracts = 0;
    let totalCarriedPnl = 0;
    let totalTodayPnl = 0;
    let totalCarriedContracts = 0;
    let totalTodayContracts = 0;
    let totalCashAtRisk = 0;

    for (const row of rows) {
      totalUnrealPnl += row.unrealPnl;
      totalContracts += row.qty;
      totalCashAtRisk += row.entryPrice * row.qty * row.multiplier;
      if (row.isCarried) {
        // Split carried vs today proportionally
        if (row.carriedQty > 0) {
          totalCarriedPnl += (row.unrealPnl / row.qty) * row.carriedQty;
          totalCarriedContracts += row.carriedQty;
        }
        if (row.todayQty > 0) {
          totalTodayPnl += (row.unrealPnl / row.qty) * row.todayQty;
          totalTodayContracts += row.todayQty;
        }
      } else {
        totalTodayPnl += row.unrealPnl;
        totalTodayContracts += row.qty;
      }
    }

    // Add realized P&L from closed-today positions
    let realizedPnl = 0;
    let totalCommission = 0;
    for (const fill of blotter) {
      totalCommission += Math.abs(fill.commission);
      if (fill.pnl != null && fill.side === "SELL") {
        realizedPnl += fill.pnl;
      }
    }

    return {
      bookRows: rows,
      groupedRows: grouped,
      blotterRows: blotter,
      totals: {
        unrealPnl: totalUnrealPnl,
        contracts: totalContracts,
        carriedPnl: totalCarriedPnl,
        todayPnl: totalTodayPnl,
        carriedContracts: totalCarriedContracts,
        todayContracts: totalTodayContracts,
        cashAtRisk: totalCashAtRisk,
        realizedPnl,
        commission: totalCommission,
      },
    };
  }, [execStatus, todayOpen]);

  // Model filter options
  const availableModels = useMemo(() => {
    const models = new Set<string>();
    for (const row of bookRows) {
      for (const m of row.models) models.add(m);
    }
    return [...models].sort();
  }, [bookRows]);

  // Available strategies for filter pills
  const strategyPnl = useMemo(() => {
    const map = new Map<string, { pnl: number; qty: number }>();
    for (const row of bookRows) {
      for (const s of row.strategies) {
        const existing = map.get(s) || { pnl: 0, qty: 0 };
        // Approximate: split evenly across strategies if multiple
        const share = 1 / row.strategies.length;
        existing.pnl += row.unrealPnl * share;
        existing.qty += row.qty * share;
        map.set(s, existing);
      }
    }
    return map;
  }, [bookRows]);

  const toggleGroup = useCallback((sym: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  }, []);

  // Filter
  const filteredGrouped = useMemo(() => {
    if (!filterModel) return groupedRows;
    const filtered = new Map<string, BookRow[]>();
    for (const [sym, rows] of groupedRows) {
      const matched = rows.filter(r => r.models.some(m => m === filterModel));
      if (matched.length > 0) filtered.set(sym, matched);
    }
    return filtered;
  }, [groupedRows, filterModel]);

  const filteredBlotter = useMemo(() => {
    if (!filterModel) return blotterRows;
    return blotterRows.filter(r => r.model === truncateModel(filterModel));
  }, [blotterRows, filterModel]);

  if (loading && !execStatus) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading execution state…
      </div>
    );
  }

  if (!execStatus?.position_ledger || execStatus.position_ledger.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No positions in the book. The execution engine may not be running.
      </div>
    );
  }

  const engineRunning = execStatus?.running ?? false;

  return (
    <div className="space-y-3">
      {/* ── Portfolio Summary Bar ── */}
      <div className="bg-gray-900 border border-gray-700 rounded px-3 py-2">
        <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
          {/* Left: main P&L */}
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-gray-500 mr-1">Session:</span>
              <span className={`font-mono font-bold text-base ${pnlColor(totals.unrealPnl + totals.realizedPnl - totals.commission)}`}>
                {fmt$(totals.unrealPnl + totals.realizedPnl - totals.commission)}
              </span>
            </div>
            <span className="text-gray-700">│</span>
            <div>
              <span className="text-gray-500 mr-1">Open:</span>
              <span className={`font-mono ${pnlColor(totals.unrealPnl)}`}>
                {fmt$(totals.unrealPnl)}
              </span>
            </div>
            <div>
              <span className="text-gray-500 mr-1">Realized:</span>
              <span className={`font-mono ${pnlColor(totals.realizedPnl)}`}>
                {fmt$(totals.realizedPnl)}
              </span>
            </div>
            <div>
              <span className="text-gray-500 mr-1">Comm:</span>
              <span className="font-mono text-red-400">
                -${totals.commission.toFixed(2)}
              </span>
            </div>
            <span className="text-gray-700">│</span>
            <div>
              <span className="text-gray-500 mr-1">Contracts:</span>
              <span className="font-mono text-gray-200">{totals.contracts}</span>
            </div>
            <div>
              <span className="text-gray-500 mr-1">At risk:</span>
              <span className="font-mono text-gray-300">${totals.cashAtRisk.toFixed(0)}</span>
            </div>
          </div>

          {/* Right: carried / today split + engine status */}
          <div className="flex items-center gap-3 text-xs">
            {totals.carriedContracts > 0 && (
              <span className="text-amber-400/80">
                †carried: {totals.carriedContracts}C {fmt$(totals.carriedPnl)}
              </span>
            )}
            {totals.todayContracts > 0 && (
              <span className="text-blue-400/80">
                today: {totals.todayContracts}C {fmt$(totals.todayPnl)}
              </span>
            )}
            <span className="text-gray-700">│</span>
            <span className={engineRunning ? "text-green-500" : "text-red-500"}>
              {engineRunning ? "● engine" : "○ engine off"}
            </span>
            <button
              onClick={() => { setLoading(true); fetchStatus(); }}
              className="text-gray-500 hover:text-gray-300"
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Strategy pills */}
        {strategyPnl.size > 0 && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {[...strategyPnl.entries()].map(([strat, { pnl }]) => (
              <button
                key={strat}
                onClick={() => setFilterModel(filterModel === strat ? null : strat)}
                className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                  filterModel === strat
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {strategyLabel(strat)} <span className={pnlColor(pnl)}>{fmt$(pnl)}</span>
              </button>
            ))}
            {filterModel && (
              <button
                onClick={() => setFilterModel(null)}
                className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-500 hover:text-gray-300"
              >
                clear filter
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Position Book ── */}
      <div className="bg-gray-900 border border-gray-700 rounded">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800">
          <h3 className="text-sm font-medium text-gray-300">Position Book</h3>
          <ColumnChooser
            columns={BOOK_COLUMNS}
            visible={bookVisibleKeys}
            defaults={BOOK_DEFAULTS}
            onChange={handleBookColsChange}
            locked={BOOK_LOCKED}
            size="sm"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                {/* Expand chevron column */}
                <th className="w-5 px-1"></th>
                {bookVisibleSet.has("contract") && <th className="text-left px-2 py-1">Contract</th>}
                {bookVisibleSet.has("qty") && <th className="text-right px-2 py-1">Qty</th>}
                {bookVisibleSet.has("entry") && <th className="text-right px-2 py-1">Entry</th>}
                {bookVisibleSet.has("last") && <th className="text-right px-2 py-1">Last</th>}
                {bookVisibleSet.has("pnl") && <th className="text-right px-2 py-1">P&L $</th>}
                {bookVisibleSet.has("pnlPct") && <th className="text-right px-2 py-1">P&L %</th>}
                {bookVisibleSet.has("model") && <th className="text-left px-2 py-1">Model</th>}
                {bookVisibleSet.has("strategy") && <th className="text-left px-2 py-1">Strategy</th>}
                {bookVisibleSet.has("rm") && <th className="text-left px-2 py-1">RM Status</th>}
                {bookVisibleSet.has("carried") && <th className="text-center px-2 py-1">Session</th>}
              </tr>
            </thead>
            <tbody>
              {[...filteredGrouped.entries()].map(([symbol, rows]) => {
                const grpExpanded = expandedGroups.has(symbol);
                const grpQty = rows.reduce((s, r) => s + r.qty, 0);
                const grpPnl = rows.reduce((s, r) => s + r.unrealPnl, 0);
                const grpCost = rows.reduce((s, r) => s + r.entryPrice * r.qty * r.multiplier, 0);
                const hasCarried = rows.some(r => r.isCarried);

                return (
                  <Fragment key={symbol}>
                    {/* Group header */}
                    <tr
                      className="bg-gray-800/50 cursor-pointer hover:bg-gray-800"
                      onClick={() => toggleGroup(symbol)}
                    >
                      <td className="px-1 text-gray-500">
                        {grpExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </td>
                      <td colSpan={bookVisibleKeys.length} className="px-2 py-1">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-gray-200">{symbol}</span>
                          <span className="text-gray-400">{rows.length} strike{rows.length !== 1 ? "s" : ""}</span>
                          <span className="text-gray-500">{grpQty}C</span>
                          <span className={`font-mono font-bold ${pnlColor(grpPnl)}`}>{fmt$(grpPnl)}</span>
                          <span className="text-gray-600 font-mono">(${grpCost.toFixed(0)} at risk)</span>
                          {hasCarried && <span className="text-amber-500/70 text-[10px]">†carried</span>}
                        </div>
                      </td>
                    </tr>

                    {/* Position rows */}
                    {grpExpanded && rows.map(row => (
                      <tr key={row.key} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td></td>
                        {bookVisibleSet.has("contract") && (
                          <td className="px-2 py-1 text-gray-200 font-mono">
                            {row.isCarried && <span className="text-amber-500 mr-1" title="Carried from prior session">†</span>}
                            {row.label}
                          </td>
                        )}
                        {bookVisibleSet.has("qty") && (
                          <td className="text-right px-2 py-1 font-mono text-gray-200">{row.qty}</td>
                        )}
                        {bookVisibleSet.has("entry") && (
                          <td className="text-right px-2 py-1 font-mono text-gray-300">{row.entryPrice.toFixed(2)}</td>
                        )}
                        {bookVisibleSet.has("last") && (
                          <td className="text-right px-2 py-1 font-mono text-gray-200">
                            {row.lastPrice > 0 ? row.lastPrice.toFixed(2) : "—"}
                          </td>
                        )}
                        {bookVisibleSet.has("pnl") && (
                          <td className={`text-right px-2 py-1 font-mono font-bold ${pnlColor(row.unrealPnl)}`}>
                            {row.lastPrice > 0 ? fmt$(row.unrealPnl) : "—"}
                          </td>
                        )}
                        {bookVisibleSet.has("pnlPct") && (
                          <td className={`text-right px-2 py-1 font-mono ${pnlColor(row.unrealPnlPct)}`}>
                            {row.lastPrice > 0 ? fmtPct(row.unrealPnlPct) : "—"}
                          </td>
                        )}
                        {bookVisibleSet.has("model") && (
                          <td className="px-2 py-1 text-gray-400 font-mono text-[10px]">
                            {row.models.map(truncateModel).join(", ")}
                          </td>
                        )}
                        {bookVisibleSet.has("strategy") && (
                          <td className="px-2 py-1 text-gray-400 text-[10px]">
                            {row.strategies.map(strategyLabel).join(", ")}
                          </td>
                        )}
                        {bookVisibleSet.has("rm") && (
                          <td className="px-2 py-1">
                            <span className={`text-[10px] font-mono ${
                              row.rmSummary.includes("trail $") ? "text-green-400" :
                              row.rmSummary.includes("armed") ? "text-yellow-500" :
                              row.rmSummary === "—" ? "text-gray-600" :
                              "text-gray-400"
                            }`}>
                              {row.rmSummary}
                            </span>
                          </td>
                        )}
                        {bookVisibleSet.has("carried") && (
                          <td className="text-center px-2 py-1 text-[10px]">
                            {row.isCarried ? (
                              <span className="text-amber-400">
                                {row.carriedQty > 0 && row.todayQty > 0
                                  ? `†${row.carriedQty}+${row.todayQty}`
                                  : `†${row.carriedQty}`}
                              </span>
                            ) : (
                              <span className="text-blue-400">today</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}

              {filteredGrouped.size === 0 && (
                <tr>
                  <td colSpan={bookVisibleKeys.length + 1} className="text-center text-gray-600 py-4">
                    No open positions{filterModel ? " matching filter" : ""}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Intraday Blotter ── */}
      <div className="bg-gray-900 border border-gray-700 rounded">
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 cursor-pointer hover:bg-gray-800/30"
          onClick={() => setBlotterExpanded(e => !e)}
        >
          <div className="flex items-center gap-2">
            {blotterExpanded ? <ChevronDown className="h-3 w-3 text-gray-500" /> : <ChevronRight className="h-3 w-3 text-gray-500" />}
            <h3 className="text-sm font-medium text-gray-300">
              Today&apos;s Fills
              <span className="text-gray-500 ml-2 font-normal">
                ({filteredBlotter.length} fill{filteredBlotter.length !== 1 ? "s" : ""})
              </span>
            </h3>
            {/* Blotter summary */}
            {filteredBlotter.length > 0 && (
              <div className="flex items-center gap-3 ml-4 text-xs">
                <span>
                  <span className="text-gray-500">Realized:</span>{" "}
                  <span className={`font-mono ${pnlColor(totals.realizedPnl)}`}>
                    {fmt$(totals.realizedPnl)}
                  </span>
                </span>
                <span>
                  <span className="text-gray-500">Comm:</span>{" "}
                  <span className="font-mono text-red-400">-${totals.commission.toFixed(2)}</span>
                </span>
              </div>
            )}
          </div>
          {blotterExpanded && (
            <ColumnChooser
              columns={BLOTTER_COLUMNS}
              visible={blotterVisibleKeys}
              defaults={BLOTTER_DEFAULTS}
              onChange={handleBlotterColsChange}
              locked={BLOTTER_LOCKED}
              size="sm"
            />
          )}
        </div>

        {blotterExpanded && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  {blotterVisibleSet.has("time") && <th className="text-left px-2 py-1">Time</th>}
                  {blotterVisibleSet.has("contract") && <th className="text-left px-2 py-1">Contract</th>}
                  {blotterVisibleSet.has("side") && <th className="text-center px-2 py-1">Side</th>}
                  {blotterVisibleSet.has("qty") && <th className="text-right px-2 py-1">Qty</th>}
                  {blotterVisibleSet.has("price") && <th className="text-right px-2 py-1">Price</th>}
                  {blotterVisibleSet.has("commission") && <th className="text-right px-2 py-1">Comm</th>}
                  {blotterVisibleSet.has("reason") && <th className="text-left px-2 py-1">Reason</th>}
                  {blotterVisibleSet.has("pnl") && <th className="text-right px-2 py-1">P&L</th>}
                  {blotterVisibleSet.has("model") && <th className="text-left px-2 py-1">Model</th>}
                  {blotterVisibleSet.has("strategy") && <th className="text-left px-2 py-1">Strategy</th>}
                  {blotterVisibleSet.has("session") && <th className="text-center px-2 py-1">Session</th>}
                </tr>
              </thead>
              <tbody>
                {filteredBlotter.map((fill, i) => (
                  <tr
                    key={`${fill.positionId}-${fill.time}-${i}`}
                    className="border-b border-gray-800/30 hover:bg-gray-800/20"
                  >
                    {blotterVisibleSet.has("time") && (
                      <td className="px-2 py-1 font-mono text-gray-400">{fmtTime(fill.time)}</td>
                    )}
                    {blotterVisibleSet.has("contract") && (
                      <td className="px-2 py-1 text-gray-200 font-mono">
                        {fill.isCarried && <span className="text-amber-500 mr-1">†</span>}
                        {fill.symbol} {fill.contract}
                      </td>
                    )}
                    {blotterVisibleSet.has("side") && (
                      <td className={`text-center px-2 py-1 font-bold ${fill.side === "BUY" ? "text-blue-400" : "text-orange-400"}`}>
                        {fill.side}
                      </td>
                    )}
                    {blotterVisibleSet.has("qty") && (
                      <td className="text-right px-2 py-1 font-mono text-gray-200">{fill.qty}</td>
                    )}
                    {blotterVisibleSet.has("price") && (
                      <td className="text-right px-2 py-1 font-mono text-gray-300">{fill.price.toFixed(2)}</td>
                    )}
                    {blotterVisibleSet.has("commission") && (
                      <td className="text-right px-2 py-1 font-mono text-gray-500">
                        {fill.commission ? `$${Math.abs(fill.commission).toFixed(2)}` : "—"}
                      </td>
                    )}
                    {blotterVisibleSet.has("reason") && (
                      <td className="px-2 py-1">
                        <span className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                          fill.reason === "entry" ? "bg-blue-900/40 text-blue-400" :
                          fill.reason === "trailing" ? "bg-green-900/40 text-green-400" :
                          fill.reason.includes("stop") ? "bg-red-900/40 text-red-400" :
                          fill.reason === "eod_closeout" ? "bg-purple-900/40 text-purple-400" :
                          fill.reason === "expired_worthless" ? "bg-gray-800 text-gray-500" :
                          "bg-gray-800 text-gray-400"
                        }`}>
                          {fill.reason}
                        </span>
                      </td>
                    )}
                    {blotterVisibleSet.has("pnl") && (
                      <td className={`text-right px-2 py-1 font-mono font-bold ${pnlColor(fill.pnl)}`}>
                        {fill.pnl != null ? fmt$(fill.pnl) : "—"}
                      </td>
                    )}
                    {blotterVisibleSet.has("model") && (
                      <td className="px-2 py-1 text-gray-400 font-mono text-[10px]">{fill.model}</td>
                    )}
                    {blotterVisibleSet.has("strategy") && (
                      <td className="px-2 py-1 text-gray-400 text-[10px]">{fill.strategy}</td>
                    )}
                    {blotterVisibleSet.has("session") && (
                      <td className="text-center px-2 py-1 text-[10px]">
                        {fill.isCarried ? <span className="text-amber-400">†prior</span> : <span className="text-blue-400">today</span>}
                      </td>
                    )}
                  </tr>
                ))}

                {filteredBlotter.length === 0 && (
                  <tr>
                    <td colSpan={blotterVisibleKeys.length} className="text-center text-gray-600 py-4">
                      No fills today{filterModel ? " matching filter" : ""}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Last updated */}
      <div className="text-[10px] text-gray-600 text-right">
        Last updated: {lastUpdate > 0 ? new Date(lastUpdate).toLocaleTimeString() : "—"} (3s poll)
      </div>
    </div>
  );
}
